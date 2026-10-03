/**
 * 登录风控(`src/lib/auth-lockout.ts` + better-auth `hooks`)回归。
 *
 * 覆盖:
 *  1. 业务层 `recordSignInFailure` + `isAccountLocked`:连续失败到阈值即锁,5 分钟外的旧失败会清零,
 *     `manualUnlock` 真删行;`clearSignInFailures` 真把计数清零;
 *  2. better-auth `hooks.after` 接通:错密码登录会记一次失败(走 `auth.api.signInEmail`);
 *  3. better-auth `hooks.before` 接通:账号被锁后,正确密码也会被拦 —— 通过 `assert.rejects`
 *     拦截到「账号已被锁定」错误即可。
 *
 * 这套用例**走真实 DB**(`sys_account_lockout` 表);每个 case 都用唯一邮箱,`after` 一次性清干净。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { eq } from "drizzle-orm";
import { sysAccount, sysSession, sysUser } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { auth } from "../src/lib/auth.ts";
import {
	clearSignInFailures,
	isAccountLocked,
	listCurrentlyLocked,
	manualUnlock,
	recordSignInFailure,
	resetLockoutConfig,
	setLockoutConfig,
} from "../src/lib/auth-lockout.ts";
import { closeDb, TEST_PREFIX } from "./helpers.ts";

const PASSWORD = "Passw0rd!123";
const NAME = "风控测试";

/** 单测里把阈值临时调小(2 次失败即锁),不用 5 次 —— 跑得更快,语义不变。 */
before(() => {
	setLockoutConfig({ threshold: 2, durationMs: 60_000, windowMs: 5 * 60_000 });
});

after(async () => {
	resetLockoutConfig();
	// 按外键顺序清:session → account → user(避免 1451)
	const ids = (
		await db
			.select({ id: sysUser.id })
			.from(sysUser)
			.where(eq(sysUser.email, `${TEST_PREFIX}lockout_%`))
	).map((r) => r.id);
	if (ids.length > 0) {
		await db.delete(sysSession).where(eq(sysSession.userId, ids[0] as string));
		// 一次 inArray 搞定
		const { inArray } = await import("drizzle-orm");
		await db.delete(sysSession).where(inArray(sysSession.userId, ids));
		await db.delete(sysAccount).where(inArray(sysAccount.userId, ids));
		await db.delete(sysUser).where(inArray(sysUser.id, ids));
	}
	await closeDb();
});

/** 创建一个账号 + 登录一次,确保 `sys_user` 行存在 → `signInEmail` 能找到 */
async function makeUser(suffix: string): Promise<{ email: string }> {
	const email = `${TEST_PREFIX}lockout_${suffix}@example.com`;
	await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: NAME } });
	// 顺手解一次,避免上一轮跑挂掉留锁
	await clearSignInFailures(email);
	return { email };
}

test("recordSignInFailure:连续失败到阈值即锁,返回 locked=true", async () => {
	const { email } = await makeUser(`record_${Date.now()}_a`);
	assert.deepEqual(await isAccountLocked(email), { locked: false });

	const r1 = await recordSignInFailure(email, "127.0.0.1");
	assert.equal(r1.failedAttempts, 1);
	assert.equal(r1.locked, false);

	const r2 = await recordSignInFailure(email, "127.0.0.1");
	assert.equal(r2.failedAttempts, 2);
	assert.equal(r2.locked, true, "达到阈值应该被锁");

	const locked = await isAccountLocked(email);
	assert.equal(locked.locked, true);
	if (locked.locked) assert.ok(locked.remainingMs > 0, "剩余时间应为正");
});

test("clearSignInFailures:成功后清零失败计数 + 解锁", async () => {
	const { email } = await makeUser(`clear_${Date.now()}_b`);
	await recordSignInFailure(email, "127.0.0.1");
	await recordSignInFailure(email, "127.0.0.1");
	assert.equal((await isAccountLocked(email)).locked, true, "应被锁");

	await clearSignInFailures(email);
	const status = await isAccountLocked(email);
	assert.equal(status.locked, false, "clearSignInFailures 后应解锁");

	// 之后再失败又从 1 开始累
	const r = await recordSignInFailure(email, null);
	assert.equal(r.failedAttempts, 1, "计数应重新从 1 开始");
});

test("manualUnlock:真正把行删掉,不是清字段", async () => {
	const { email } = await makeUser(`manual_${Date.now()}_c`);
	await recordSignInFailure(email, "127.0.0.1");
	await recordSignInFailure(email, "127.0.0.1");
	await manualUnlock(email);
	assert.equal((await isAccountLocked(email)).locked, false);
});

test("hooks.after 接通:错密码登录 → 失败计数 +1", async () => {
	const { email } = await makeUser(`hook_after_${Date.now()}_d`);
	await clearSignInFailures(email);

	await assert.rejects(async () => {
		await auth.api.signInEmail({ body: { email, password: "wrong-password-xxx" } });
	}, "错密码应抛错");

	// 等 hooks.after 的 fire-and-forget 落库(实测 100ms 内)
	await new Promise((r) => setTimeout(r, 100));
	const status = await isAccountLocked(email);
	if (status.locked) throw new Error("只失败 1 次不应锁住");
});

test("hooks.before 接通:账号被锁后,正确密码也被拦", async () => {
	const { email } = await makeUser(`hook_before_${Date.now()}_e`);
	// 用业务层 API 把账号锁住(测试里调用一次 +1,触发锁定)
	await recordSignInFailure(email, "127.0.0.1");
	await recordSignInFailure(email, "127.0.0.1");
	assert.equal((await isAccountLocked(email)).locked, true, "前置:账号应被锁");

	// 即便密码正确,也被拦截
	let caught: unknown = null;
	try {
		await auth.api.signInEmail({ body: { email, password: PASSWORD } });
	} catch (err) {
		caught = err;
	}
	assert.ok(caught, "锁定期间正确密码也应被拒");
	const message = caught instanceof Error ? caught.message : String(caught);
	assert.match(message, /锁定|lockout|locked|TOO_MANY_REQUESTS/i, `错误信息应说明被锁,实际:${message}`);
});

test("listCurrentlyLocked:只返回仍在锁的账号,过期的不算", async () => {
	const { email: e1 } = await makeUser(`list_${Date.now()}_f1`);
	await recordSignInFailure(e1, "127.0.0.1");
	await recordSignInFailure(e1, "127.0.0.1");

	const list = await listCurrentlyLocked();
	const ourEntry = list.find((r) => r.email === e1);
	assert.ok(ourEntry, "我们刚锁的账号应在列表里");
	assert.ok(ourEntry && ourEntry.lockedUntil.getTime() > Date.now(), "lockedUntil 应在未来");

	// 解锁后就不在了
	await manualUnlock(e1);
	const list2 = await listCurrentlyLocked();
	assert.equal(
		list2.find((r) => r.email === e1),
		undefined,
		"解锁后应从列表消失",
	);
});
