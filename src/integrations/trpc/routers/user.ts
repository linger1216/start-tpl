/**
 * 用户路由 —— **只读** `sys_user`(Better Auth 的表,我们不改它)+ 读写部门/角色分配。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | 用户台账(派生出全部字段) |
 * | `create` | mutation | **建账号** —— 转调 Better Auth 的 `signUpEmail`(密码哈希由它做) |
 * | `update` | mutation | 改姓名 / 邮箱(账号本身仍是 BA 的表,这里只动这两列) |
 * | `remove` | mutation | 删账号:先清会话 / account / 部门成员,再把 `sys_user` **软删**(拒绝删自己) |
 * | `import` | mutation | 从 Excel 批量开账号 —— **只建不改**,复用的还是 `signUpEmail` |
 * | `roles` | query | 这个人的全局角色(用户详情里的角色指派) |
 * | `profile` | query | **当前登录者**自己的资料(个人资料页:姓名 / 邮箱 / 验证状态 / 角色 / 部门) |
 *
 * 建账号为什么绕到 BA:**密码哈希(scrypt)、account 记录、邮箱唯一性都是它的职责**,
 * 我们自己 insert `sys_user` 只会得到一个登不进去的账号。所以这里只做三件它不管的事:
 * ① 先查重给出中文提示(BA 的报错是英文的);② 建完**立刻删掉它顺手建的那个会话**
 * (否则等于把当前登录的管理员顶掉);③ 返回我们能直接用的那几列。
 * 改姓名 / 邮箱走 `update`;改**自己的**密码与邮箱验证走 BA 的客户端接口(见 `lib/auth.ts`),
 * 不在这里 —— 那两条流程带着"邮件往返"和"校验旧密码",不是普通台账写入。
 */

import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysAccount, sysDept, sysRole, sysSession, sysUser, sysUserDept } from "#/db/data-base-schema";
import { auth } from "#/lib/auth";
import {
	allUserRoles,
	clearCasbinCache,
	isAdminUser,
	removeAllRolesOfUser,
	roleIdsOf,
	setUserRoles,
} from "#/lib/casbin";
import { getCurrentUserId } from "#/lib/current-user";
import type { ImportOutcome } from "#/lib/excel";
import { newId } from "#/lib/ids";
import { alive, softDeleted, tombstone } from "#/lib/soft-delete";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../init";

/**
 * 校验一批外键 id **都还在**(软删过的不算)—— 用户授权只认活着的角色 / 部门;
 * 缺了就显式报错,不静默丢弃未知 id。
 */
async function assertIdsExist(table: typeof sysRole | typeof sysDept, ids: string[], label: string): Promise<void> {
	if (ids.length === 0) return;
	const rows = await db
		.select({ id: table.id })
		.from(table)
		.where(and(inArray(table.id, ids), alive(table)));
	const known = new Set(rows.map((row) => row.id));
	const unknown = ids.filter((id) => !known.has(id));
	if (unknown.length > 0) {
		throw new TRPCError({ code: "BAD_REQUEST", message: `这些${label}不存在(可能刚被删掉):${unknown.join("、")}` });
	}
}

