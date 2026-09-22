/**
 * Better Auth 基础功能 —— 集成测试(走真实 DB,不 mock)。
 *
 * 覆盖:`signUpEmail`(注册)→ `signInEmail`(登录)→ `getSession`(带 cookie 取会话)
 * → 错密码被拒 → `signOut`(登出),每一步都回查 **库里真的落了什么行**。
 *
 * 为什么值得单测:Better Auth 的字段名 / 类型是它自己的口径(`emailVerified` 是布尔、
 * `created_at` 是时间、`id` 是它自己生成的字符串),`pnpm typecheck` **抓不到**这些不匹配 ——
 * 字段名错了它只在运行时报「Model xxx not found」。所以这里既测认证流程,也测
 * 「drizzle ↔ 驱动 ↔ 库」的类型往返(尤其布尔与时间)。
 *
 * ⚠️ 会读写 `.env.local` 指向的库(目前是达梦)。用户邮箱带 `__test__` 前缀,`after` 里清干净。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { eq } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { sysAccount, sysSession, sysUser } from "../src/db/data-base-schema.ts";
import { auth } from "../src/lib/auth.ts";
import { closeDb, TEST_PREFIX } from "./helpers.ts";

const EMAIL = `${TEST_PREFIX}ba_${Date.now()}@example.com`;
const PASSWORD = "Passw0rd!123";
const NAME = "测试用户";

/** 从 set-cookie 里抠出 `name=value` 那一截,喂给下一次请求的 headers */
function cookieOf(headers: Headers): string {
	const raw = headers.get("set-cookie") ?? "";
	return raw.split(";")[0] ?? "";
}

async function findUser() {
	const [row] = await db.select().from(sysUser).where(eq(sysUser.email, EMAIL));
	return row;
}

after(async () => {
	// 按外键顺序清:account → session → user(session/account 都 cascade,但显式删更稳)
	const u = await findUser();
	if (u) {
		await db.delete(sysAccount).where(eq(sysAccount.userId, u.id));
		await db.delete(sysSession).where(eq(sysSession.userId, u.id));
		await db.delete(sysUser).where(eq(sysUser.id, u.id));
	}
	await closeDb();
});

test("注册:落 user 行 + credential 账号行,密码是哈希不是明文", async () => {
	const res = await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: NAME } });
	assert.ok(res.user?.id, "注册应返回 user.id");

	const stored = await findUser();
	assert.ok(stored, "user 表里应有这一行");
	assert.equal(stored.email, EMAIL);
	assert.equal(stored.name, NAME);
	// 布尔往返:DDL 是 tinyint,驱动要把 0/1 变成 false/true(drizzle boolean 解码)
	assert.equal(stored.emailVerified, false, "emailVerified 应解码成布尔 false");

	const accounts = await db.select().from(sysAccount).where(eq(sysAccount.userId, stored.id));
	assert.equal(accounts.length, 1, "应有且仅有一条账号记录");
	assert.equal(accounts[0]?.providerId, "credential");
	assert.ok(accounts[0]?.password?.length, "应存了密码哈希");
	assert.notEqual(accounts[0]?.password, PASSWORD, "绝不能存明文密码");
});

test("登录:生成 session 行,token 与 cookie 一致", async () => {
	const stored = await findUser();
	// 注意:`signUpEmail` 会自动签一次(顺手建了会话),所以这里断言"增量 +1"而不是"恰好 1 条"
	const beforeCount = (await db.select().from(sysSession).where(eq(sysSession.userId, stored!.id))).length;

	const res = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, returnHeaders: true });
	const cookie = cookieOf(res.headers as Headers);
	assert.ok(cookie, "登录应下发 session cookie");

	const sessions = await db.select().from(sysSession).where(eq(sysSession.userId, stored!.id));
	assert.equal(sessions.length, beforeCount + 1, "登录应新增一条会话");
	// 时间往返:DDL 是 datetime,驱动 + drizzle 要解成 Date
	assert.ok(sessions[0]?.expiresAt instanceof Date, `expiresAt 应是 Date,实际 ${typeof sessions[0]?.expiresAt}`);
	assert.ok((sessions[0]?.expiresAt as Date).getTime() > Date.now(), "会话应在未来过期");
	// cookie 的值是 BA 签名后的串,**不等于**库里的原始 token —— 所以这里只验
	// 「拿回来的是 BA 的会话 cookie 且非空」;"这个 cookie 确实对应这条会话"由下面那条
	// getSession 用例负责(它才是端到端证据)。
	assert.match(cookie, /session_token=/, `应是 BA 的会话 cookie,实际:${cookie.slice(0, 40)}`);
	assert.ok(sessions[0]!.token.length > 10, "库里应存了会话 token");
});

test("取会话:带 cookie 能拿到当前用户", async () => {
	const signIn = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, returnHeaders: true });
	const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieOf(signIn.headers as Headers) }) });
	assert.ok(session, "应拿到会话");
	assert.equal(session.user.email, EMAIL);
	assert.equal(session.user.name, NAME);
});

test("密码错误:被拒且不新增会话", async () => {
	const before = await findUser();
	const beforeSessions = await db.select().from(sysSession).where(eq(sysSession.userId, before!.id));

	await assert.rejects(
		() => auth.api.signInEmail({ body: { email: EMAIL, password: "wrong-password-xxx" } }),
		"错密码应抛错",
	);

	const afterSessions = await db.select().from(sysSession).where(eq(sysSession.userId, before!.id));
	assert.equal(afterSessions.length, beforeSessions.length, "失败的登录不应留下会话");
});

test("登出:会话从库里消失", async () => {
	const signIn = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, returnHeaders: true });
	const headers = new Headers({ cookie: cookieOf(signIn.headers as Headers) });

	const stored = await findUser();
	const before = await db.select().from(sysSession).where(eq(sysSession.userId, stored!.id));
	assert.ok(before.length >= 1, "登出前应至少有一条会话(注册/登录留下的)");

	await auth.api.signOut({ headers });

	const afterSignOut = await db.select().from(sysSession).where(eq(sysSession.userId, stored!.id));
	assert.equal(afterSignOut.length, before.length - 1, "登出应恰好删掉这一条会话");
	assert.equal(await auth.api.getSession({ headers }), null, "登出后原 cookie 应取不到会话");
});
