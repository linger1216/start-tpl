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
import { after, test } from "node:test";

import { eq } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import {
	sysAccount,
	sysDept,
	sysUserDept,
	sysSession,
	sysUser,
	sysUserRole,
} from "../src/db/data-base-schema.ts";
import { auth } from "../src/lib/auth.ts";
import { assertRejects, caller, closeDb, ensureTestAdminPolicy, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const EMAIL = `${TEST_PREFIX}created_${SUFFIX}@example.com`;
const PASSWORD = "Passw0rd!123";

const createdIds: string[] = [];
/** 用例里临时建的部门(失败时也要清掉,别留在库里 —— 真的漏过一次) */
const tempDeptIds: string[] = [];

after(async () => {
	// 清库顺序必须「子表 → 父表 → 部门」:`sys_user_dept` / `sys_user_role` 的外键
	// 是 NO ACTION(MySQL 建表时真下手,达梦那套 DDL 没有),先删部门会被
	// `fk_sys_dm_department` 拦住 —— 拦一次后面全不执行,残留就攒下来了。
	// 登录步骤还会再建会话,所以 session 也要照清。
	for (const id of createdIds) {
		await db.delete(sysSession).where(eq(sysSession.userId, id));
		await db.delete(sysAccount).where(eq(sysAccount.userId, id));
		await db.delete(sysUserDept).where(eq(sysUserDept.user_id, id));
		await db.delete(sysUserRole).where(eq(sysUserRole.user_id, id));
		await db.delete(sysUser).where(eq(sysUser.id, id));
	}
	for (const id of tempDeptIds) {
		await db.delete(sysUserDept).where(eq(sysUserDept.department_id, id));
		await db.delete(sysDept).where(eq(sysDept.id, id));
	}
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
	const signIn = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, returnHeaders: true });
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
	await assertRejects(
		() => caller.user.create({ name: "重复", email: EMAIL, password: PASSWORD }),
		"已经被占用",
	);
});

test("user.update:改姓名与邮箱,库里真的变了", async () => {
	const created = await caller.user.create({
		name: "改名前",
		email: `${TEST_PREFIX}upd_${SUFFIX}@example.com`,
		password: PASSWORD,
	});
	createdIds.push(created.id);

	const nextEmail = `${TEST_PREFIX}upd_after_${SUFFIX}@example.com`;
	// 角色是全局的:编辑用户时一并覆盖保存(这里顺便给它一个角色)
	const role = (await caller.role.list())[0];
	assert.ok(role, "前置条件:库里至少要有一个角色");
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
	// 策略表已启用 ⇒ 引擎失败关闭:合成的 test-admin 身份必须先补一条无限制策略,否则列表是空的
	await ensureTestAdminPolicy();
	const listed = (await caller.user.list()).find((row) => row.id === created.id);
	assert.deepEqual(listed?.roleIds, [role.id], "角色分配应该被保存");
	assert.deepEqual(listed?.roleNames, [role.name], "角色名也应该带出来");

	const [row] = await db.select().from(sysUser).where(eq(sysUser.id, created.id));
	assert.equal(row.name, "改名后", "sys_user.name 应该已更新");
	assert.equal(row.email, nextEmail, "sys_user.email 应该已更新");
});

test("user.update:邮箱撞上别人时拒绝(不静默改坏唯一键)", async () => {
	const a = await caller.user.create({ name: "甲", email: `${TEST_PREFIX}dup_a_${SUFFIX}@example.com`, password: PASSWORD });
	const b = await caller.user.create({ name: "乙", email: `${TEST_PREFIX}dup_b_${SUFFIX}@example.com`, password: PASSWORD });
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
	// 不 push 到 createdIds —— 这条用例自己要把它删干净
	const dept = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}删除测试部门_${SUFFIX}` });
	tempDeptIds.push(dept.id);
	const role = (await caller.role.list())[0];
	assert.ok(role, "前置条件:库里至少要有一个角色");
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
	await auth.api.signInEmail({ body: { email: created.email, password: PASSWORD } });
	const before = await db.select().from(sysSession).where(eq(sysSession.userId, created.id));
	assert.ok(before.length > 0, "前置条件:登录后应该有会话");

	await caller.user.remove({ id: created.id });

	assert.equal((await db.select().from(sysUser).where(eq(sysUser.id, created.id))).length, 0, "sys_user 应该没了");
	assert.equal((await db.select().from(sysSession).where(eq(sysSession.userId, created.id))).length, 0, "会话应该被清掉");
	assert.equal((await db.select().from(sysAccount).where(eq(sysAccount.userId, created.id))).length, 0, "account 应该被清掉");
	assert.equal(
		(await db.select().from(sysUserDept).where(eq(sysUserDept.user_id, created.id))).length,
		0,
		"部门成员行应该被清掉",
	);
	assert.equal(
		(await db.select().from(sysUserRole).where(eq(sysUserRole.user_id, created.id))).length,
		0,
		"角色分配行也应该被清掉",
	);
	await caller.department.remove({ id: dept.id });
	tempDeptIds.pop();
});

test("user.remove:账号不存在时给 NOT_FOUND 而不是静默成功", async () => {
	await assertRejects(() => caller.user.remove({ id: "not-exists-id" }), "不存在");
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
	// 同上:先补无限制策略,`list` 才读得到(合成身份在库里不存在)
	await ensureTestAdminPolicy();
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
