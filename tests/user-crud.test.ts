/**
 * 用户账号的建 / 改 / 删(`user.create` / `update` / `remove`)—— 集成测试。
 *
 * `create` 只做 Better Auth 不管的三件事,所以前三条用例正对着这三件事:
 *  1. **建出来的账号真能登录** —— 密码哈希确实由 BA 落在 `sys_account` 上,
 *     而不是我们自己 insert 出一个"登不进去的空账号";
 *  2. 邮箱重复时**给中文提示 + CONFLICT**(BA 原生报错是英文的,界面上没法看);
 *  3. **不留会话** —— `signUpEmail` 会顺手建一个会话并下发 cookie,不删掉的话
 *     当前这个管理员下一次请求就变成新用户的身份。这是本 procedure 存在的理由,必须断言。
 *
 * ⚠️ 会读写 `.env.local` 指向的库;数据用 `__test__` 前缀,`after` 里清干净。
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";

import { and, eq, inArray, like } from "drizzle-orm";
import {
	sysAccount,
	sysCasbinRule,
	sysDept,
	sysMenu,
	sysRole,
	sysSession,
	sysUser,
	sysUserDept,
} from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { auth } from "../src/lib/auth.ts";
import { addUserRole, clearCasbinCache, setRoleMenus } from "../src/lib/casbin.ts";
import { newId } from "../src/lib/ids.ts";
import {
	assertRejects,
	caller,
	callerAs,
	captchaHeaders,
	closeDb,
	getSystemAdminRoleRow,
	purgeCasbinByUserIds,
	purgeRole,
	TEST_PREFIX,
	uniqueSuffix,
} from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const EMAIL = `${TEST_PREFIX}created_${SUFFIX}@example.com`;
const PASSWORD = "Passw0rd!123";

/**
 * 上次跑测试崩在某个 admin-guard 用例中段,`after()` 没机会清 `createdRoleIds`,
 * 库里就留下一行 `__test__adm-ed_...` —— 下次再跑就撞 `uk_sys_role_name`。
 * 在 `before()` 里按**名字前缀**主动扫一次,跟 `createdRoleIds` 的 after 清扫形成双保险。
 */
before(async () => {
	const leftover = await db
		.select({ id: sysRole.id })
		.from(sysRole)
		.where(like(sysRole.name, `${TEST_PREFIX}adm-ed_%`));
	for (const row of leftover) await purgeRole(row.id);
});

const createdIds: string[] = [];
/** 用例里临时建的部门(失败时也要清掉,别留在库里 —— 真的漏过一次) */
const tempDeptIds: string[] = [];
/** admin 守卫测试里直插的角色 —— 走 `db.insert(sysRole)`,`after` 要清,否则下次撞 `uk_sys_role_name` */
const createdRoleIds: string[] = [];

after(async () => {
	// 清库顺序必须「子表 → 父表 → 部门」:`sys_user_dept` 的外键是 NO ACTION
	// (MySQL 建表时真下手,达梦那套 DDL 没有),先删部门会被 `fk_sys_dm_department` 拦住
	// —— 拦一次后面全不执行,残留就攒下来了。角色那层现在是策略表的 `g` 行(没有外键,顺手删)。
	// 登录步骤还会再建会话,所以 session 也要照清。
	for (const id of createdIds) {
		await db.delete(sysSession).where(eq(sysSession.userId, id));
		await db.delete(sysAccount).where(eq(sysAccount.userId, id));
		await db.delete(sysUserDept).where(eq(sysUserDept.user_id, id));
		await db.delete(sysUser).where(eq(sysUser.id, id));
	}
	// 删所有用户的成员关系 `g` 行(批量版比循环调 `db.delete` 少 4× round-trip)
	await purgeCasbinByUserIds(createdIds);
	for (const id of tempDeptIds) {
		await db.delete(sysUserDept).where(eq(sysUserDept.department_id, id));
		await db.delete(sysDept).where(eq(sysDept.id, id));
	}
	// admin 守卫测试里直插的 role —— `setRoleMenus` 写过 `p` 行,挂过 `g` 行(给测试用户),
	// 三类一并清掉(顺序:`g` → `p` → `sys_role`),否则 `uk_sys_role_name` 下次撞
	for (const id of createdRoleIds) await purgeRole(id);
	// 上面是直接删表,绕过了 `lib/casbin.ts` 的领域函数 → 判定缓存要手动刷
	clearCasbinCache();
	await closeDb();
});

