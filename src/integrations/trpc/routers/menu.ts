/**
 * 菜单路由 —— 读写 `sys_menu` 表(自关联树),供侧边栏 / 面包屑 / 模块概览动态渲染,
 * 以及「系统设置 ▸ 菜单管理」维护。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | **全部**菜单行(按 `sort`,再按名称)—— 「菜单管理」页用,含按钮 |
 * | `mine` | query | **当前用户的可见菜单 + 权限标识**(部门 → 角色 → 授权取并集,见 `lib/rbac.ts`)|
 * | `update` | mutation | 改一个节点的名称 / 路径 / 图标 / 上下线(`path` 冲突回 `CONFLICT`) |
 * | `reorder` | mutation | **同级**重排:传入父节点 + 该父下的完整 id 顺序,逐行写 `sort` |
 * | `create` | mutation | 新增(父节点 + 名称,可选路径 / 图标);排序追加到同级末尾 |
 * | `delete` | mutation | **软删**(审计留痕;`path` 用 `tombstone()` 让位,连带清掉这个菜单上的角色授权);**有子菜单时拒绝**(先删子菜单,避免误删整枝) |
 *
 * 写接口末尾为什么要 `clearCasbinCache()`:判定用的策略是 `lib/casbin.ts` 装载时**展开**出来的,
 * 菜单的 `perm` / `path` / 父子关系一变,展开结果就变 —— 哪怕 `sys_casbin_rule` 一行都没动。
 * (`reorder` 只改 `sort`,`sort` 不参与展开,所以那里不用刷。)
 *
 * 树为什么不在这里拼:渲染层要的是 `NavNode[](带图标组件映射)`,而图标映射属于前端资产;
 * 服务端只回"事实"(平铺行),拼树 + 过滤是纯函数,放前端更好测。
 */

import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysMenu } from "#/db/data-base-schema";
import { clearCasbinCache, removeMenuPolicies } from "#/lib/casbin";
import { getCurrentUserId } from "#/lib/current-user";
import { newId } from "#/lib/ids";
import { recordIdFromMenuDetailPath } from "#/lib/menu-detail-path";
import { asMenuType } from "#/lib/menu-spec";
import { effectiveMenusFor, PERM_FORMAT } from "#/lib/rbac";
import { alive, softDeleted, tombstone } from "#/lib/soft-delete";
import { createTRPCRouter, protectedProcedure } from "../init";

/** 库行 → 接口出参(时间列不回,前端用不到) */
function toMenu(row: typeof sysMenu.$inferSelect) {
	return {
		id: row.id,
		parentId: row.parent_id ?? null,
		name: row.name,
		path: row.path,
		icon: row.icon ?? null,
		sort: Number(row.sort ?? 0),
		visible: Number(row.visible ?? 1),
		type: asMenuType(row.type),
		perm: row.perm ?? null,
		createTime: row.create_time ? row.create_time.toISOString() : null,
		updateTime: row.update_time ? row.update_time.toISOString() : null,
	};
}

/**
 * 取一行菜单。
 *
 * `includeDeleted` 只有**删除过程**会传 —— 软删要把 `path` 写成墓碑让位,必须拿到那一行;
 * 其余读路径(update 取行 / create 校父节点)一律带 `alive()`,否则已删除的菜单会重新露出来。
 */
async function getMenuRow(id: string, includeDeleted = false) {
	const [row] = await db
		.select()
		.from(sysMenu)
		.where(includeDeleted ? eq(sysMenu.id, id) : and(eq(sysMenu.id, id), alive(sysMenu)))
		.limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这个菜单不存在(可能已被删除)" });
	return row;
}

/** 路径唯一性:`path` 决定路由,重了两条菜单会指向同一个页面 */
async function assertPathFree(path: string | null, selfId?: string) {
	if (!path) return; // 兼容 update 传空串的场景(上面已单独拦过)
	// 查重只看**活着**的行:已软删菜单的 path 已被 `tombstone()` 让位,那个路径要能重新启用
	const rows = await db
		.select({ id: sysMenu.id, name: sysMenu.name })
		.from(sysMenu)
		.where(
			and(
				alive(sysMenu),
				selfId ? sql`${sysMenu.path} = ${path} and ${sysMenu.id} <> ${selfId}` : eq(sysMenu.path, path),
			),
		);
	if (rows.length === 0) return;
	// 参数化菜单(path = <前缀>/<记录 id>)的冲突要说人话:
	// 这不是"路径被别人占了",而是"这条记录已经挂在一个菜单下面了"(一条记录只能挂一处)
	if (recordIdFromMenuDetailPath(path)) {
		throw new TRPCError({
			code: "CONFLICT",
			message: `这条记录已经关联到菜单「${rows[0]?.name}」了(一条记录只能挂一个菜单;想换地方先去那边解除关联)`,
		});
	}
	throw new TRPCError({ code: "CONFLICT", message: `路径「${path}」已被菜单「${rows[0]?.name}」占用` });
}

