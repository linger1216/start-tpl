/**
 * 人机验证(CaptchaKit 自托管)在登录链路上的回归。
 *
 * 覆盖 `src/lib/auth.ts` 里 `hooks.before` 的那段校验:
 *  1. **没配 `CAPTCHAKIT_SECRET` 照样要验证码** —— 这是本轮改掉的关键口径:以前「有没有配密钥」
 *     兼作开关,现在密钥由 `src/lib/captcha-secret.ts` 兜底生成,安全功能没有「默认关」这个状态;
 *  2. `ensureCaptchaSecret()` 自己的三条约定(已配原样返回 / 没配现场生成并回填 / 幂等不换);
 *  3. **不带 token** → 400「请先完成人机验证」;
 *  4. 带了**编造的 token** → 400「人机验证失败」;
 *  5. 带了**真 token**(真答题换来的 proof token)→ 放行,能登进去;密码错仍照常被拒;
 *  6. proof token **一次性** —— 同一个 token 提交第二次必须失败。
 *  7. **开关关掉后不带 token 也能登录** —— 参数 `login.captcha_enabled`(默认 true);
 *     服务端钩子与登录页读同一个值,这里只覆盖服务端那一半(前端在 `routes/login.tsx`)。
 *
 * ⚠️ **为什么走 `auth.handler(Request)` 而不是 `auth.api.signInEmail(...)`**:
 * better-auth 的 `hooks` 只在**有请求上下文**时才拿得到 header。直调 `auth.api.*` 时
 * `ctx.request` 是 `undefined`(只有 `ctx.getHeader()` 读得到传入的 headers),而且 body 会被
 * 端点的 zod schema 剥掉多余字段 —— 所以直调那条路虽然也能带上 token(`src/lib/auth.ts` 的
 * `readCaptchaToken` 两条路都试),却测的不是生产行为。
 * `auth.handler(Request)` 就是 `routes/api/auth/$.ts` 走的那条路(`src/routes/api/auth/$.ts:41`),
 * 于是这里测的就是真链路:绕过前端直接 POST `/api/auth/sign-in/email` 也照样被拦。
 *
 * ⚠️ 能在测试里改 `CAPTCHAKIT_SECRET`:captchakit 的 `getSecret()` 是**调用时**读 `process.env`
 * (`node_modules/captchakit/dist/server/index.js`),不是模块加载时固化 ⇒ 运行时改即时生效。
 * 同理 `createChallenge` / `verifyCaptcha` 共用模块级 `getDefaultStore()` 单例,
 * 所以「出题 — 答题 — 换 proof token — 拿去登录」这条链在测试里走得通。
 *
 * 这套用例走真实 DB(建账号 + 真登录);邮箱一律 `__test__captcha_*`,`after` 一次性清干净。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createChallenge, verifyCaptcha } from "captchakit/server";
import { inArray, like } from "drizzle-orm";
import { sysAccount, sysAccountLockout, sysPara, sysSession, sysUser } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { auth } from "../src/lib/auth.ts";
import { ensureCaptchaSecret } from "../src/lib/captcha-secret.ts";
import { newId } from "../src/lib/ids.ts";
import { CAPTCHA_ENABLED_KEY, PARA_TYPE } from "../src/lib/para-spec.ts";
import { clearParaCache } from "../src/lib/sys-para.ts";
import { closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

const PASSWORD = "Passw0rd!123";
const NAME = "验证码测试";
/** captchakit 要求至少 32 个字符;固定值即可 —— 测试密钥没有保密需求,但不能短于下界 */
const SECRET = "__test__captcha_secret_at_least_32_chars__";
/** better-auth 的 origin 校验要比对 origin 头,这个值代码里已内置放行 */
const ORIGIN = "http://localhost:3000";

/** 本仓库 `.env.local` 里的原值(通常是空 ⇒ 第 1 条用例靠它还原真实初始态) */
const ORIG_SECRET = process.env.CAPTCHAKIT_SECRET;

before(() => {
	process.env.CAPTCHAKIT_SECRET = SECRET;
});

after(async () => {
	if (ORIG_SECRET === undefined) delete process.env.CAPTCHAKIT_SECRET;
	else process.env.CAPTCHAKIT_SECRET = ORIG_SECRET;
	const mine = (
		await db
			.select({ id: sysUser.id, email: sysUser.email })
			.from(sysUser)
			.where(like(sysUser.email, `${TEST_PREFIX}captcha_%`))
	).filter((r) => r.email.startsWith(`${TEST_PREFIX}captcha_`));
	const ids = mine.map((r) => r.id);
	if (ids.length > 0) {
		await db.delete(sysSession).where(inArray(sysSession.userId, ids));
		await db.delete(sysAccount).where(inArray(sysAccount.userId, ids));
		await db.delete(sysUser).where(inArray(sysUser.id, ids));
		await db.delete(sysAccountLockout).where(
			inArray(
				sysAccountLockout.email,
				mine.map((r) => r.email),
			),
		);
	}
	await closeDb();
});

