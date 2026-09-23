/**
 * 角色路由 —— 读写 `sys_role`(全局定义)+ `sys_role_menu`(授权)。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | 全部角色 + **成员数**(删除前能看出"还有人用着") |
 * | `create` | mutation | 新增;`code` 重复回 `CONFLICT` |
 * | `update` | mutation | 改名 / 标识 / 启停 / 说明(`code` 重复同样拦) |
 * | `remove` | mutation | 删除;**还有部门成员挂在这个角色上时拒绝** |
 * | `menuIds` | query | 这个角色勾了哪些菜单 / 按钮(授权树的选中态) |
 * | `setMenus` | mutation | 覆盖式保存授权 —— **落库前补全祖先链**(见下) |
 *
 * 角色为什么是**全局定义**而不是"每个部门各建一套":后者会让角色行数 = 部门数 × 角色种类
 * (上海管理员 / 武汉管理员 / …)。全局定义 + 分配时带部门(`sys_department_member.role_id`),
 * 4 种角色在 100 个部门里也只有 4 行。
 */

import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDepartmentMember, sysRole, sysRoleMenu } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { withAncestorIds } from "#/lib/rbac";
import { createTRPCRouter, publicProcedure } from "../init";

function toRoleRow(row: typeof sysRole.$inferSelect, memberCount = 0) {
	return {
		id: row.id,
		code: row.code,
		name: row.name,
		sort: Number(row.sort ?? 0),
		status: Number(row.status ?? 1),
		remark: row.remark ?? null,
		memberCount,
	};
}

async function getRoleRow(id: string) {
	const [row] = await db.select().from(sysRole).where(eq(sysRole.id, id)).limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这个角色不存在(可能已被删除)" });
	return row;
}

/** `code` 是程序里认的标识(如 `sys_admin`),必须唯一 */
async function assertCodeFree(code: string, selfId?: string) {
	const rows = await db
		.select({ id: sysRole.id, name: sysRole.name })
		.from(sysRole)
		.where(selfId ? sql`${sysRole.code} = ${code} and ${sysRole.id} <> ${selfId}` : eq(sysRole.code, code));
	if (rows.length > 0) {
		throw new TRPCError({ code: "CONFLICT", message: `标识「${code}」已被角色「${rows[0]?.name}」占用` });
	}
}

export const roleRouter = createTRPCRouter({
	list: publicProcedure.query(async () => {
		const roles = await db.select().from(sysRole).orderBy(asc(sysRole.sort), asc(sysRole.name));
		// 一次查完所有角色的成员数,别在循环里逐条 count(N+1)
		const counts = await db
			.select({ roleId: sysDepartmentMember.role_id, n: sql<number>`count(*)` })
			.from(sysDepartmentMember)
			.groupBy(sysDepartmentMember.role_id);
		const countOf = new Map(counts.map((row) => [row.roleId, Number(row.n ?? 0)]));
		return roles.map((row) => toRoleRow(row, countOf.get(row.id) ?? 0));
	}),

	create: publicProcedure
		.input(
			z.object({
				code: z.string().min(1, "角色标识不能为空").max(64),
				name: z.string().min(1, "角色名不能为空").max(32),
				remark: z.string().max(255).nullable().default(null),
			}),
		)
		.mutation(async ({ input }) => {
			const code = input.code.trim();
			await assertCodeFree(code);
			const id = newId();
			const roles = await db.select({ sort: sysRole.sort }).from(sysRole);
			const sort = roles.reduce((max, row) => Math.max(max, Number(row.sort ?? 0)), -1) + 1;
			await db.insert(sysRole).values({
				id,
				code,
				name: input.name.trim(),
				sort,
				status: 1,
				remark: input.remark?.trim() || null,
				create_time: new Date(),
				update_time: new Date(),
			});
			return toRoleRow(await getRoleRow(id));
		}),

	update: publicProcedure
		.input(
			z.object({
				id: z.string().min(1),
				code: z.string().min(1, "角色标识不能为空").max(64),
				name: z.string().min(1, "角色名不能为空").max(32),
				status: z.boolean(),
				remark: z.string().max(255).nullable().default(null),
			}),
		)
		.mutation(async ({ input }) => {
			await getRoleRow(input.id);
			const code = input.code.trim();
			await assertCodeFree(code, input.id);
			await db
				.update(sysRole)
				.set({
					code,
					name: input.name.trim(),
					status: input.status ? 1 : 0,
					remark: input.remark?.trim() || null,
					update_time: new Date(),
				})
				.where(eq(sysRole.id, input.id));
			return toRoleRow(await getRoleRow(input.id));
		}),

	remove: publicProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		const row = await getRoleRow(input.id);
		const used = await db
			.select({ id: sysDepartmentMember.id })
			.from(sysDepartmentMember)
			.where(eq(sysDepartmentMember.role_id, input.id));
		if (used.length > 0) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `还有 ${used.length} 个部门成员在用「${row.name}」,请先给他们换成别的角色`,
			});
		}
		// 授权行随角色一起删(sys_role_menu.role_id 是 cascade,这里显式删是为了两个方言一致)
		await db.delete(sysRoleMenu).where(eq(sysRoleMenu.role_id, input.id));
		await db.delete(sysRole).where(eq(sysRole.id, input.id));
		return { success: true };
	}),

	menuIds: publicProcedure.input(z.object({ roleId: z.string().min(1) })).query(async ({ input }) => {
		const rows = await db
			.select({ menuId: sysRoleMenu.menu_id })
			.from(sysRoleMenu)
			.where(eq(sysRoleMenu.role_id, input.roleId));
		return rows.map((row) => row.menuId);
	}),

	/**
	 * 覆盖式保存授权(勾选结果)。
	 *
	 * ⚠️ **落库前补全祖先链**:只勾了一个深层的子菜单、父节点没授权,侧边栏是按 `parentId`
	 * 拼树的 —— 那一枝无处安放,结果是"勾了却看不见"。写入时补(`withAncestorIds`),
	 * 读取时(`lib/rbac.ts`)也用同一份逻辑兜底。
	 */
	setMenus: publicProcedure
		.input(z.object({ roleId: z.string().min(1), menuIds: z.array(z.string().min(1)) }))
		.mutation(async ({ input }) => {
			await getRoleRow(input.roleId);
			const ids = await withAncestorIds([...new Set(input.menuIds)]);
			await db.transaction(async (tx) => {
				await tx.delete(sysRoleMenu).where(eq(sysRoleMenu.role_id, input.roleId));
				if (ids.length === 0) return;
				const now = new Date();
				await tx.insert(sysRoleMenu).values(
					ids.map((menuId) => ({
						id: newId(),
						role_id: input.roleId,
						menu_id: menuId,
						create_time: now,
						update_time: now,
					})),
				);
			});
			return { count: ids.length };
		}),
});
