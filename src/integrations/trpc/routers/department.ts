/**
 * 部门路由 —— 读写 `sys_dept`(自关联树)+ `sys_user_dept`(成员/角色)。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `tree` | query | 全部部门行(口径同 `menu.list`:只回事实,拼树在前端) |
 * | `create` | mutation | 新增(父节点 + 名称);同级重名回 `CONFLICT` |
 * | `update` | mutation | 改名 / 启停 / **换父级**(不能挂到自己或自己的后代下) |
 * | `reorder` | mutation | **同级**重排(同 `menu.reorder` 的口径:必须给全该级的 id 顺序) |
 * | `remove` | mutation | 删除;**有子部门或有成员时拒绝** |
 * | `members` | query | 某部门的成员(带用户与角色名) |
 * | `setMemberRole` | mutation | 加人 / 改这个人在这个部门的角色(靠 `uk_sys_dm_unique` 唯一) |
 * | `removeMember` | mutation | 把某人移出这个部门 |
 *
 * 注意:这里只落"谁在哪个部门、是什么角色",不做任何行级过滤。
 */

import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDept, sysRole, sysUser, sysUserDept } from "#/db/data-base-schema";
import { allUserRoles } from "#/lib/casbin";
import { clearDeptCache } from "#/lib/data-scope-plugins";
import { newId } from "#/lib/ids";
import { createTRPCRouter, protectedProcedure } from "../init";

/** 库行 → 接口出参 */
function toDepartment(row: typeof sysDept.$inferSelect) {
	return {
		id: row.id,
		parentId: row.parent_id ?? null,
		name: row.name,
		sort: Number(row.sort ?? 0),
		status: Number(row.status ?? 1),
		remark: row.remark ?? null,
		createTime: row.create_time ? row.create_time.toISOString() : null,
		updateTime: row.update_time ? row.update_time.toISOString() : null,
	};
}

async function getDepartmentRow(id: string) {
	const [row] = await db.select().from(sysDept).where(eq(sysDept.id, id)).limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这个部门不存在(可能已被删除)" });
	return row;
}

/**
 * 同级重名校验走代码而不是唯一索引。
 *
 * 为什么:顶级部门的 `parent_id` 是 `NULL`,而 MySQL 的唯一索引**不把两个 NULL 当重复** ——
 * `unique(parent_id, name)` 对顶级节点形同虚设(半吊子约束比没有更糟,它会让人以为已经防住了)。
 */
async function assertDeptNameUnique(parentId: string | null, name: string, excludeDeptId?: string) {
	const siblings = await db
		.select({ id: sysDept.id, name: sysDept.name })
		.from(sysDept)
		.where(parentId === null ? sql`${sysDept.parent_id} is null` : eq(sysDept.parent_id, parentId));
	const clash = siblings.find((row) => row.name === name && row.id !== excludeDeptId);
	if (clash) throw new TRPCError({ code: "CONFLICT", message: `同一级下已经有叫「${name}」的部门了` });
}

/** 换父级时不能挂到自己或自己的后代下(否则树上会出现一个环) */
async function assertNotDescendant(id: string, parentId: string | null) {
	if (!parentId) return;
	if (parentId === id) throw new TRPCError({ code: "BAD_REQUEST", message: "不能把部门挂到它自己下面" });
	const rows = await db.select({ id: sysDept.id, parentId: sysDept.parent_id }).from(sysDept);
	const parentOf = new Map(rows.map((row) => [row.id, row.parentId ?? null]));
	let cursor: string | null = parentId;
	const seen = new Set<string>();
	while (cursor && !seen.has(cursor)) {
		if (cursor === id) throw new TRPCError({ code: "BAD_REQUEST", message: "不能把部门挂到它自己的下级里(会成环)" });
		seen.add(cursor);
		cursor = parentOf.get(cursor) ?? null;
	}
}

