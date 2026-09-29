/**
 * 角色路由 —— 读写 `sys_role`(全局定义)+ `casbin_rule`(授权 `p` 行与成员 `g` 行)。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | 全部角色 + **成员数**(删除前能看出"还有人用着") |
 * | `create` | mutation | 新增;`code` 重复回 `CONFLICT` |
 * | `update` | mutation | 改名 / 标识 / 启停 / 说明(`code` 重复同样拦) |
 * | `remove` | mutation | 删除;**还有人挂在这个角色上时拒绝** |
 * | `menuIds` | query | 这个角色勾了哪些菜单 / 按钮(授权树的选中态) |
 * | `setMenus` | mutation | 覆盖式保存授权 —— **落库前补全祖先链**(见下) |
 *
 * 角色为什么是**全局定义**而不是"每个部门各建一套":后者会让角色行数 = 部门数 × 角色种类
 * (上海管理员 / 武汉管理员 / …)。全局定义 + 分配时带部门(`sys_user_dept.role_id`),
 * 4 种角色在 100 个部门里也只有 4 行。
 *
 * ⚠️ 策略表里的主体是**角色 code**(`role:<code>`)不是角色 id —— 所以下面每处都要先把
 * `roleId` 落回 `sys_role` 拿 `code`,再调 `lib/casbin.ts` 的领域函数。
 */

import { TRPCError } from "@trpc/server";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDept, sysRole, sysUser, sysUserDept } from "#/db/data-base-schema";
import {
	addUserRole,
	clearCasbinCache,
	grantedMenuIdsOf,
	memberCountsByRole,
	removeRoleEverywhere,
	removeUserRole,
	renameRolePolicies,
	setRoleMenus,
	userIdsOfRole,
} from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { withAncestorIds } from "#/lib/rbac";
import { createTRPCRouter, protectedProcedure } from "../init";