export const userRouter = createTRPCRouter({
	/**
	 * 用户台账 —— 带上每个人的**部门 / 角色分配**(表格里要显示,统计卡也要用)。
	 *
	 * 一次查完所有分配再按 user 归组,**别在循环里逐人查**(N+1)。
	 */
	list: protectedProcedure.query(async () => {
		const [users, deptRows, roleRows, roles] = await Promise.all([
			// 读路径一律过 `alive()`:软删的用户行留在库里只为审计留痕,不能出现在台账里
			db.select().from(sysUser).where(alive(sysUser)).orderBy(asc(sysUser.name), asc(sysUser.email)),
			// 组织架构：属于哪些部门（join 出来的部门同样只认活着的，软删部门的归属等于已失效）
			db
				.select({
					userId: sysUserDept.user_id,
					id: sysDept.id,
					name: sysDept.name,
				})
				.from(sysUserDept)
				.innerJoin(sysDept, eq(sysDept.id, sysUserDept.department_id))
				.where(alive(sysDept)),
			// 全局角色：sys_casbin_rule 里的 g 行（role:<id>）
			allUserRoles(),
			// 角色名映射也要过滤：软删角色留在库里只为审计，不能再显示成人身上的角色
			db.select({ id: sysRole.id, name: sysRole.name }).from(sysRole).where(alive(sysRole)),
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
			// 查重只看活着的行:软删用户的邮箱已被 `tombstone()` 让位,同名邮箱可以重新启用
			const [existing] = await db
				.select({ id: sysUser.id })
				.from(sysUser)
				.where(and(eq(sysUser.email, email), alive(sysUser)))
				.limit(1);
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
				const me = requireCurrentUser(ctx);
				if (!(await isAdminUser(me.id, me.isSuper === true))) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "只有系统管理员才能修改管理员账号",
					});
				}
			}
			const email = input.email.trim().toLowerCase();
			// 查重只看活着的行:软删用户的邮箱已被 `tombstone()` 让位,不会永久占住这个邮箱
			const [other] = await db
				.select({ id: sysUser.id })
				.from(sysUser)
				.where(and(eq(sysUser.email, email), alive(sysUser)))
				.limit(1);
			if (other && other.id !== input.id) {
				throw new TRPCError({ code: "CONFLICT", message: `邮箱 ${email} 已经被别人占用` });
			}

			const roleIds = [...new Set(input.roleIds)];
			await assertIdsExist(sysRole, roleIds, "角色");
			const departmentIds = [...new Set(input.departmentIds)];
			await assertIdsExist(sysDept, departmentIds, "部门");

			const existingDepts = await db
				.select({ id: sysUserDept.id, departmentId: sysUserDept.department_id })
				.from(sysUserDept)
				.where(eq(sysUserDept.user_id, input.id));
			const wantedDepts = new Set(departmentIds);
			const haveDepts = new Set(existingDepts.map((row) => row.departmentId));

			// 账号列 + 角色分配 + 部门归属**一起**改:要么都成,要么都不成
			await db.transaction(async (tx) => {
				// 达梦不支持 `on update current_timestamp`,所以 updated_at 一律显式写
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
						created_at: new Date(),
						updated_at: new Date(),
					});
				}
			});
			return { id: input.id, name: input.name.trim(), email, roleIds, departmentIds };
		}),

	/**
	 * 删账号 —— 会话 / account / 部门成员**先清掉**,再把用户**软删**。
	 *
	 * 为什么凭证必须硬删、用户行只能软删:会话 / account 是「能不能登进来」的凭据,留着就是留着后门,
	 * 所以它们**真删**;而 `sys_user` 行是审计留痕(谁被删了、什么时候删的),硬删之后日志里只剩一串 id。
	 * 软删时用 `tombstone()` 把邮箱让位,否则那条唯一键会被死行永久占住,这个邮箱再也开不出新账号。
	 * 读路径(列表 / 详情 / 查重)必须处处带 `alive()` —— 漏一处就把已删除的人重新暴露出来。
	 *
	 * 外键上虽然写了 `on delete cascade`,但 BA 的 session / account 两张表**不归我们建**,
	 * 依赖它们的级联行为太脆;显式删一遍最坏也只是多几条 delete。
	 *
	 * ⚠️ **不允许删自己**:删掉自己的会话等于立刻掉线,页面连报错都来不及显示。
	 */
	remove: protectedProcedure
		.input(z.object({ ids: z.array(z.string().min(1)).min(1, "至少选一个账号").max(100, "一次最多删 100 个账号") }))
		.mutation(async ({ input, ctx }) => {
			const me = requireCurrentUser(ctx);
			// **先全量校验、再写**:批量删除不允许"删了一半"(前端也不许逐条循环,见 doc/后端接口约定.md §三)
			for (const id of input.ids) {
				// admin 守卫:被删的人是 admin 时拒。`ctx.user` 由 protectedProcedure 中间件保证存在。
				if ((await isAdminUser(id)) && !(await isAdminUser(me.id, me.isSuper === true))) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "不能删除管理员账号",
					});
				}
			}
			const meId = await getCurrentUserId();
			if (meId && input.ids.includes(meId)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "不能删除当前登录的账号" });
			}
			// 这一行就是删除过程要操作的目标,故意**不带** `alive()` —— 已软删的行也要能拿到 email 让位
			const rows = await db
				.select({ id: sysUser.id, email: sysUser.email })
				.from(sysUser)
				.where(inArray(sysUser.id, input.ids));
			if (rows.length !== new Set(input.ids).size) {
				throw new TRPCError({ code: "NOT_FOUND", message: "有账号不存在(可能已被删除)" });
			}

			// ①~⑤ **一个事务收口**:硬删凭据/组织关系 + 清角色 + 软删用户 + 邮箱墓碑 ——
			// 任何一步失败整体回滚,绝不留"删了凭证没删角色"的半删状态(与 user.update 的事务口径同源)。
			await db.transaction(async (tx) => {
				// ①~③ 登录凭据与组织关系**硬删**:凭证真没掉才算真的注销,join 表本身不参与软删口径
				await tx.delete(sysSession).where(inArray(sysSession.userId, input.ids));
				await tx.delete(sysAccount).where(inArray(sysAccount.userId, input.ids));
				await tx.delete(sysUserDept).where(inArray(sysUserDept.user_id, input.ids));
				// 角色成员行也在策略表里(`g` 行)—— 清掉,否则库里会留下指向不存在用户的授权
				for (const row of rows) await removeAllRolesOfUser(row.id, tx);
				// ⑤ 用户行**软删** + 邮箱墓碑(逐行:墓碑值里带 id,不能一条 SQL 批量写)
				for (const row of rows) {
					await tx
						.update(sysUser)
						.set({ ...softDeleted(), email: tombstone(row.email, row.id, 255) })
						.where(eq(sysUser.id, row.id));
				}
			});
			// 事务已提交,清进程内 casbin 缓存(事务内清会被别的读回填,所以放事务外)
			clearCasbinCache();
			return { removed: rows.length };
		}),

	/**
	 * 用户 Excel 导入 —— **批量开账号,只建不改**。
	 *
	 * | 情况 | 行为 |
	 * | --- | --- |
	 * | 邮箱不在库里 | 走 `auth.api.signUpEmail` 开账号(密码哈希 / account 记录都是 BA 的事),再挂角色与部门 |
	 * | 邮箱已在库里 | 进 `duplicates` 跳过 —— **绝不改已有账号**(批量改密码 / 改角色太危险,那是「编辑」弹窗的事) |
	 * | 角色 / 部门名字对不上(或有同名) | 逐行报错,这一行不建 |
	 *
	 * 列契约与表头在 `#/components/modules/settings/settings-users-excel.ts`;它的「初始密码」列
	 * 是导出时没有的(密码是散列,导不出来)—— 拿导出的文件当模板要手补这一列。
	 * 权限点复用「新增用户」(`sys:user:add`):导入本质就是批量新增,不另造新码(见 `lib/rbac.ts` 文件头)。
	 */
	import: protectedProcedure
		.input(
			z.object({
				rows: z.array(z.record(z.string(), z.string())).min(1, "没有可导入的行").max(500, "一次最多导入 500 行"),
			}),
		)
		.mutation(async ({ input }) => {
			type Parsed = {
				name: string;
				email: string;
				password: string;
				roleIds: string[];
				deptIds: string[];
				index: number;
			};
			const result: ImportOutcome = { total: input.rows.length, created: 0, errors: [], duplicates: [] };

			/** 多值列(角色 / 部门):导出用「、」连接,导入 `、` `,` `;` 与空白都认 */
			const splitNames = (raw: string) =>
				raw
					.split(/[、,;，；\s]+/)
					.map((value) => value.trim())
					.filter(Boolean);

			/** 名字 → id。同名的部门 / 角色不猜:直接让这一行报错(否则容易挂错人) */
			const idByName = (rows: Array<{ id: string; name: string }>) => {
				const map = new Map<string, string>();
				const duplicated = new Set<string>();
				for (const row of rows) {
					if (map.has(row.name)) duplicated.add(row.name);
					else map.set(row.name, row.id);
				}
				return { map, duplicated };
			};
			// 角色与部门都是配置表,量小 —— 一次查全,别逐行查库。
			// 必须带 `alive()`:软删的角色 / 部门不能拿来给新用户(那等于把已删的权限发出去)。
			const roles = idByName(
				await db.select({ id: sysRole.id, name: sysRole.name }).from(sysRole).where(alive(sysRole)),
			);
			const depts = idByName(
				await db.select({ id: sysDept.id, name: sysDept.name }).from(sysDept).where(alive(sysDept)),
			);
			// 邮箱查重集合:软删用户的邮箱已被 `tombstone()` 让位,这里的 `alive()` 只保证口径统一
			const existingEmails = new Set(
				(await db.select({ email: sysUser.email }).from(sysUser).where(alive(sysUser))).map((row) => row.email),
			);

			// ① 逐行校验(不碰数据库,一次把错误报全)
			const parsed: Parsed[] = [];
			const seen = new Set<string>();
			input.rows.forEach((row, index) => {
				const name = (row.name ?? "").trim();
				const email = (row.email ?? "").trim().toLowerCase();
				const password = (row.password ?? "").trim();
				const roleNames = splitNames(row.roles ?? "");
				const deptNames = splitNames(row.departments ?? "");

				if (!name) {
					result.errors.push({ index, message: "缺少「姓名」" });
					return;
				}
				if (name.length > 128) {
					result.errors.push({ index, message: "「姓名」最长 128 字符" });
					return;
				}
				if (!email) {
					result.errors.push({ index, message: "缺少「邮箱」" });
					return;
				}
				if (!email.includes("@") || email.length > 255) {
					result.errors.push({ index, message: "「邮箱」格式不对" });
					return;
				}
				if (seen.has(email)) {
					result.errors.push({ index, message: `同一批里「${email}」出现了多次,只导入第一条` });
					return;
				}
				// 已在库里 = 跳过(不是错误):导入只建不改
				if (existingEmails.has(email)) {
					seen.add(email);
					result.duplicates.push({ index, message: `邮箱 ${email} 已经存在,已跳过(导入只建不改)` });
					return;
				}
				if (!password) {
					result.errors.push({ index, message: "缺少「初始密码」" });
					return;
				}
				if (password.length < 8) {
					result.errors.push({ index, message: "「初始密码」至少 8 位" });
					return;
				}
				const roleIds: string[] = [];
				for (const roleName of roleNames) {
					if (roles.duplicated.has(roleName)) {
						result.errors.push({ index, message: `角色「${roleName}」有多个同名角色,请先改名` });
						return;
					}
					const roleId = roles.map.get(roleName);
					if (!roleId) {
						result.errors.push({ index, message: `角色「${roleName}」不存在` });
						return;
					}
					roleIds.push(roleId);
				}
				const deptIds: string[] = [];
				for (const deptName of deptNames) {
					if (depts.duplicated.has(deptName)) {
						result.errors.push({ index, message: `部门「${deptName}」有多个同名部门,请先改名` });
						return;
					}
					const deptId = depts.map.get(deptName);
					if (!deptId) {
						result.errors.push({ index, message: `部门「${deptName}」不存在` });
						return;
					}
					deptIds.push(deptId);
				}
				seen.add(email);
				parsed.push({ name, email, password, roleIds, deptIds, index });
			});

			// ② 逐行开账号 —— 与 `create` 同一条路:哈希 / account 记录交给 BA
			for (const row of parsed) {
				let created: Awaited<ReturnType<typeof auth.api.signUpEmail>>;
				try {
					created = await auth.api.signUpEmail({
						body: { email: row.email, password: row.password, name: row.name },
					});
				} catch {
					// 单个账号失败不打断整批:这一行报错,后面的继续
					result.errors.push({ index: row.index, message: "账号创建失败(请联系管理员)" });
					continue;
				}
				if (!created?.user) {
					result.errors.push({ index: row.index, message: "账号创建失败(Better Auth 没有返回用户)" });
					continue;
				}
				const userId = created.user.id;
				// BA 建账号时会顺手签发一个会话(否则等于把导入人顶掉、换成最后导入的那个账号)
				await db.delete(sysSession).where(eq(sysSession.userId, userId));
				if (row.roleIds.length > 0) await setUserRoles(userId, row.roleIds);
				if (row.deptIds.length > 0) {
					await db
						.insert(sysUserDept)
						.values(row.deptIds.map((deptId) => ({ id: newId(), department_id: deptId, user_id: userId })));
				}
				result.created += 1;
			}

			// 校验分两趟跑,回执按行号排一下 —— 对话框是按「第 N 行」逐条列的
			result.errors.sort((a, b) => a.index - b.index);
			result.duplicates.sort((a, b) => a.index - b.index);
			return result;
		}),

	/** 这个人的所有角色(全局 —— 与部门无关,成员关系在 `sys_casbin_rule` 的 `g` 行) */
	roles: protectedProcedure.input(z.object({ userId: z.string().min(1) })).query(async ({ input }) => {
		const ids = await roleIdsOf(input.userId);
		if (ids.length === 0) return [];
		return db
			.select({ roleId: sysRole.id, roleName: sysRole.name })
			.from(sysRole)
			.where(and(inArray(sysRole.id, ids), alive(sysRole)))
			.orderBy(asc(sysRole.sort), asc(sysRole.name));
	}),

	/**
	 * **当前登录者自己的资料** —— `/settings/profile` 页的全部数据。
	 *
	 * `id` 一律取 `ctx.user.id`(中间件注入),不接受前端传参 ⇒ "看别人的资料"在 SQL 层不可能。
	 * 邮箱验证状态取自 `sys_user.email_verified`(BA 的表,我们只读)—— 个人资料页据此显示
	 * 「已验证 / 未验证」与「重发验证邮件」按钮。
	 *
	 * ⚠️ 取舍:姓名 / 邮箱的**改动**不走这个路由 —— 它们是 BA 的表,改邮箱还要邮件往返,
	 * 所以页面直接调 BA 客户端接口(`authClient.updateUser` / `changeEmail` / `changePassword`)。
	 */
	profile: protectedProcedure.query(async ({ ctx }) => {
		const me = requireCurrentUser(ctx);
		// `alive()` 必带:账号被软删后这个人就不该再取到资料,要给 NOT_FOUND 而不是把他的资料继续显示出来
		const [row] = await db
			.select({
				id: sysUser.id,
				name: sysUser.name,
				email: sysUser.email,
				emailVerified: sysUser.emailVerified,
				createTime: sysUser.createdAt,
			})
			.from(sysUser)
			.where(and(eq(sysUser.id, me.id), alive(sysUser)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在(可能已被删除)" });

		const roleIds = await roleIdsOf(me.id);
		const roles =
			roleIds.length === 0
				? []
				: await db
						.select({ id: sysRole.id, name: sysRole.name })
						.from(sysRole)
						.where(and(inArray(sysRole.id, roleIds), alive(sysRole)))
						.orderBy(asc(sysRole.sort), asc(sysRole.name));
		const depts = await db
			.select({ id: sysDept.id, name: sysDept.name })
			.from(sysUserDept)
			.innerJoin(sysDept, eq(sysDept.id, sysUserDept.department_id))
			.where(and(eq(sysUserDept.user_id, me.id), alive(sysDept)))
			.orderBy(asc(sysDept.name));

		return {
			id: row.id,
			name: row.name,
			email: row.email,
			emailVerified: Boolean(row.emailVerified),
			createTime: row.createTime ? row.createTime.toISOString() : null,
			roles,
			depts,
		};
	}),
});
