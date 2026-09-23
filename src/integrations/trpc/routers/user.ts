/**
 * 用户路由 —— **只读** `sys_user`(Better Auth 的表,我们不改它)+ 读写部门/角色分配。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | 用户台账(id / 姓名 / 邮箱 / 注册时间) |
 * | `assignments` | query | 这个人在哪些部门、各是什么角色 |
 * | `setAssignments` | mutation | 覆盖式保存:(部门, 角色) 列表 |
 *
 * 为什么**不在这里建/改/删用户**:账号体系归 Better Auth(密码哈希、会话、第三方登录都它管)。
 * 新增用户走 BA 自己的接口(见 AGENTS「不开放自注册」那节的脚本),这里只管**授权**。
 */

import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDepartment, sysDepartmentMember, sysRole, sysUser } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { createTRPCRouter, publicProcedure } from "../init";

export const userRouter = createTRPCRouter({
	/**
	 * 用户台账 —— 带上每个人的**部门 / 角色分配**(表格里要显示,统计卡也要用)。
	 *
	 * 一次查完所有分配再按 user 归组,**别在循环里逐人查**(N+1)。
	 */
	list: publicProcedure.query(async () => {
		const users = await db.select().from(sysUser).orderBy(asc(sysUser.name), asc(sysUser.email));
		const grants = await db
			.select({
				userId: sysDepartmentMember.user_id,
				departmentName: sysDepartment.name,
				roleName: sysRole.name,
			})
			.from(sysDepartmentMember)
			.innerJoin(sysDepartment, eq(sysDepartment.id, sysDepartmentMember.department_id))
			.innerJoin(sysRole, eq(sysRole.id, sysDepartmentMember.role_id));
		const byUser = new Map<string, Array<{ departmentName: string; roleName: string }>>();
		for (const grant of grants) {
			const list = byUser.get(grant.userId) ?? [];
			list.push({ departmentName: grant.departmentName, roleName: grant.roleName });
			byUser.set(grant.userId, list);
		}
		return users.map((row) => ({
			id: row.id,
			name: row.name ?? "",
			email: row.email,
			assignments: byUser.get(row.id) ?? [],
		}));
	}),

	/** 这个人所有的 (部门, 角色) —— 一人可跨多个部门,每部门一个角色 */
	assignments: publicProcedure.input(z.object({ userId: z.string().min(1) })).query(async ({ input }) => {
		const rows = await db
			.select({
				departmentId: sysDepartmentMember.department_id,
				departmentName: sysDepartment.name,
				roleId: sysDepartmentMember.role_id,
				roleName: sysRole.name,
			})
			.from(sysDepartmentMember)
			.innerJoin(sysDepartment, eq(sysDepartment.id, sysDepartmentMember.department_id))
			.innerJoin(sysRole, eq(sysRole.id, sysDepartmentMember.role_id))
			.where(eq(sysDepartmentMember.user_id, input.userId))
			.orderBy(asc(sysDepartment.sort), asc(sysDepartment.name));
		return rows;
	}),

	/**
	 * 覆盖式保存这个人的分配。
	 *
	 * 语义:传进来的列表就是**最终状态** —— 不在列表里的旧分配删掉,其余的插入/改角色。
	 * (同一部门只会有一条,靠 `uk_sys_dm_unique(department_id, user_id)` 保证。)
	 */
	setAssignments: publicProcedure
		.input(
			z.object({
				userId: z.string().min(1),
				items: z.array(z.object({ departmentId: z.string().min(1), roleId: z.string().min(1) })),
			}),
		)
		.mutation(async ({ input }) => {
			const [user] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.id, input.userId)).limit(1);
			if (!user) return { success: false, count: 0 };

			// 按部门去重(同一部门传两条时,后一条赢 —— 与唯一键的语义一致)
			const byDepartment = new Map(input.items.map((item) => [item.departmentId, item.roleId]));
			const departmentIds = [...byDepartment.keys()];
			const roleIds = [...new Set(byDepartment.values())];

			const existing = await db
				.select({
					id: sysDepartmentMember.id,
					departmentId: sysDepartmentMember.department_id,
					roleId: sysDepartmentMember.role_id,
				})
				.from(sysDepartmentMember)
				.where(eq(sysDepartmentMember.user_id, input.userId));
			const knownDepartments = departmentIds.length
				? new Set(
						(
							await db
								.select({ id: sysDepartment.id })
								.from(sysDepartment)
								.where(inArray(sysDepartment.id, departmentIds))
						).map((row) => row.id),
					)
				: new Set<string>();
			const knownRoles = roleIds.length
				? new Set(
						(await db.select({ id: sysRole.id }).from(sysRole).where(inArray(sysRole.id, roleIds))).map(
							(row) => row.id,
						),
					)
				: new Set<string>();

			// 校验放在事务外、且**显式报错**:静默跳过未知 id 会让调用方以为"保存成功了"
			const unknownDepartments = departmentIds.filter((id) => !knownDepartments.has(id));
			if (unknownDepartments.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `这些部门不存在(可能刚被删掉):${unknownDepartments.join("、")}`,
				});
			}
			const unknownRoles = roleIds.filter((id) => !knownRoles.has(id));
			if (unknownRoles.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `这些角色不存在(可能刚被删掉):${unknownRoles.join("、")}`,
				});
			}

			await db.transaction(async (tx) => {
				// ① 删掉不在最终列表里的
				const drop = existing.filter((row) => !byDepartment.has(row.departmentId));
				for (const row of drop) await tx.delete(sysDepartmentMember).where(eq(sysDepartmentMember.id, row.id));
				// ② 插入 / 改角色
				for (const [departmentId, roleId] of byDepartment) {
					const hit = existing.find((row) => row.departmentId === departmentId);
					if (hit) {
						if (hit.roleId !== roleId) {
							await tx
								.update(sysDepartmentMember)
								.set({ role_id: roleId, update_time: new Date() })
								.where(eq(sysDepartmentMember.id, hit.id));
						}
						continue;
					}
					await tx.insert(sysDepartmentMember).values({
						id: newId(),
						department_id: departmentId,
						user_id: input.userId,
						role_id: roleId,
						create_time: new Date(),
						update_time: new Date(),
					});
				}
			});
			return { success: true, count: byDepartment.size };
		}),
});
