/**
 * 用户路由 —— **只读** `sys_user`(Better Auth 的表,我们不改它)+ 读写部门/角色分配。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | 用户台账(派生出全部字段) |
 * | `create` | mutation | **建账号** —— 转调 Better Auth 的 `signUpEmail`(密码哈希由它做) |
 * | `update` | mutation | 改姓名 / 邮箱(账号本身仍是 BA 的表,这里只动这两列) |
 * | `remove` | mutation | 删账号:先清会话 / account / 部门成员,再删 `sys_user`(拒绝删自己) |
 * | `assignments` | query | 这个人在哪些部门、各是什么角色 |
 *  *
 * 建账号为什么绕到 BA:**密码哈希(scrypt)、account 记录、邮箱唯一性都是它的职责**,
 * 我们自己 insert `sys_user` 只会得到一个登不进去的账号。所以这里只做三件它不管的事:
 * ① 先查重给出中文提示(BA 的报错是英文的);② 建完**立刻删掉它顺手建的那个会话**
 * (否则等于把当前登录的管理员顶掉);③ 返回我们能直接用的那几列。
 * 改 / 删用户仍然不在这里 —— 那会牵动会话与第三方登录绑定,不在这个页面的职责里。
 */

import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysAccount, sysDept, sysRole, sysSession, sysUser, sysUserDept } from "#/db/data-base-schema";
import { auth } from "#/lib/auth";
import { allUserRoles, isAdminUser, removeAllRolesOfUser, roleIdsOf, setUserRoles } from "#/lib/casbin";
import { getCurrentUserId } from "#/lib/current-user";
import { newId } from "#/lib/ids";
import { createTRPCRouter, protectedProcedure } from "../init";

