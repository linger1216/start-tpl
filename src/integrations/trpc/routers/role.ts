/**
 * 角色路由 —— 读写 `sys_role`(全局定义)+ `sys_casbin_rule`(授权 `p` 行与成员 `g` 行)。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | 全部角色 + **成员数**(删除前能看出"还有人用着") |
 * | `create` | mutation | 新增 |
 * | `import` | mutation | 从 Excel 批量导入 —— **按角色名 upsert**(复用「新增」权限点) |
 * | `update` | mutation | 改名 / 启停 / 说明 |
 * | `remove` | mutation | 删除(**软删**);**还有人挂在这个角色上时拒绝** |
 * | `menuIds` | query | 这个角色勾了哪些菜单 / 按钮(授权树的选中态) |
 * | `setMenus` | mutation | 覆盖式保存授权 —— **落库前补全祖先链**(见下) |
 *
 * 角色为什么是**全局定义**而不是"每个部门各建一套":后者会让角色行数 = 部门数 × 角色种类
 * (上海管理员 / 武汉管理员 / …)。全局定义 + 分配时带部门(`sys_user_dept.role_id`),
 * 4 种角色在 100 个部门里也只有 4 行。
 *
 * `sys_role` 没有 `code` 列 —— 策略表里的主体是**角色 id**(`role:<id>`),直接拿 id 就能调 `lib/casbin.ts`。
 */

import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDept, sysRole, sysUser, sysUserDept } from "#/db/data-base-schema";
import {
	addUserRole,
	clearCasbinCache,
	grantedMenuIdsOf,
	memberCountsOfRole,
	removeRoleEverywhere,
	removeUserRole,
	setRoleMenus,
	userIdsOfRole,
} from "#/lib/casbin";
import type { ImportOutcome } from "#/lib/excel";
import { newId } from "#/lib/ids";
import { withAncestorIds } from "#/lib/rbac";
import { alive, softDeleted, tombstone } from "#/lib/soft-delete";
import { createTRPCRouter, protectedProcedure } from "../init";

function toRole(row: typeof sysRole.$inferSelect, memberCount = 0) {
	return {
		id: row.id,
		name: row.name,
		sort: Number(row.sort ?? 0),
		status: Number(row.status ?? 1),
		remark: row.remark ?? null,
		createTime: row.create_time ? row.create_time.toISOString() : null,
		updateTime: row.update_time ? row.update_time.toISOString() : null,
		memberCount,
	};
}

async function getRoleRow(id: string) {
	// 故意**不带** `alive()`:它也是 `remove` 的删除目标,软删过的行同样要取得到(存在性校验的口径不变)
	const [row] = await db.select().from(sysRole).where(eq(sysRole.id, id)).limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这个角色不存在(可能已被删除)" });
	return row;
}

/** `name` 是界面上唯一可挑的入参关键字 —— 没有 `code` 列了,这里就是唯一性判据 */
async function assertRoleNameUnique(name: string, excludeRoleId?: string) {
	// 查重只看活着的角色:软删角色的名字已被 `tombstone()` 让位,那个名字必须能重新启用
	const rows = await db
		.select({ id: sysRole.id })
		.from(sysRole)
		.where(and(eq(sysRole.name, name), alive(sysRole)));
	const clash = rows.find((row) => row.id !== excludeRoleId);
	if (clash) {
		throw new TRPCError({ code: "CONFLICT", message: `角色名「${name}」已被占用` });
	}
}