test("user.create:建出的账号能在库里查到,并且真的能登录", async () => {
	const created = await caller.user.create({ name: "被建的用户", email: EMAIL, password: PASSWORD });
	createdIds.push(created.id);

	assert.equal(created.email, EMAIL.toLowerCase(), "邮箱应统一成小写");
	assert.equal(created.name, "被建的用户");

	const [row] = await db.select().from(sysUser).where(eq(sysUser.id, created.id));
	assert.ok(row, "sys_user 里应该有这一行");
	assert.equal(row.email, EMAIL.toLowerCase());

	// password hash 由 BA 写在 account 表上 —— 这里能登录就证明它落对了
	// `returnHeaders: true` 时结果包一层 `{ headers, response }`,用户对象在 `response.user` 上
	const signIn = await auth.api.signInEmail({
		body: { email: EMAIL, password: PASSWORD },
		headers: await captchaHeaders(),
		returnHeaders: true,
	});
	assert.ok(signIn?.response?.user, "新账号应该能直接登录");
	assert.equal(signIn.response.user.id, created.id);

	const accounts = await db.select().from(sysAccount).where(eq(sysAccount.userId, created.id));
	assert.ok(accounts.length > 0, "sys_account 里应该有这条账号的密码记录");
});

test("user.create:建完之后**不留下会话**(否则会把当前管理员顶掉)", async () => {
	const created = await caller.user.create({
		name: "无会话用户",
		email: `${TEST_PREFIX}nosession_${SUFFIX}@example.com`,
		password: PASSWORD,
	});
	createdIds.push(created.id);

	const sessions = await db.select().from(sysSession).where(eq(sysSession.userId, created.id));
	assert.equal(sessions.length, 0, "建账号不该留下会话 —— signUpEmail 顺手建的那个必须被删掉");
});

test("user.create:邮箱重复时拒绝,并给出中文提示", async () => {
	await assertRejects(() => caller.user.create({ name: "重复", email: EMAIL, password: PASSWORD }), "已经被占用");
});

test("user.update:改姓名与邮箱,库里真的变了", async () => {
	const created = await caller.user.create({
		name: "改名前",
		email: `${TEST_PREFIX}upd_${SUFFIX}@example.com`,
		password: PASSWORD,
	});
	createdIds.push(created.id);

	const nextEmail = `${TEST_PREFIX}upd_after_${SUFFIX}@example.com`;
	// 角色是全局的:编辑用户时一并覆盖保存(这里顺便给它一个角色)。
	// **不能用 `list()[0]`**:若库里第一个角色恰好是「系统管理员」,新用户就继承成了 admin,
	// `user.update` 的 admin 守卫会误伤。这条用例只关心"角色分配能落库",
	// 不在意角色名 —— 取第一个**非 admin** 的即可。
	const role = (await caller.role.list()).find((r) => r.name !== "系统管理员");
	assert.ok(role, "前置条件:库里至少要有一个非管理员角色");
	const updated = await caller.user.update({
		id: created.id,
		name: "改名后",
		email: nextEmail,
		// 头像是真实列;顺便验一下"能写进去也能读回来"
		image: "https://example.com/me.png",
		emailVerified: true,
		roleIds: [role.id],
		departmentIds: [],
	});
	assert.equal(updated.name, "改名后");
	assert.equal(updated.email, nextEmail);

	// 账号列真的落库了(image / email_verified)
	const [afterUpdate] = await db.select().from(sysUser).where(eq(sysUser.id, created.id));
	assert.equal(afterUpdate.image, "https://example.com/me.png", "image 应该已更新");
	assert.equal(afterUpdate.emailVerified, true, "email_verified 应该已更新");

	// 角色分配真的落库了(而且 `list` 能读回来)
	const listed = (await caller.user.list()).find((row) => row.id === created.id);
	assert.deepEqual(listed?.roleIds, [role.id], "角色分配应该被保存");
	assert.deepEqual(listed?.roleNames, [role.name], "角色名也应该带出来");

	const [row] = await db.select().from(sysUser).where(eq(sysUser.id, created.id));
	assert.equal(row.name, "改名后", "sys_user.name 应该已更新");
	assert.equal(row.email, nextEmail, "sys_user.email 应该已更新");
});