function toRoleRow(row: typeof sysRole.$inferSelect, memberCount = 0) {
	return {
		id: row.id,
		code: row.code,
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
	list: protectedProcedure.query(async () => {
		const roles = await db.select().from(sysRole).orderBy(asc(sysRole.sort), asc(sysRole.name));
		// 一次查完所有角色的成员数,别在循环里逐条 count(N+1)。
		// 键是**角色 code** —— 策略表的 `g` 行里存的是 code,不是角色 id
		const counts = await memberCountsByRole();
		return roles.map((row) => toRoleRow(row, counts.get(row.code) ?? 0));
	}),

	create: protectedProcedure
		.input(
			z.object({
				code: z.string().min(1, "角色标识不能为空").max(64),
				name: z.string().min(1, "角色名不能为空").max(32),
				/** 不传 = 自动排到最后 */
				sort: z.number().int().optional(),
				remark: z.string().max(255).nullable().default(null),
			}),
		)
		.mutation(async ({ input }) => {
			const code = input.code.trim();
			await assertCodeFree(code);
			const id = newId();
			// 不传 sort 就排到最后(表单留空时的默认);传了就用传的
			const roles = await db.select({ sort: sysRole.sort }).from(sysRole);
			const sort = input.sort ?? roles.reduce((max, row) => Math.max(max, Number(row.sort ?? 0)), -1) + 1;
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

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				code: z.string().min(1, "角色标识不能为空").max(64),
				name: z.string().min(1, "角色名不能为空").max(32),
				sort: z.number().int().optional(),
				status: z.boolean(),
				remark: z.string().max(255).nullable().default(null),
			}),
		)
		.mutation(async ({ input }) => {
			const before = await getRoleRow(input.id);
			const code = input.code.trim();
			await assertCodeFree(code, input.id);
			await db.transaction(async (tx) => {
				await tx
					.update(sysRole)
					.set({
						code,
						name: input.name.trim(),
						...(input.sort !== undefined ? { sort: input.sort } : {}),
						status: input.status ? 1 : 0,
						remark: input.remark?.trim() || null,
						update_time: new Date(),
					})
					.where(eq(sysRole.id, input.id));
				// code 变了就得把策略表里认它的行一起搬(主体串里嵌的是 code,不是 id)—— 同一个事务,搬一半不如不搬
				await renameRolePolicies(before.code, code, tx);
			});
			// `renameRolePolicies` 只在 code 真变了时才刷;而 `status` 改了同样会改变装载结果,统一再刷一次
			clearCasbinCache();
			return toRoleRow(await getRoleRow(input.id));
		}),

	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		const row = await getRoleRow(input.id);
		// 引用检查走**角色 code**(策略表里存的是它)
		const used = await userIdsOfRole(row.code);
		if (used.length > 0) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `还有 ${used.length} 个用户在用「${row.name}」,请先给他们换成别的角色`,
			});
		}
		// 授权行与成员行本来靠外键 cascade 随角色一起删;策略表不是关系表、没有外键可依,必须显式清
		await removeRoleEverywhere(row.code);
		await db.delete(sysRole).where(eq(sysRole.id, input.id));
		return { success: true };
	}),

	/**
	 * 这个角色下的人 —— 和部门那边的「成员」是同一件事的两面:部门看"谁在这个部门",这里看"谁有这个角色"。
	 *
	 * 顺带带出每个人的**部门**:角色是全局的,光有姓名没法消歧(重名 / 不知道这人是谁),
	 * 部门才是"这个人是谁"的主要线索。
	 */
	users: protectedProcedure.input(z.object({ roleId: z.string().min(1) })).query(async ({ input }) => {
		const role = await getRoleRow(input.roleId);
		// 成员关系在策略表的 `g` 行里,存的是角色 **code** —— 先落回 code,再拿它去查人
		const userIds = await userIdsOfRole(role.code);
		if (userIds.length === 0) return [];

		const rows = await db
			.select({ userId: sysUser.id, userName: sysUser.name, userEmail: sysUser.email })
			.from(sysUser)
			.where(inArray(sysUser.id, userIds))
			.orderBy(asc(sysUser.name));

		const deptRows = await db
			.select({ userId: sysUserDept.user_id, deptName: sysDept.name })
			.from(sysUserDept)
			.innerJoin(sysDept, eq(sysDept.id, sysUserDept.department_id))
			.where(inArray(sysUserDept.user_id, userIds));
		const deptsOf = new Map<string, string[]>();
		for (const row of deptRows) {
			const list = deptsOf.get(row.userId) ?? [];
			list.push(row.deptName ?? "");
			deptsOf.set(row.userId, list);
		}
		return rows.map((row) => ({
			// `id` 就用 userId:列表里一行就是"一个人",不再有独立的关联行 id(旧表那一列已随表删掉)
			id: row.userId,
			userId: row.userId,
			userName: row.userName ?? "",
			userEmail: row.userEmail ?? "",
			departmentNames: deptsOf.get(row.userId) ?? [],
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
			const [role] = await db
				.select({ id: sysRole.id, code: sysRole.code })
				.from(sysRole)
				.where(eq(sysRole.id, input.roleId))
				.limit(1);
			if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "这个角色不存在" });
			const [user] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.id, input.userId)).limit(1);
			if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "这个用户不存在" });

			// 「先查再插」的幂等收在 `addUserRole` 里(那里同样不用 `on duplicate key update` —— 达梦不认)
			await addUserRole(input.userId, role.code);
			return { success: true };
		}),

	removeUser: protectedProcedure
		.input(z.object({ roleId: z.string().min(1), userId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			// 角色不存在时**静默成功**(与旧行为一致:那时是一条 delete 匹配不到行);存在才落回 code 去摘
			const [role] = await db
				.select({ id: sysRole.id, code: sysRole.code })
				.from(sysRole)
				.where(eq(sysRole.id, input.roleId))
				.limit(1);
			if (role) await removeUserRole(input.userId, role.code);
			return { success: true };
		}),

	menuIds: protectedProcedure.input(z.object({ roleId: z.string().min(1) })).query(async ({ input }) => {
		const role = await getRoleRow(input.roleId);
		return grantedMenuIdsOf(role.code);
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
			const role = await getRoleRow(input.roleId);
			const ids = await withAncestorIds([...new Set(input.menuIds)]);
			await setRoleMenus(role.code, ids);
			return { count: ids.length };
		}),
});