async function makeUser(label: string): Promise<string> {
	const email = `${TEST_PREFIX}captcha_${label}@example.com`;
	await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: NAME } });
	return email;
}

/**
 * 走真 HTTP 链路发一次登录 —— 返回状态码 / 响应文案 / 会话 token。
 *
 * `ip` 必传且**每条用例各不相同**:better-auth 对 `/sign-in/email` 配了 60 秒 5 次的限流
 * (`src/lib/auth.ts` 的 rateLimit),而限流键是来源 IP —— 同 IP 连着登就是 429。
 * 这里每次给一个不同的 `x-forwarded-for`,让各条用例的限流桶互不干扰。
 */
async function signIn(
	email: string,
	password: string,
	ip: string,
	proof?: string,
): Promise<{ status: number; message: string; token?: string }> {
	const headers = new Headers({
		"content-type": "application/json",
		origin: ORIGIN,
		"x-forwarded-for": ip,
	});
	if (proof) headers.set("x-captcha-token", proof);
	const response = await auth.handler(
		new Request(`${ORIGIN}/api/auth/sign-in/email`, {
			method: "POST",
			headers,
			body: JSON.stringify({ email, password }),
		}),
	);
	const body = (await response.json().catch(() => ({}))) as { message?: string; token?: string };
	return { status: response.status, message: body.message ?? "", token: body.token };
}

/**
 * 每次给一个**合法且不重复**的 IPv4 来源。
 *
 * 必须是合法 IP:better-auth 的 `getIP` 会先按 `z.ipv4()/z.ipv6()` 校验 `x-forwarded-for`,
 * 非法值直接当「拿不到 IP」⇒ 退回 localhost ⇒ 所有用例挤进同一个限流桶,跑到第 5 次就 429。
 * 所以这里不能用 `uniqueSuffix()`(那是 base36,压根不是 IP)。
 *
 * 限流桶按 IP + 路径分:各条用例各拿一个 IP,彼此的 60 秒 5 次额度互不干扰。
 */