/**
 * 权限标识字段:**空串 / null = 没填**;填了就必须是 `域:资源:动作`(三段小写,整段可用 `*` 通配)。
 *
 * 为什么必须有这道校验:通配符(`sys:*:*` / `*:*:*`)是按"段"匹配的 —— 如果库里能存进
 * `sys:role`(两段)或半截通配 `sys:ro*`,匹配规则就永远命不中,症状是"勾了却没权限"很难查。
 * 域允许长出新的(派生项目加模块),受控的是**形状**。
 */
const permField = z
	.string()
	.max(64)
	.nullable()
	.refine((value) => !value || value.trim() === "" || PERM_FORMAT.test(value.trim()), {
		message: "权限标识要写成 域:资源:动作(三段小写;某一段想通配就整段写 *)",
	});

export const menuRouter = createTRPCRouter({
	list: protectedProcedure.query(async () => {
		// 软删的菜单行留在库里只为审计留痕,列表不能把它当成"库里有什么"回给管理员
		const rows = await db.select().from(sysMenu).where(alive(sysMenu)).orderBy(asc(sysMenu.sort), asc(sysMenu.name));
		return rows.map(toMenu);
	}),

	/**
	 * 当前用户真正能看见的菜单 + 能用的权限标识。
	 *
	 * 与 `list` 的区别:`list` 是"库里有什么"(给管理员改菜单用),`mine` 是"这个人能看什么"。
	 * 只认会话 —— userId 从请求 cookie 里取(`lib/current-user.ts`)。
	 */
	mine: protectedProcedure.query(async () => {
		const { rows, perms } = await effectiveMenusFor(await getCurrentUserId());
		return { rows: rows === null ? null : rows.map(toMenu), perms };
	}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1, "菜单名不能为空").max(32),
				path: z.string().max(128).nullable(),
				icon: z.string().max(32).nullable(),
				visible: z.boolean(),
				/** 1 目录 / 2 菜单 / 3 按钮 */
				type: z.number().int().min(1).max(3).default(2),
				/** 权限标识(按钮必填);空串一律当没填。格式见 `permField` */
				perm: permField,
			}),
		)
		.mutation(async ({ input }) => {
			await getMenuRow(input.id);
			// 表定义里 path 是 not null + 唯一:没有"没有 path 的菜单"这一档
			const path = (input.path ?? "").trim();
			if (!path) throw new TRPCError({ code: "BAD_REQUEST", message: "路径不能为空(表定义要求 path 非空)" });
			await assertPathFree(path, input.id);
			await db
				.update(sysMenu)
				.set({
					name: input.name.trim(),
					path,
					icon: input.icon || null,
					visible: input.visible ? 1 : 0,
					type: input.type,
					perm: input.perm?.trim() || null,
					// 显式写 update_time:达梦不支持 DDL 的 ON UPDATE CURRENT_TIMESTAMP,靠应用补齐
					update_time: new Date(),
				})
				.where(eq(sysMenu.id, input.id));
			// `perm` / `path` 变了,装载时的展开结果就变 —— 哪怕策略表一行没动
			clearCasbinCache();
			return toMenu(await getMenuRow(input.id));
		}),

	/**
	 * 同级重排。传入**父节点 + 该父节点下所有子节点的 id 顺序**,服务端逐行写 `sort`。
	 *
	 * 为什么把"同一批"整体传上来:拖拽最容易出的错就是"跨级拖",与其在服务端猜,
	 * 不如让调用方把"这一层的完整名单"给出来 —— 只要名单里出现了兄弟之外的行,直接拒绝。
	 * (前端 UI 同样只允许落在同级之间,两层防线。)
	 */
	reorder: protectedProcedure
		.input(z.object({ parentId: z.string().nullable(), orderedIds: z.array(z.string().min(1)).min(1) }))
		.mutation(async ({ input }) => {
			const parentId = input.parentId ?? null;
			// 同级集合只看活着的:已软删的兄弟不该出现在"必须包含全部同级"的清单里
			const siblings = await db
				.select({ id: sysMenu.id, parentId: sysMenu.parent_id })
				.from(sysMenu)
				.where(
					and(parentId === null ? sql`${sysMenu.parent_id} is null` : eq(sysMenu.parent_id, parentId), alive(sysMenu)),
				);
			const siblingIds = new Set(siblings.map((row) => row.id));
			const unknown = input.orderedIds.filter((id) => !siblingIds.has(id));
			if (unknown.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `只能在同一级内排序,以下菜单不属于同一父节点:${unknown.join("、")}`,
				});
			}
			if (input.orderedIds.length !== siblingIds.size) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "排序清单必须包含该级下全部菜单" });
			}
			// 事务里逐行写 sort:要么全改、要么不改
			await db.transaction(async (tx) => {
				for (const [index, id] of input.orderedIds.entries()) {
					await tx.update(sysMenu).set({ sort: index, update_time: new Date() }).where(eq(sysMenu.id, id));
				}
			});
			const rows = await db.select().from(sysMenu).where(alive(sysMenu)).orderBy(asc(sysMenu.sort), asc(sysMenu.name));
			return { updated: input.orderedIds.length, rows: rows.map(toMenu) };
		}),

	create: protectedProcedure
		.input(
			z.object({
				parentId: z.string().nullable(),
				name: z.string().min(1, "菜单名不能为空").max(32),
				/** 表定义是 not null + 唯一:每个菜单都必须有路由 */
				path: z.string().min(1, "路径不能为空").max(128),
				icon: z.string().max(32).nullable(),
				visible: z.boolean().default(true),
				/** 1 目录 / 2 菜单 / 3 按钮;默认菜单,老调用点不用改 */
				type: z.number().int().min(1).max(3).default(2),
				perm: permField.default(null),
			}),
		)
		.mutation(async ({ input }) => {
			const parentId = input.parentId ?? null;
			if (parentId) await getMenuRow(parentId);
			const name = input.name.trim();
			const path = input.path.trim();
			await assertPathFree(path);

			// 主键一律 nanoid(无意义短串)—— 业务的唯一性由 `path` 保证(`assertPathFree` 已校过),
			// 不再拿 path 当 id:那样改一次路由就等于换主键,谁引用过都会断。
			const id = newId();
			const siblings = await db
				.select({ sort: sysMenu.sort })
				.from(sysMenu)
				.where(
					and(parentId === null ? sql`${sysMenu.parent_id} is null` : eq(sysMenu.parent_id, parentId), alive(sysMenu)),
				);
			const sort = siblings.reduce((max, row) => Math.max(max, Number(row.sort ?? 0)), -1) + 1;
			await db.insert(sysMenu).values({
				id,
				parent_id: parentId,
				name,
				path,
				icon: input.icon || null,
				sort,
				visible: input.visible ? 1 : 0,
				type: input.type,
				perm: input.perm?.trim() || null,
			});
			// 新菜单可能落进某个 `*:*:*` 的覆盖范围 —— 立刻重装
			clearCasbinCache();
			return toMenu(await getMenuRow(id));
		}),

	delete: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		// 这一行就是删除过程要操作的目标,故意**不带** `alive()` —— 要拿它当前的 `path` 写墓碑让位
		const row = await getMenuRow(input.id, true);
		// 子菜单护栏只数**活着**的子菜单:已软删的子菜单不该把父菜单永久锁死
		const children = await db
			.select({ id: sysMenu.id })
			.from(sysMenu)
			.where(and(eq(sysMenu.parent_id, input.id), alive(sysMenu)));
		if (children.length > 0) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `它下面还有 ${children.length} 个菜单,请先删子菜单(避免误删整枝)`,
			});
		}
		// 这个菜单上的角色授权要显式清掉 —— `sys_role_menu` 连同它的 cascade 外键一起没了,
		// 现在授权是 `sys_casbin_rule` 的行(没有外键可依),必须自己按 `menu:<id>` 清
		await removeMenuPolicies(input.id);
		// 行**软删**(审计留痕:谁在什么时候删了哪个菜单),不是真删;
		// `path` 上有唯一索引,用 `tombstone()` 改成墓碑值让位 —— 否则那个路由被死行永久占住,再也建不回来
		await db
			.update(sysMenu)
			.set({ ...softDeleted(), path: tombstone(row.path, row.id, 128) })
			.where(eq(sysMenu.id, input.id));
		clearCasbinCache();
		return { success: true };
	}),
});