test("user.update:邮箱撞上别人时拒绝(不静默改坏唯一键)", async () => {
	const a = await caller.user.create({
		name: "甲",
		email: `${TEST_PREFIX}dup_a_${SUFFIX}@example.com`,
		password: PASSWORD,
	});
	const b = await caller.user.create({
		name: "乙",
		email: `${TEST_PREFIX}dup_b_${SUFFIX}@example.com`,
		password: PASSWORD,
	});
	createdIds.push(a.id, b.id);

	await assertRejects(
		() =>
			caller.user.update({
				id: b.id,
				name: "乙",
				email: a.email,
				image: "",
				emailVerified: false,
				roleIds: [],
				departmentIds: [],
			}),
		"已经被别人占用",
	);

	const [row] = await db.select().from(sysUser).where(eq(sysUser.id, b.id));
	assert.equal(row.email, b.email, "被拒绝后不该改动任何一列");
});

test("user.remove:连会话 / account / 部门成员一起清掉", async () => {
	const created = await caller.user.create({
		name: "待删除",
		email: `${TEST_PREFIX}del_${SUFFIX}@example.com`,
		password: PASSWORD,
	});
	// 要 push 进 createdIds:`remove` 现在是软删,行会留在库里,清理归 `after`(断言期间它必须在)
	createdIds.push(created.id);
	const dept = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}删除测试部门_${SUFFIX}` });
	tempDeptIds.push(dept.id);
	// 取第一个**非 admin** 的角色 —— 见上文 user.update 用例的同样解释
	const role = (await caller.role.list()).find((r) => r.name !== "系统管理员");
	assert.ok(role, "前置条件:库里至少要有一个非管理员角色");
	await caller.department.addMember({ departmentId: dept.id, userId: created.id });
	await caller.user.update({
		id: created.id,
		name: created.name,
		email: created.email,
		image: "",
		emailVerified: false,
		roleIds: [role.id],
		departmentIds: [dept.id],
	});
	// 造一个会话(signInEmail 会落一行),证明删除时确实被清掉
	await auth.api.signInEmail({ body: { email: created.email, password: PASSWORD }, headers: await captchaHeaders() });
	const before = await db.select().from(sysSession).where(eq(sysSession.userId, created.id));
	assert.ok(before.length > 0, "前置条件:登录后应该有会话");

	await caller.user.remove({ ids: [created.id] });

	// 软删:行还在(审计留痕)、deleted_at 写上、邮箱让位(墓碑)—— 登录凭证才是真删
	const [afterRow] = await db.select().from(sysUser).where(eq(sysUser.id, created.id));
	assert.ok(afterRow, "软删要留行,不是物理删除");
	assert.ok(afterRow.deleted_at, "deleted_at 应被写上");
	assert.notEqual(afterRow.email, created.email, "邮箱让位(加墓碑后缀),同一个邮箱才能再注册");
	assert.equal(
		(await db.select().from(sysSession).where(eq(sysSession.userId, created.id))).length,
		0,
		"会话应该被清掉",
	);
	assert.equal(
		(await db.select().from(sysAccount).where(eq(sysAccount.userId, created.id))).length,
		0,
		"account 应该被清掉",
	);
	assert.equal(
		(await db.select().from(sysUserDept).where(eq(sysUserDept.user_id, created.id))).length,
		0,
		"部门成员行应该被清掉",
	);
	assert.equal(
		(
			await db
				.select()
				.from(sysCasbinRule)
				.where(and(eq(sysCasbinRule.ptype, "g"), eq(sysCasbinRule.v0, `user:${created.id}`)))
		).length,
		0,
		"角色分配行(策略表的 `g` 行)也应该被清掉",
	);
	await caller.department.remove({ id: dept.id });
	// 不能 `tempDeptIds.pop()`:`remove` 现在是软删,行还在库里 —— 物理清归 `after`(按 id)
});

test("user.remove:账号不存在时给 NOT_FOUND 而不是静默成功", async () => {
	await assertRejects(() => caller.user.remove({ ids: ["not-exists-id"] }), "不存在");
});

test("user.update:部门是覆盖式 —— 加一个 / 去掉一个,传进去的就是最终状态", async () => {
	const created = await caller.user.create({
		name: "部门覆盖",
		email: `${TEST_PREFIX}dept_${SUFFIX}@example.com`,
		password: PASSWORD,
	});
	createdIds.push(created.id);
	const met = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}覆盖甲_${SUFFIX}` });
	const yi = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}覆盖乙_${SUFFIX}` });
	tempDeptIds.push(met.id, yi.id);

	// 除部门外的字段每次都原样传回(它们同样是覆盖式,但这里只关心部门)
	const base = {
		id: created.id,
		name: created.name,
		email: created.email,
		image: "",
		emailVerified: false,
		roleIds: [] as string[],
	};
	const readDeptIds = async () => {
		const row = (await caller.user.list()).find((item) => item.id === created.id);
		return [...(row?.departmentIds ?? [])].sort();
	};

	await caller.user.update({ ...base, departmentIds: [met.id] });
	assert.deepEqual(await readDeptIds(), [met.id], "第一次应该只挂上「甲」");

	await caller.user.update({ ...base, departmentIds: [met.id, yi.id] });
	assert.deepEqual(await readDeptIds(), [met.id, yi.id].sort(), "再加一个,两个都在");

	await caller.user.update({ ...base, departmentIds: [yi.id] });
	assert.deepEqual(await readDeptIds(), [yi.id], "这次没传「甲」→ 覆盖式,它应该被去掉");

	// 库里也确实只剩一行(不是"界面上没了、行还在")
	const rows = await db.select().from(sysUserDept).where(eq(sysUserDept.user_id, created.id));
	assert.equal(rows.length, 1, "sys_user_dept 里应该只剩一行");
	assert.equal(rows[0]?.department_id, yi.id, "剩下的那行应该是「乙」");
});

test("user.update:部门 id 不存在时显式报错(不静默丢弃)", async () => {
	const created = await caller.user.create({
		name: "部门非法",
		email: `${TEST_PREFIX}baddept_${SUFFIX}@example.com`,
		password: PASSWORD,
	});
	createdIds.push(created.id);
	await assertRejects(
		() =>
			caller.user.update({
				id: created.id,
				name: created.name,
				email: created.email,
				image: "",
				emailVerified: false,
				roleIds: [],
				departmentIds: ["not-a-department"],
			}),
		"这些部门不存在",
	);
});

// ── admin 守卫 ───────────────────────────────────────────────────────
/**
 * 直插一个不进 BA 的测试用户 —— 不需要密码哈希、不需要会话,
 * 只为了「给他挂一个角色 → 把他放进 caller ctx」这条路。
 *
 * 走 `caller.user.create` 反而会触发 `auth.api.signUpEmail` 的副作用:
 *  - 写 `sys_account` 一行
 *  - 顺手建一个会话(本 procedure 之后会删掉,但顺序不稳)
 *  - **挂上 caller 的角色继承图**(BA 内部逻辑)
 *
 * 这里要的是「一个干净用户 + 一个明确角色」,直插最干净。
 */
async function createPlainUser(label: string): Promise<{ id: string; name: string }> {
	const id = newId();
	const name = `${TEST_PREFIX}${label}_${SUFFIX}`;
	await db.insert(sysUser).values({ id, name, email: `${id}@example.com`, emailVerified: false });
	createdIds.push(id);
	return { id, name };
}

/**
 * 在 admin 守卫测试里,**操作员不能走 isSuper 短路**(那会让 permMiddleware 直接放行,
 * admin 守卫形同虚设)。但 permMiddleware 又要求 `user.update` 必须配 `sys:user:edit`
 * 权限码 —— 这条权限码来自菜单 `修改用户`(perm='sys:user:edit')与 `/settings/users`
 * 页面的合成码 `page:settings_users:view`。所以非 admin 操作员必须**真正拥有
 * 这两条菜单授权**。
 *
 * 本函数建一个**仅用于 admin 守卫测试**的非 admin 角色,把它授权到「修改用户」与
 * 「用户管理」两个菜单,然后挂在 nonAdmin 用户头上 —— 这样 permMiddleware 走真实
 * casbin 校验放行,admin 守卫又因为操作员**没有「系统管理员」角色**而生效。
 */
async function buildNonAdminEditorRole(): Promise<{ roleId: string }> {
	const id = newId();
	// `sys_role.name` 是 `varchar(32)` —— 取一个短名:`__test__adm-ed_<8 字符 fresh nonce>`
	// (per-call nonce 而非模块级 `SUFFIX`,4 条用例各调一次不会撞;跨次跑即使崩了
	// 也不会撞,因为 fresh nonce 全局唯一)
	await db.insert(sysRole).values({
		id,
		name: `${TEST_PREFIX}adm-ed_${randomBytes(4).toString("hex")}`,
		sort: 999,
		status: 1,
		remark: "",
	});
	createdRoleIds.push(id);
	// 找出菜单 id(用名字筛,稳定可读)
	const menus = await db.select({ id: sysMenu.id, name: sysMenu.name, perm: sysMenu.perm }).from(sysMenu);
	const editUser = menus.find((m) => m.perm === "sys:user:edit");
	const removeUser = menus.find((m) => m.perm === "sys:user:remove");
	const userPage = menus.find((m) => m.name === "用户管理");
	assert.ok(editUser, "前置条件:库里有 perm='sys:user:edit' 的「修改用户」菜单");
	assert.ok(removeUser, "前置条件:库里有 perm='sys:user:remove' 的「删除用户」菜单");
	assert.ok(userPage, "前置条件:库里有 name='用户管理' 的菜单");
	// 三个都挂上:user.update 用 edit,user.remove 用 remove,userPage 是「用户管理」页面的可见性
	await setRoleMenus(id, [editUser.id, removeUser.id, userPage.id]);
	return { roleId: id };
}

test("user.update:被改的人是 admin 时,非 admin 操作员被 FORBIDDEN 拦下", async () => {
	const target = await createPlainUser("admin-target");
	const nonAdmin = await createPlainUser("non-admin-operator");

	// target 持「系统管理员」
	const adminRoleRow = await getSystemAdminRoleRow();
	await addUserRole(target.id, adminRoleRow.id);

	// 操作员持「admin-guard-editor」(非 admin,且有 sys:user:edit 授权)
	const editor = await buildNonAdminEditorRole();
	await addUserRole(nonAdmin.id, editor.roleId);
	const nonAdminCaller = callerAs({ id: nonAdmin.id, name: nonAdmin.name, isSuper: false });

	await assertRejects(
		() =>
			nonAdminCaller.user.update({
				id: target.id,
				name: target.name,
				email: `${target.id}@example.com`,
				image: "",
				emailVerified: false,
				roleIds: [adminRoleRow.id],
				departmentIds: [],
			}),
		"只有系统管理员才能修改管理员账号",
	);

	// 库里的角色分配没动(被拒后就该不动)
	const after1 = await caller.user.roles({ userId: target.id });
	assert.deepEqual(after1.map((r) => r.roleId).sort(), [adminRoleRow.id].sort(), "被拒后不该改动角色分配");
});

test("user.update:被改的人是 admin 时,admin 操作员放行", async () => {
	const target = await createPlainUser("admin-target-2");
	const adminRoleRow = await getSystemAdminRoleRow();
	await addUserRole(target.id, adminRoleRow.id);

	// caller 是 TEST_USER(isSuper=true),他能改 admin
	const updated = await caller.user.update({
		id: target.id,
		name: `${target.name}_改`,
		email: `${target.id}@example.com`,
		image: "",
		emailVerified: false,
		roleIds: [adminRoleRow.id],
		departmentIds: [],
	});
	assert.equal(updated.name, `${target.name}_改`, "admin 改 admin 应该放行");
});

test("user.update:被改的人是普通用户时,非 admin 操作员也能改(守卫不误伤)", async () => {
	const target = await createPlainUser("plain-target");
	const nonAdmin = await createPlainUser("non-admin-operator-2");
	const editor = await buildNonAdminEditorRole();
	await addUserRole(target.id, editor.roleId);
	await addUserRole(nonAdmin.id, editor.roleId);
	const nonAdminCaller = callerAs({ id: nonAdmin.id, name: nonAdmin.name, isSuper: false });

	const updated = await nonAdminCaller.user.update({
		id: target.id,
		name: `${target.name}_非admin改`,
		email: `${target.id}@example.com`,
		image: "",
		emailVerified: false,
		roleIds: [editor.roleId],
		departmentIds: [],
	});
	assert.equal(updated.name, `${target.name}_非admin改`, "非 admin 改普通用户应该放行");
});

test("user.remove:被删的人是 admin 时拒", async () => {
	const target = await createPlainUser("admin-remove-target");
	const nonAdmin = await createPlainUser("non-admin-remover");
	const adminRoleRow = await getSystemAdminRoleRow();
	await addUserRole(target.id, adminRoleRow.id);

	const editor = await buildNonAdminEditorRole();
	await addUserRole(nonAdmin.id, editor.roleId);
	const nonAdminCaller = callerAs({ id: nonAdmin.id, name: nonAdmin.name, isSuper: false });

	await assertRejects(() => nonAdminCaller.user.remove({ ids: [target.id] }), "不能删除管理员账号");

	// 库里的用户还在(被拒后不该删)
	const [row] = await db.select().from(sysUser).where(eq(sysUser.id, target.id));
	assert.ok(row, "被拒后用户应该还在库");
});

test("user.import:批量开账号 —— 新邮箱真能登录,角色 / 部门挂上,不留会话", async () => {
	const emailA = `${TEST_PREFIX}import-a_${SUFFIX}@example.com`;
	const emailB = `${TEST_PREFIX}import-b_${SUFFIX}@example.com`;
	// 角色 / 部门都按**名字**解析 —— 用库里现成的一行
	const roleRow = await getSystemAdminRoleRow();
	const [deptRow] = await db.select({ id: sysDept.id, name: sysDept.name }).from(sysDept).limit(1);
	assert.ok(deptRow, "库里应该有部门");

	const result = await caller.user.import({
		rows: [
			{ name: "导入甲", email: emailA, password: PASSWORD, roles: "系统管理员", departments: deptRow.name },
			// 邮箱大小写混写 → 库里应统一成小写
			{ name: "导入乙", email: emailB.toUpperCase(), password: PASSWORD },
		],
	});
	assert.equal(result.created, 2, "两行都建了");
	assert.equal(result.errors.length, 0);
	assert.equal(result.duplicates.length, 0);

	const createdRows = await db
		.select({ id: sysUser.id, email: sysUser.email })
		.from(sysUser)
		.where(inArray(sysUser.email, [emailA, emailB]));
	assert.equal(createdRows.length, 2, "库里应该有这两个账号");
	for (const row of createdRows) createdIds.push(row.id);
	const idA = createdRows.find((row) => row.email === emailA)?.id;
	assert.ok(idA, "导入的邮箱落库时是小写");

	// ① 不留会话 —— 导入完不该有人「顺手登录」
	assert.equal((await db.select().from(sysSession).where(eq(sysSession.userId, idA))).length, 0);
	// ② 角色挂上(策略表的 g 行)、部门挂上(成员表)
	const gRows = await db
		.select()
		.from(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, "g"), eq(sysCasbinRule.v0, `user:${idA}`)));
	assert.deepEqual(
		gRows.map((row) => row.v1),
		[`role:${roleRow.id}`],
	);
	const members = await db.select().from(sysUserDept).where(eq(sysUserDept.user_id, idA));
	assert.deepEqual(
		members.map((row) => row.department_id),
		[deptRow.id],
	);
	// ③ 真能登录:密码确实被 BA 哈希进 sys_account 了
	const signIn = await auth.api.signInEmail({
		body: { email: emailA, password: PASSWORD },
		headers: await captchaHeaders(),
		returnHeaders: true,
	});
	assert.ok(signIn?.response?.user, "导入出来的账号应该能登录");
	assert.equal(signIn.response.user.id, idA);
});

test("user.import:只建不改 + 逐行校验 —— 坏行进 errors,已有邮箱进 duplicates,好行照样建", async () => {
	const existing = await caller.user.create({
		name: "导入占位",
		email: `${TEST_PREFIX}import-exist_${SUFFIX}@example.com`,
		password: PASSWORD,
	});
	createdIds.push(existing.id);
	const emailNew = `${TEST_PREFIX}import-new_${SUFFIX}@example.com`;

	const result = await caller.user.import({
		rows: [
			{ name: "", email: `${TEST_PREFIX}import-noname_${SUFFIX}@example.com`, password: PASSWORD },
			{ name: "坏邮箱", email: "not-an-email", password: PASSWORD },
			{ name: "短密码", email: `${TEST_PREFIX}import-short_${SUFFIX}@example.com`, password: "123" },
			{
				name: "角色不存在",
				email: `${TEST_PREFIX}import-role_${SUFFIX}@example.com`,
				password: PASSWORD,
				roles: "根本不存在的角色",
			},
			{ name: "重复占位", email: existing.email, password: PASSWORD },
			{ name: "导入新", email: emailNew, password: PASSWORD },
			// 同一批里与上一行邮箱重复 → 只认第一条
			{ name: "同批重复", email: emailNew, password: PASSWORD },
		],
	});
	assert.equal(result.created, 1, "只有「导入新」那一行该建");
	assert.equal(result.duplicates.length, 1);
	assert.match(result.duplicates[0]?.message ?? "", /已经存在,已跳过/);
	assert.equal(result.errors.length, 5);
	assert.match(result.errors[0]?.message ?? "", /缺少「姓名」/);
	assert.match(result.errors[1]?.message ?? "", /格式不对/);
	assert.match(result.errors[2]?.message ?? "", /至少 8 位/);
	assert.match(result.errors[3]?.message ?? "", /不存在/);
	assert.match(result.errors[4]?.message ?? "", /出现了多次/);

	// 已有的账号**没被动过**(导入只建不改)
	const [kept] = await db.select().from(sysUser).where(eq(sysUser.id, existing.id));
	assert.equal(kept?.name, "导入占位");
	// 好行真落库了
	const [fresh] = await db.select().from(sysUser).where(eq(sysUser.email, emailNew));
	assert.ok(fresh, "合法那行应该建出来");
	createdIds.push(fresh.id);
});