let ipCounter = 0;
function freshIp(): string {
	ipCounter += 1;
	return `10.99.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

/**
 * 答一道题换 proof token —— 用的就是浏览器那条路(`/api/captcha` 的 GET + POST)。
 *
 * `type: "number"` + `locale: "en"` 是**唯一能自动作答**的组合:`locale !== "fa"` 时
 * `formatDigits` 原样返回数字串,题面即答案。`identifier` 每次都换 —— captchakit 按它限流
 * (20 次/分钟),共用一个 key 会让并行跑的测试互相踩。
 */
async function solveCaptcha(): Promise<string> {
	const challenge = await createChallenge({
		type: "number",
		difficulty: "easy",
		locale: "en",
		identifier: uniqueSuffix(),
	});
	const answer = challenge.challenge.display;
	assert.ok(answer, "number 题必须带 display(题面)");
	const verified = await verifyCaptcha({ token: challenge.token, answer });
	assert.equal(verified.success, true, "答案正确应该换到 proof token");
	assert.ok(verified.token, "proof token 不能为空");
	return verified.token;
}

/**
 * 临时把 `CAPTCHAKIT_SECRET` 摘掉跑一段,再原样放回去。
 *
 * 单独抽出来是因为第 1、2 条用例都要这个前置状态,而 `after` 只在整份文件跑完后才恢复全局变量 ——
 * 中途抛错的话 `SECRET` 就留在被摘掉的状态上了,后面几条用例会以一个从没想过的配置在跑。
 */
async function withoutSecret<T>(fn: () => Promise<T>): Promise<T> {
	const saved = process.env.CAPTCHAKIT_SECRET;
	delete process.env.CAPTCHAKIT_SECRET;
	try {
		return await fn();
	} finally {
		if (saved === undefined) delete process.env.CAPTCHAKIT_SECRET;
		else process.env.CAPTCHAKIT_SECRET = saved;
	}
}

test("没配 CAPTCHAKIT_SECRET:照样要求验证码(密钥由 captcha-secret 兜底生成)", async () => {
	const email = await makeUser(`off_${uniqueSuffix()}`);
	const res = await withoutSecret(() => signIn(email, PASSWORD, freshIp()));
	assert.equal(res.status, 400, "没配密钥不等于关掉人机验证 —— 兜底生成一把就照常校验");
	assert.equal(res.message, "请先完成人机验证");
});

test("ensureCaptchaSecret:已配的值原样返回,不覆盖", async () => {
	process.env.CAPTCHAKIT_SECRET = SECRET;
	assert.equal(ensureCaptchaSecret(), SECRET, "配了就该用配的那把,不能偷偷换掉");
});

test("ensureCaptchaSecret:没配时现场生成并回填 process.env,且够长", async () => {
	const generated = await withoutSecret(async () => {
		const value = ensureCaptchaSecret();
		assert.equal(process.env.CAPTCHAKIT_SECRET, value, "生成后必须回填 process.env,否则 captchakit 读不到");
		return value;
	});
	assert.match(generated, /^[0-9a-f]{64}$/, "应为 32 字节 hex(64 字符)—— captchakit 的下界是 32 字符");
});

test("ensureCaptchaSecret:幂等 —— 反复调不会换密钥", async () => {
	await withoutSecret(async () => {
		const first = ensureCaptchaSecret();
		// 再摘一次:即使环境变量被清掉,模块内缓存也要顶住,否则重启一次换一把密钥
		// 会把所有在途的 proof token 作废,登录页上已经答好的题全部白答。
		delete process.env.CAPTCHAKIT_SECRET;
		assert.equal(ensureCaptchaSecret(), first, "同一进程里不该换密钥");
	});
});

test("不带 token:挡在门外(绕过前端直打也一样)", async () => {
	const email = await makeUser(`none_${uniqueSuffix()}`);
	const res = await signIn(email, PASSWORD, freshIp());
	assert.equal(res.status, 400);
	assert.equal(res.message, "请先完成人机验证");
});

test("带编造的 token:人机验证失败", async () => {
	const email = await makeUser(`fake_${uniqueSuffix()}`);
	const res = await signIn(email, PASSWORD, freshIp(), "not-a-real-proof-token");
	assert.equal(res.status, 400);
	assert.equal(res.message, "人机验证失败,请重试");
});

test("带真 token:放行;密码错仍照常被拒", async () => {
	const email = await makeUser(`ok_${uniqueSuffix()}`);
	const ok = await signIn(email, PASSWORD, freshIp(), await solveCaptcha());
	assert.equal(ok.status, 200, `验证码对 + 密码对应该能登进去,实际 ${ok.status} ${ok.message}`);
	assert.ok(ok.token, "应拿到会话 token");

	// 验证码过了不代表密码对 —— 校验只解决「是不是人」,密码仍由 better-auth 自己判
	const wrong = await signIn(email, "wrong-password-xxx", freshIp(), await solveCaptcha());
	assert.equal(wrong.status, 401, "密码错仍该是 401(别把验证码变成绕过密码的口子)");
});

test("proof token 是一次性的:同一个 token 提交第二次必须失败", async () => {
	const email = await makeUser(`once_${uniqueSuffix()}`);
	const proof = await solveCaptcha();
	// 同一个 IP 连登两次(重放就在第二次)—— 仍在 60 秒 5 次的限流额度里
	const ip = freshIp();
	const first = await signIn(email, PASSWORD, ip, proof);
	assert.equal(first.status, 200, `首次应该放行,实际 ${first.status} ${first.message}`);
	const replay = await signIn(email, PASSWORD, ip, proof);
	assert.equal(replay.status, 400, "proof token 已被消费过,重放应该失败");
	assert.equal(replay.message, "人机验证失败,请重试");
});

/**
 * 改「人机验证」开关并**清掉参数缓存**。
 *
 * `getParaBool` 带 30 秒缓存(`lib/sys-para.ts`),不清缓存就会读到旧值 —— 症状是
 * 「参数明明改成 false 了,登录还是被 400 挡下」。断言失败时先怀疑这一步。
 */
async function setCaptchaEnabled(enabled: boolean): Promise<void> {
	const value = String(enabled);
	await db
		.insert(sysPara)
		.values({
			id: newId(),
			para_key: CAPTCHA_ENABLED_KEY,
			para_value: value,
			para_type: PARA_TYPE.BOOL,
			para_group: "登录",
		})
		.onDuplicateKeyUpdate({ set: { para_value: value } });
	clearParaCache();
}

/**
 * 7. **开关关掉后,不带 token 也能登录** —— 参数 `login.captcha_enabled`(默认 `true`)。
 *
 * 这里只测**服务端那一半**(`lib/auth.ts` 的 `/sign-in/email` 钩子);前端画不画验证码栏在
 * `routes/login.tsx`,由同一个参数经 `createServerFn` 拿值。用例收尾必须还原成 `true`。
 */
test("开关关掉:login.captcha_enabled=false 时,不带 proof token 也能登录", async () => {
	const email = await makeUser(`off_${uniqueSuffix()}`);
	await setCaptchaEnabled(false);
	try {
		const res = await signIn(email, PASSWORD, freshIp());
		assert.equal(
			res.status,
			200,
			`关掉人机验证后不带 token 也该放行,实际 ${res.status} ${res.message}` +
				"(若仍是 400「请先完成人机验证」,先确认 setCaptchaEnabled 里的 clearParaCache 生效了)",
		);
	} finally {
		await setCaptchaEnabled(true);
	}
});
