/**
 * 角色路由 —— 读写 `sys_role`(全局定义)+ `sys_casbin_rule`(授权 `p` 行与成员 `g` 行)。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | 全部角色 + **成员数**(删除前能看出"还有人用着") |
 * | `create` | mutation | 新增 |
 * | `update` | mutation | 改名 / 启停 / 说明 |
 * | `remove` | mutation | 删除;**还有人挂在这个角色上时拒绝** |
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
import { asc, eq, inArray, sql } from "drizzle-orm";
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
import { newId } from "#/lib/ids";
import { withAncestorIds } from "#/lib/rbac";
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
	const [row] = await db.select().from(sysRole).where(eq(sysRole.id, id)).limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这个角色不存在(可能已被删除)" });
	return row;
}

/** `name` 是界面上唯一可挑的入参关键字 —— 没有 `code` 列了,这里就是唯一性判据 */
async function assertRoleNameUnique(name: string, excludeRoleId?: string) {
	const rows = await db
		.select({ id: sysRole.id })
		.from(sysRole)
		.where(
			excludeRoleId ? sql`${sysRole.name} = ${name} and ${sysRole.id} <> ${excludeRoleId}` : eq(sysRole.name, name),
		);
	if (rows.length > 0) {
		throw new TRPCError({ code: "CONFLICT", message: `角色名「${name}」已被占用` });
	}
}

export const roleRouter = createTRPCRouter({
	list: protectedProcedure.query(async () => {
		const roles = await db.select().from(sysRole).orderBy(asc(sysRole.sort), asc(sysRole.name));
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
			// 不传 sort 就排到最后(表单留空时的默认);传了就用传的
			const roles = await db.select({ sort: sysRole.sort }).from(sysRole);
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

			// 为了防止status被更改, 所以要刷新一次casbin状态
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
		await getRoleRow(input.roleId);
		// 成员关系在策略表的 `g` 行里,存的就是角色 id —— 直接拿 input.roleId 去查人
		const userIds = await userIdsOfRole(input.roleId);
		if (userIds.length === 0) return [];

		const users = await db
			.select({ userId: sysUser.id, userName: sysUser.name, userEmail: sysUser.email })
			.from(sysUser)
			.where(inArray(sysUser.id, userIds))
			.orderBy(asc(sysUser.name));

		const userDeptRows = await db
			.select({ userId: sysUserDept.user_id, deptName: sysDept.name })
			.from(sysUserDept)
			.innerJoin(sysDept, eq(sysDept.id, sysUserDept.department_id))
			.where(inArray(sysUserDept.user_id, userIds));
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
			const [user] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.id, input.userId)).limit(1);
			if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "这个用户不存在" });

			// 「先查再插」的幂等收在 `addUserRole` 里(那里同样不用 `on duplicate key update` —— 达梦不认)
			await addUserRole(input.userId, input.roleId);
			return { success: true };
		}),

	removeUser: protectedProcedure
		.input(z.object({ roleId: z.string().min(1), userId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			// 角色不存在时**静默成功**(与旧行为一致:那时是一条 delete 匹配不到行);存在才落 id 去摘
			const [role] = await db.select({ id: sysRole.id }).from(sysRole).where(eq(sysRole.id, input.roleId)).limit(1);
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