/** 同级末尾的 sort */
async function nextSort(parentId: string | null) {
	const siblings = await db
		.select({ sort: sysDept.sort })
		.from(sysDept)
		.where(parentId === null ? sql`${sysDept.parent_id} is null` : eq(sysDept.parent_id, parentId));
	return siblings.reduce((max, row) => Math.max(max, Number(row.sort ?? 0)), -1) + 1;
}

export const departmentRouter = createTRPCRouter({
	tree: protectedProcedure.query(async () => {
		const rows = await db.select().from(sysDept).orderBy(asc(sysDept.sort), asc(sysDept.name));
		return rows.map(toDepartment);
	}),

	create: protectedProcedure
		.input(
			z.object({
				parentId: z.string().nullable(),
				name: z.string().min(1, "部门名不能为空").max(64),
				remark: z.string().max(255).nullable().default(null),
			}),
		)
		.mutation(async ({ input }) => {
			const parentId = input.parentId ?? null;
			if (parentId) await getDepartmentRow(parentId);
			const name = input.name.trim();
			await assertDeptNameUnique(parentId, name);
			const id = newId();
			await db.insert(sysDept).values({
				id,
				parent_id: parentId,
				name,
				sort: await nextSort(parentId),
				status: 1,
				remark: input.remark?.trim() || null,
				create_time: new Date(),
				update_time: new Date(),
			});
			// 部门树变了 ⇒ 数据权限的部门链缓存立刻作废(否则 30 秒内算出来的可见范围还是旧的)
			clearDeptCache();
			return toDepartment(await getDepartmentRow(id));
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1, "部门名不能为空").max(64),
				parentId: z.string().nullable(),
				status: z.boolean(),
				remark: z.string().max(255).nullable().default(null),
			}),
		)
		.mutation(async ({ input }) => {
			const current = await getDepartmentRow(input.id);
			const parentId = input.parentId ?? null;
			if (parentId) {
				if (parentId !== current.parent_id) await getDepartmentRow(parentId);
				await assertNotDescendant(input.id, parentId);
			}
			const name = input.name.trim();
			await assertDeptNameUnique(parentId, name, input.id);
			await db
				.update(sysDept)
				.set({
					name,
					parent_id: parentId,
					status: input.status ? 1 : 0,
					remark: input.remark?.trim() || null,
					// 显式写 update_time:达梦不支持 DDL 的 ON UPDATE CURRENT_TIMESTAMP
					update_time: new Date(),
				})
				.where(eq(sysDept.id, input.id));
			// 改名 / 换父级都会变数据权限的部门链 ⇒ 缓存作废
			clearDeptCache();
			return toDepartment(await getDepartmentRow(input.id));
		}),

	/**
	 * 同级重排。口径与 `menu.reorder` 完全一致:传入**父节点 + 该父下全部子节点的 id 顺序**,
	 * 服务端逐行写 `sort` —— 名单里出现兄弟之外的行就拒绝(拖拽最容易出的错是跨级拖)。
	 */
	reorder: protectedProcedure
		.input(z.object({ parentId: z.string().nullable(), orderedIds: z.array(z.string().min(1)).min(1) }))
		.mutation(async ({ input }) => {
			const parentId = input.parentId ?? null;
			const siblings = await db
				.select({ id: sysDept.id })
				.from(sysDept)
				.where(parentId === null ? sql`${sysDept.parent_id} is null` : eq(sysDept.parent_id, parentId));
			const siblingIds = new Set(siblings.map((row) => row.id));
			const unknown = input.orderedIds.filter((id) => !siblingIds.has(id));
			if (unknown.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `只能在同一级内排序,以下部门不属于同一上级:${unknown.join("、")}`,
				});
			}
			if (input.orderedIds.length !== siblingIds.size) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "排序清单必须包含该级下全部部门" });
			}
			await db.transaction(async (tx) => {
				for (const [index, id] of input.orderedIds.entries()) {
					await tx.update(sysDept).set({ sort: index, update_time: new Date() }).where(eq(sysDept.id, id));
				}
			});
			return { updated: input.orderedIds.length };
		}),

	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		const row = await getDepartmentRow(input.id);
		const children = await db.select({ id: sysDept.id }).from(sysDept).where(eq(sysDept.parent_id, input.id));
		if (children.length > 0) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `它下面还有 ${children.length} 个子部门,请先处理子部门(避免误删整枝)`,
			});
		}
		const members = await db
			.select({ id: sysUserDept.id })
			.from(sysUserDept)
			.where(eq(sysUserDept.department_id, input.id));
		if (members.length > 0) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `「${row.name}」里还有 ${members.length} 个成员,请先把人移出去`,
			});
		}
		await db.delete(sysDept).where(eq(sysDept.id, input.id));
		// 部门没了 ⇒ 数据权限的部门链缓存作废
		clearDeptCache();
		return { success: true };
	}),

	/** 某部门的成员(一个部门里一人一条)。角色是**全局**的,顺带带出来只读展示。 */
	members: protectedProcedure.input(z.object({ departmentId: z.string().min(1) })).query(async ({ input }) => {
		const rows = await db
			.select({
				id: sysUserDept.id,
				userId: sysUserDept.user_id,
				userName: sysUser.name,
				userEmail: sysUser.email,
			})
			.from(sysUserDept)
			.innerJoin(sysUser, eq(sysUser.id, sysUserDept.user_id))
			.where(eq(sysUserDept.department_id, input.departmentId))
			.orderBy(asc(sysUser.name));

		const userIds = rows.map((row) => row.userId);
		// 角色成员关系在策略表的 `g` 行里(存的就是**角色 id**)—— 一次拉全再按本部门的人筛,不 N+1
		const wanted = new Set(userIds);
		const memberRows = (await allUserRoles()).filter((row) => wanted.has(row.userId));
		// 认不出的 id(角色刚被删、`g` 行还没清)跳过,与装载时「跳过孤儿菜单」同一口径
		const roleNames = new Map(
			(await db.select({ id: sysRole.id, name: sysRole.name }).from(sysRole)).map((row) => [row.id, row.name]),
		);
		const rolesOf = new Map<string, string[]>();
		for (const row of memberRows) {
			const name = roleNames.get(row.roleId);
			if (!name) continue;
			const list = rolesOf.get(row.userId) ?? [];
			list.push(name);
			rolesOf.set(row.userId, list);
		}
		return rows.map((row) => ({
			...row,
			userName: row.userName ?? "",
			userEmail: row.userEmail ?? "",
			roleNames: rolesOf.get(row.userId) ?? [],
		}));
	}),

	/**
	 * 把人加进这个部门(幂等)。
	 *
	 * **角色不在这里管** —— 角色是全局的,在「系统设置 ▸ 用户管理」里分配。
	 * 用"先查再插"而不是 `on duplicate key update`:那是 MySQL 方言,达梦不认。
	 */
	addMember: protectedProcedure
		.input(z.object({ departmentId: z.string().min(1), userId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			await getDepartmentRow(input.departmentId);
			const [user] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.id, input.userId)).limit(1);
			if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "这个用户不存在" });

			const [existing] = await db
				.select({ id: sysUserDept.id })
				.from(sysUserDept)
				.where(and(eq(sysUserDept.department_id, input.departmentId), eq(sysUserDept.user_id, input.userId)))
				.limit(1);
			if (existing) return { success: true };

			await db.insert(sysUserDept).values({
				id: newId(),
				department_id: input.departmentId,
				user_id: input.userId,
				create_time: new Date(),
				update_time: new Date(),
			});
			return { success: true };
		}),

	removeMember: protectedProcedure
		.input(z.object({ departmentId: z.string().min(1), userId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			await db
				.delete(sysUserDept)
				.where(and(eq(sysUserDept.department_id, input.departmentId), eq(sysUserDept.user_id, input.userId)));
			return { success: true };
		}),
});