export const roleRouter = createTRPCRouter({
	list: protectedProcedure.query(async () => {
		// 读路径必须带 `alive()`:软删的角色留在库里只为审计留痕,不能出现在角色台账 / 下拉里
		const roles = await db.select().from(sysRole).where(alive(sysRole)).orderBy(asc(sysRole.sort), asc(sysRole.name));
		// 一次查完所有角色的成员数,别在循环里逐条 count(N+1)。
		// 键是**角色 id** —— 策略表的 `g` 行里存的是 `role:<id>`,与 `sys_role.id` 一致
		const counts = await memberCountsOfRole();
		return roles.map((row) => toRole(row, counts.get(row.id) ?? 0));
	}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1, "角色名不能为空").max(32),
				sort: z.number().int().optional(),
				remark: z.string().max(255).nullable().default(null),
			}),
		)
		.mutation(async ({ input }) => {
			const name = input.name.trim();
			await assertRoleNameUnique(name);
			const id = newId();
			// 不传 sort 就排到最后(表单留空时的默认);传了就用传的。算 max 时只看活着的角色
			const roles = await db.select({ sort: sysRole.sort }).from(sysRole).where(alive(sysRole));
			const sort = input.sort ?? roles.reduce((max, row) => Math.max(max, Number(row.sort ?? 0)), -1) + 1;
			await db.insert(sysRole).values({
				id,
				name,
				sort,
				status: 1,
				remark: input.remark?.trim() || null,
				create_time: new Date(),
				update_time: new Date(),
			});
			return toRole(await getRoleRow(id));
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1, "角色名不能为空").max(32),
				sort: z.number().int().optional(),
				status: z.boolean(),
				remark: z.string().max(255).nullable().default(null),
			}),
		)
		.mutation(async ({ input }) => {
			const name = input.name.trim();
			await assertRoleNameUnique(name, input.id);
			await db
				.update(sysRole)
				.set({
					name,
					...(input.sort !== undefined ? { sort: input.sort } : {}),
					status: input.status ? 1 : 0,
					remark: input.remark?.trim() || null,
					update_time: new Date(),
				})
				.where(eq(sysRole.id, input.id));

			// id 是 nanoid 不可改,改 name/status 不会动到策略表;但 status 改了会改变装载结果,统一刷一次
			clearCasbinCache();
			return toRole(await getRoleRow(input.id));
		}),

	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		const row = await getRoleRow(input.id);
		// 引用检查走**角色 id**(策略表里存的是 `role:<id>`)
		const used = await userIdsOfRole(row.id);
		if (used.length > 0) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `还有 ${used.length} 个用户在用「${row.name}」,请先给他们换成别的角色`,
			});
		}
		// 授权行与成员行本来靠外键 cascade 随角色一起删;策略表不是关系表、没有外键可依,必须显式清
		await removeRoleEverywhere(row.id);
		// 角色行**软删**(审计留痕)+ 角色名墓碑:`uk_sys_role_name` 是唯一索引,不让位的话
		// 「测试角色」这个名字会被死行永久占住,管理员再也建不出同名角色
		await db
			.update(sysRole)
			.set({ ...softDeleted(), name: tombstone(row.name, row.id, 32) })
			.where(eq(sysRole.id, input.id));
		return { success: true };
	}),

	/**
	 * 角色 Excel 导入 —— **按角色名 upsert**(角色名是业务键,`sys_role` 上只有 `id` 是主键)。
	 *
	 * | 情况 | 行为 |
	 * | --- | --- |
	 * | 库里没有这个角色名 | 建;排序列留空就排到最后,状态列留空默认「启用」 |
	 * | 库里已有 | 改排序 / 状态 / 备注(**留空的单元格不动库里的值**);和库里完全一样 → `duplicates` |
	 * | 同一批里名字重复 | 第 2 条起报错(只导入第一条) |
	 *
	 * 列契约与表头在 `#/components/modules/settings/settings-roles-excel.ts`;导出的文件能直接回导。
	 * 权限点复用「新增角色」(`sys:role:add`):导入本质就是批量新增,不另造新码(见 `lib/rbac.ts` 文件头)。
	 */
	import: protectedProcedure
		.input(
			z.object({
				rows: z.array(z.record(z.string(), z.string())).min(1, "没有可导入的行").max(2000, "一次最多导入 2000 行"),
			}),
		)
		.mutation(async ({ input }) => {
			type Parsed = { name: string; sort: number | null; status: number | null; remark: string | null; index: number };
			const result: ImportOutcome = { total: input.rows.length, created: 0, errors: [], duplicates: [] };

			/** 状态列认「启用 / 停用」「1 / 0」「true / false」「是 / 否」;空串 = 不动 */
			const parseStatus = (raw: string): number | null | "bad" => {
				const text = raw.trim().toLowerCase();
				if (!text) return null;
				if (["启用", "1", "true", "是", "yes"].includes(text)) return 1;
				if (["停用", "0", "false", "否", "no"].includes(text)) return 0;
				return "bad";
			};

			// ① 逐行校验(不碰数据库,一次把错误报全)
			const parsed: Parsed[] = [];
			const seen = new Set<string>();
			input.rows.forEach((row, index) => {
				const name = (row.name ?? "").trim();
				const rawSort = (row.sort ?? "").trim();
				const rawStatus = (row.status ?? "").trim();
				const remark = (row.remark ?? "").trim();

				if (!name) {
					result.errors.push({ index, message: "缺少「角色名」" });
					return;
				}
				if (name.length > 32) {
					result.errors.push({ index, message: "「角色名」最长 32 字符" });
					return;
				}
				if (seen.has(name)) {
					result.errors.push({ index, message: `同一批里「${name}」出现了多次,只导入第一条` });
					return;
				}
				let sort: number | null = null;
				if (rawSort) {
					const value = Number(rawSort);
					if (!Number.isInteger(value) || value < 0) {
						result.errors.push({ index, message: "「排序」要填非负整数" });
						return;
					}
					sort = value;
				}
				const status = parseStatus(rawStatus);
				if (status === "bad") {
					result.errors.push({ index, message: "「状态」只能填 启用 / 停用(或 1 / 0)" });
					return;
				}
				if (remark.length > 255) {
					result.errors.push({ index, message: "「备注」最长 255 字符" });
					return;
				}
				seen.add(name);
				parsed.push({ name, sort, status, remark: remark || null, index });
			});
			if (parsed.length === 0) return result;

			// ② 一次读出全部**活着**的角色(角色是配置表,量小),按角色名索引
			// 软删角色已被 tombstone 改名,不能参与 upsert —— 否则会把新数据写进已删行
			const existing = await db.select().from(sysRole).where(alive(sysRole));
			const byName = new Map(existing.map((row) => [row.name, row]));
			let maxSort = existing.reduce((max, row) => Math.max(max, Number(row.sort ?? 0)), -1);

			// ③ 逐行落库
			let changed = false;
			for (const row of parsed) {
				const current = byName.get(row.name);
				if (!current) {
					maxSort += 1;
					await db.insert(sysRole).values({
						id: newId(),
						name: row.name,
						sort: row.sort ?? maxSort,
						status: row.status ?? 1,
						remark: row.remark,
						create_time: new Date(),
						update_time: new Date(),
					});
					changed = true;
					result.created += 1;
					continue;
				}
				const nextSort = row.sort ?? Number(current.sort ?? 0);
				const nextStatus = row.status ?? Number(current.status ?? 1);
				const nextRemark = row.remark ?? current.remark ?? null;
				if (
					nextSort === Number(current.sort ?? 0) &&
					nextStatus === Number(current.status ?? 1) &&
					nextRemark === (current.remark ?? null)
				) {
					result.duplicates.push({ index: row.index, message: "和库里一样,没有改动" });
					continue;
				}
				await db
					.update(sysRole)
					.set({ sort: nextSort, status: nextStatus, remark: nextRemark, update_time: new Date() })
					.where(eq(sysRole.id, current.id));
				changed = true;
				result.created += 1;
			}

			// 状态改了会影响装载结果(停用的角色不贡献权限),统一刷一次 —— 与 `update` 同一个理由
			if (changed) clearCasbinCache();

			// 校验分两趟跑,回执按行号排一下 —— 对话框是按「第 N 行」逐条列的
			result.errors.sort((a, b) => a.index - b.index);
			result.duplicates.sort((a, b) => a.index - b.index);
			return result;
		}),

	/**
	 * 这个角色下的人 —— 和部门那边的「成员」是同一件事的两面:部门看"谁在这个部门",这里看"谁有这个角色"。
	 *
	 * 顺带带出每个人的**部门**:角色是全局的,光有姓名没法消歧(重名 / 不知道这人是谁),
	 * 部门才是"这个人是谁"的主要线索。
	 */
	users: protectedProcedure.input(z.object({ roleId: z.string().min(1) })).query(async ({ input }) => {
		await getRoleRow(input.roleId);
		// 成员关系在策略表的 `g` 行里,存的就是角色 id —— 直接拿 input.roleId 去查人
		const userIds = await userIdsOfRole(input.roleId);
		if (userIds.length === 0) return [];

		// join 出来的 sys_user 要过 `alive()`:软删用户不能继续算这个角色的成员
		const users = await db
			.select({ userId: sysUser.id, userName: sysUser.name, userEmail: sysUser.email })
			.from(sysUser)
			.where(and(inArray(sysUser.id, userIds), alive(sysUser)))
			.orderBy(asc(sysUser.name));

		const userDeptRows = await db
			.select({ userId: sysUserDept.user_id, deptName: sysDept.name })
			.from(sysUserDept)
			.innerJoin(sysDept, eq(sysDept.id, sysUserDept.department_id))
			.where(and(inArray(sysUserDept.user_id, userIds), alive(sysDept)));
		const deptNamesByUser = new Map<string, string[]>();
		for (const row of userDeptRows) {
			const list = deptNamesByUser.get(row.userId) ?? [];
			list.push(row.deptName ?? "");
			deptNamesByUser.set(row.userId, list);
		}
		return users.map((user) => ({
			// `id` 就用 userId:列表里一行就是"一个人",不再有独立的关联行 id(旧表那一列已随表删掉)
			id: user.userId,
			userId: user.userId,
			userName: user.userName ?? "",
			userEmail: user.userEmail ?? "",
			departmentNames: deptNamesByUser.get(user.userId) ?? [],
		}));
	}),

	/**
	 * 给这个角色加一个人(幂等)。
	 *
	 * 用"先查再插"而不是 `on duplicate key update`:那是 MySQL 方言,达梦不认
	 * (部门那边的 addMember 是同一个理由)。
	 */
	addUser: protectedProcedure
		.input(z.object({ roleId: z.string().min(1), userId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			await getRoleRow(input.roleId);
			// 只认活着的用户:软删的人不能再挂新角色(否则等于给已注销账号重新发权限)
			const [user] = await db
				.select({ id: sysUser.id })
				.from(sysUser)
				.where(and(eq(sysUser.id, input.userId), alive(sysUser)))
				.limit(1);
			if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "这个用户不存在" });

			// 「先查再插」的幂等收在 `addUserRole` 里(那里同样不用 `on duplicate key update` —— 达梦不认)
			await addUserRole(input.userId, input.roleId);
			return { success: true };
		}),

	removeUser: protectedProcedure
		.input(z.object({ roleId: z.string().min(1), userId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			// 角色不存在时**静默成功**(与旧行为一致:那时是一条 delete 匹配不到行);存在才落 id 去摘。
			// 软删角色同样算「不存在」—— 它的授权已被 `removeRoleEverywhere` 清干净,再摘也是空操作
			const [role] = await db
				.select({ id: sysRole.id })
				.from(sysRole)
				.where(and(eq(sysRole.id, input.roleId), alive(sysRole)))
				.limit(1);
			if (role) await removeUserRole(input.userId, input.roleId);
			return { success: true };
		}),

	menuIds: protectedProcedure.input(z.object({ roleId: z.string().min(1) })).query(async ({ input }) => {
		await getRoleRow(input.roleId);
		return grantedMenuIdsOf(input.roleId);
	}),

	/**
	 * 覆盖式保存授权(勾选结果)。
	 *
	 * ⚠️ **落库前补全祖先链**:只勾了一个深层的子菜单、父节点没授权,侧边栏是按 `parentId`
	 * 拼树的 —— 那一枝无处安放,结果是"勾了却看不见"。写入时补(`withAncestorIds`),
	 * 装载时(`lib/casbin.ts` 的 `loadPolicy`)还会再兜一次 —— 两处同口径,不是两套规则。
	 */
	setMenus: protectedProcedure
		.input(z.object({ roleId: z.string().min(1), menuIds: z.array(z.string().min(1)) }))
		.mutation(async ({ input }) => {
			await getRoleRow(input.roleId);
			const ids = await withAncestorIds([...new Set(input.menuIds)]);
			await setRoleMenus(input.roleId, ids);
			return { count: ids.length };
		}),
});