export const userRouter = createTRPCRouter({
	/**
	 * 用户台账 —— 带上每个人的**部门 / 角色分配**(表格里要显示,统计卡也要用)。
	 *
	 * 一次查完所有分配再按 user 归组,**别在循环里逐人查**(N+1)。
	 */
	// list: protectedProcedure.query(async () => {
	// 	const users = await db.select().from(sysUser).orderBy(asc(sysUser.name), asc(sysUser.email));
	// 	// 「属于哪些部门」和「有哪些角色」是两件事:前者是组织架构(sys_user_dept),
	// 	// 后者是全局角色(sys_casbin_rule 的 `g` 行)。各查一次再按 user 归组,依旧不 N+1。
	// 	const userDepartmentRelations = await db
	// 		.select({
	// 			userId: sysUserDept.user_id,
	// 			departmentId: sysUserDept.department_id,
	// 			departmentName: sysDept.name,
	// 		})
	// 		.from(sysUserDept)
	// 		.innerJoin(sysDept, eq(sysDept.id, sysUserDept.department_id));
	//
	// 	// 策略表里存的就是**角色 id**(`role:<id>`),直接拿 id 回 `sys_role` 换名字(一次查全,按 id 索引)
	// 	const userRoleRelations = await allUserRoles();
	// 	const roles = await db.select({ id: sysRole.id, name: sysRole.name }).from(sysRole);
	// 	const roleMapById = new Map(roles.map((row) => [row.id, row]));
	// 	const groupBy = (rows: Array<{ userId: string; value: string }>) => {
	// 		const map = new Map<string, string[]>();
	// 		for (const row of rows) {
	// 			const list = map.get(row.userId) ?? [];
	// 			list.push(row.value);
	// 			map.set(row.userId, list);
	// 		}
	// 		return map;
	// 	};
	// 	const departmentOf = groupBy(userDepartmentRelations.map((row) => ({ userId: row.userId, value: row.departmentName })));
	// 	const departmentIdOf = groupBy(userDepartmentRelations.map((row) => ({ userId: row.userId, value: row.departmentId })));
	// 	// 认不出的 id(角色刚被删、`g` 行还没清干净)直接跳过 —— 与装载时「跳过孤儿菜单」同一口径
	// 	const known = userRoleRelations.flatMap((row) => {
	// 		const role = roleMapById.get(row.roleId);
	// 		return role ? [{ userId: row.userId, id: role.id, name: role.name }] : [];
	// 	});
	// 	const roleNameOf = groupBy(known.map((row) => ({ userId: row.userId, value: row.name })));
	// 	const roleIdOf = groupBy(known.map((row) => ({ userId: row.userId, value: row.id })));
	// 	return users.map((row) => ({
	// 		// 与 sys_user 的列一一对应(账号字段归 Better Auth,这里是只读镜像)
	// 		id: row.id,
	// 		name: row.name ?? "",
	// 		email: row.email,
	// 		emailVerified: row.emailVerified,
	// 		image: row.image ?? null,
	// 		createdAt: row.createdAt ? row.createdAt.toISOString() : null,
	// 		updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
	// 		departmentNames: departmentOf.get(row.id) ?? [],
	// 		// 部门与角色的 **id**(编辑弹窗里的多选框要用 id 定位)与名字(列表 / 详情直接展示)
	// 		departmentIds: departmentIdOf.get(row.id) ?? [],
	// 		roleNames: roleNameOf.get(row.id) ?? [],
	// 		roleIds: roleIdOf.get(row.id) ?? [],
	// 	}));
	// }),

	list: protectedProcedure.query(async () => {
		const [users, deptRows, roleRows, roles] = await Promise.all([
			db.select().from(sysUser).orderBy(asc(sysUser.name), asc(sysUser.email)),
			// 组织架构：属于哪些部门
			db
				.select({
					userId: sysUserDept.user_id,
					id: sysDept.id,
					name: sysDept.name,
				})
				.from(sysUserDept)
				.innerJoin(sysDept, eq(sysDept.id, sysUserDept.department_id)),
			// 全局角色：sys_casbin_rule 里的 g 行（role:<id>）
			allUserRoles(),
			db.select({ id: sysRole.id, name: sysRole.name }).from(sysRole),
		]);

		const roleById = new Map(roles.map((r) => [r.id, r]));

		// 一次遍历，把 [{ userId, id, name }] 归成 Map<userId, { ids, names }>
		const groupByIdName = (rows: Array<{ userId: string; id: string; name: string }>) => {
			const map = new Map<string, { ids: string[]; names: string[] }>();
			for (const { userId, id, name } of rows) {
				let entry = map.get(userId);
				if (!entry) {
					entry = { ids: [], names: [] };
					map.set(userId, entry);
				}
				entry.ids.push(id);
				entry.names.push(name);
			}
			return map;
		};

		const deptsByUser = groupByIdName(deptRows);

		// 认不出的 id（角色刚被删、g 行还没清干净）直接跳过
		const rolesByUser = groupByIdName(
			roleRows.flatMap((row) => {
				const role = roleById.get(row.roleId);
				return role ? [{ userId: row.userId, id: role.id, name: role.name }] : [];
			}),
		);

		return users.map((row) => {
			const depts = deptsByUser.get(row.id);
			const roles = rolesByUser.get(row.id);
			return {
				// 与 sys_user 的列一一对应（账号字段归 Better Auth，这里是只读镜像）
				id: row.id,
				name: row.name ?? "",
				email: row.email,
				emailVerified: row.emailVerified,
				image: row.image ?? null,
				createdAt: row.createdAt?.toISOString() ?? null,
				updatedAt: row.updatedAt?.toISOString() ?? null,
				departmentIds: depts?.ids ?? [],
				departmentNames: depts?.names ?? [],
				roleIds: roles?.ids ?? [],
				roleNames: roles?.names ?? [],
			};
		});
	}),

	/**
	 * 新建账号 —— 转调 Better Auth(只有它会正确地写密码哈希与 account 行)。
	 *
	 * ⚠️ `signUpEmail` 会**顺手建一个会话并下发 cookie**,而我们只是"替别人开个账号":
	 * 不删掉的话,当前这个管理员下一次请求就会变成这个新用户的身份。所以建完立刻删会话。
	 */
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1, "姓名不能为空").max(128),
				email: z.string().min(3, "邮箱不能为空").max(255),
				password: z.string().min(8, "密码至少8位").max(128),
			}),
		)
		.mutation(async ({ input }) => {
			const email = input.email.trim().toLowerCase();
			const [existing] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.email, email)).limit(1);
			if (existing) throw new TRPCError({ code: "CONFLICT", message: `邮箱 ${email} 已经被占用` });

			let result: Awaited<ReturnType<typeof auth.api.signUpEmail>>;
			try {
				result = await auth.api.signUpEmail({
					body: { email, password: input.password, name: input.name.trim() },
				});
			} catch (error) {
				// BA 的报错带内部路径 / 表名,不直接外泄给前端;`cause` 让 `loggingMiddleware` 记 trpc.err 时能拿到原始链
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "账号创建失败(请联系管理员)",
					cause: error,
				});
			}
			if (!result?.user)
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "账号创建失败(Better Auth 没有返回用户)" });

			// 见上方注释:这个会话属于"新用户",不能让它在当前浏览器里生效
			await db.delete(sysSession).where(eq(sysSession.userId, result.user.id));

			return { id: result.user.id, name: result.user.name, email: result.user.email };
		}),

	/**
	 * 改用户 —— **只动姓名与邮箱**。
	 *
	 * 不动密码 / 不做邮箱验证:那两件事分别是 BA 的 `changePassword` 与 `changeEmail`(要邮件往返),
	 * 在这个后台里替人改密码属于"管理员代操作",语义不同,要做得单独设计;直接改邮箱则是管理员
	 * 修正录入错误的常见诉求(唯一性靠库里那个 `uk_sys_user_email` + 这里的查重兜住)。
	 */
	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1, "姓名不能为空").max(128),
				email: z.string().min(3, "邮箱不能为空").max(255),
				/** 头像 URL(BA 的 `image` 列;空串 = 清掉) */
				image: z.string().max(512),
				/** 邮箱是否已验证 —— 管理员可以直接替用户标记(BA 的 `email_verified` 列) */
				emailVerified: z.boolean(),
				/** 这个人的**全局角色**(覆盖式:传进来的就是最终状态) */
				roleIds: z.array(z.string().min(1)),
				/** 这个人属于哪些部门(覆盖式;组织架构,不带角色) */
				departmentIds: z.array(z.string().min(1)),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			// admin 守卫:被改的人是 admin 时,只有 admin 能改。
			// 兜底顺序在邮箱查重之前 —— 与 `remove` 同一口径。
			if (await isAdminUser(input.id)) {
				const me = (ctx as { user?: { id: string; name: string; isSuper?: boolean } }).user;
				if (!me || !(await isAdminUser(me.id, me.isSuper === true))) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "只有系统管理员才能修改管理员账号",
					});
				}
			}
			const email = input.email.trim().toLowerCase();
			const [other] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.email, email)).limit(1);
			if (other && other.id !== input.id) {
				throw new TRPCError({ code: "CONFLICT", message: `邮箱 ${email} 已经被别人占用` });
			}

			const roleIds = [...new Set(input.roleIds)];
			const knownRoles = roleIds.length
				? new Set(
						(await db.select({ id: sysRole.id }).from(sysRole).where(inArray(sysRole.id, roleIds))).map(
							(row) => row.id,
						),
					)
				: new Set<string>();
			// 显式报错,不静默丢弃未知 id
			const unknownRoles = roleIds.filter((id) => !knownRoles.has(id));
			if (unknownRoles.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `这些角色不存在(可能刚被删掉):${unknownRoles.join("、")}`,
				});
			}

			const departmentIds = [...new Set(input.departmentIds)];
			const knownDepartments = departmentIds.length
				? new Set(
						(await db.select({ id: sysDept.id }).from(sysDept).where(inArray(sysDept.id, departmentIds))).map(
							(row) => row.id,
						),
					)
				: new Set<string>();
			const unknownDepartments = departmentIds.filter((id) => !knownDepartments.has(id));
			if (unknownDepartments.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `这些部门不存在(可能刚被删掉):${unknownDepartments.join("、")}`,
				});
			}

			const existingDepts = await db
				.select({ id: sysUserDept.id, departmentId: sysUserDept.department_id })
				.from(sysUserDept)
				.where(eq(sysUserDept.user_id, input.id));
			const wantedDepts = new Set(departmentIds);
			const haveDepts = new Set(existingDepts.map((row) => row.departmentId));

			// 账号列 + 角色分配 + 部门归属**一起**改:要么都成,要么都不成
			await db.transaction(async (tx) => {
				// 达梦不支持 `on update current_timestamp`,所以 update_time 一律显式写
				await tx
					.update(sysUser)
					.set({
						name: input.name.trim(),
						email,
						image: input.image.trim() || null,
						emailVerified: input.emailVerified,
						updatedAt: new Date(),
					})
					.where(eq(sysUser.id, input.id));
				// 角色**全量替换**,并把 `tx` 传进去 —— 与账号列 / 部门共用一个事务
				// (策略写入自己再开一个事务会与这个事务互相等锁)
				await setUserRoles(input.id, roleIds, tx);

				// 将多余的部门从这个用户身上移除
				for (const row of existingDepts.filter((item) => !wantedDepts.has(item.departmentId))) {
					await tx.delete(sysUserDept).where(eq(sysUserDept.id, row.id));
				}

				// 插入缺少
				for (const departmentId of departmentIds) {
					if (haveDepts.has(departmentId)) continue;
					await tx.insert(sysUserDept).values({
						id: newId(),
						user_id: input.id,
						department_id: departmentId,
						create_time: new Date(),
						update_time: new Date(),
					});
				}
			});
			return { id: input.id, name: input.name.trim(), email, roleIds, departmentIds };
		}),

	/**
	 * 删账号 —— 会话 / account / 部门成员**先清掉**再删用户。
	 *
	 * 外键上虽然写了 `on delete cascade`,但 BA 的 session / account 两张表**不归我们建**,
	 * 依赖它们的级联行为太脆;显式删一遍最坏也只是多几条 delete。
	 *
	 * ⚠️ **不允许删自己**:删掉自己的会话等于立刻掉线,页面连报错都来不及显示。
	 */
	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input, ctx }) => {
		// admin 守卫:被删的人是 admin 时拒。`ctx.user` 由 protectedProcedure 中间件保证存在。
		if (await isAdminUser(input.id)) {
			const me = (ctx as { user?: { id: string; name: string; isSuper?: boolean } }).user;
			if (!me || !(await isAdminUser(me.id, me.isSuper === true))) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "不能删除管理员账号",
				});
			}
		}
		const me = await getCurrentUserId();
		if (me && me === input.id) {
			throw new TRPCError({ code: "FORBIDDEN", message: "不能删除当前登录的账号" });
		}
		const [row] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.id, input.id)).limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这个账号不存在(可能已被删除)" });

		await db.delete(sysSession).where(eq(sysSession.userId, input.id));
		await db.delete(sysAccount).where(eq(sysAccount.userId, input.id));
		await db.delete(sysUserDept).where(eq(sysUserDept.user_id, input.id));
		// 角色成员行也在策略表里(`g` 行)—— 清掉,否则库里会留下指向不存在用户的授权
		await removeAllRolesOfUser(input.id);
		await db.delete(sysUser).where(eq(sysUser.id, input.id));
		return { id: input.id, success: true };
	}),

	/** 这个人的所有角色(全局 —— 与部门无关,成员关系在 `sys_casbin_rule` 的 `g` 行) */
	roles: protectedProcedure.input(z.object({ userId: z.string().min(1) })).query(async ({ input }) => {
		const ids = await roleIdsOf(input.userId);
		if (ids.length === 0) return [];
		return db
			.select({ roleId: sysRole.id, roleName: sysRole.name })
			.from(sysRole)
			.where(inArray(sysRole.id, ids))
			.orderBy(asc(sysRole.sort), asc(sysRole.name));
	}),
});
