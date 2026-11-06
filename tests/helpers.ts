/**
 * 测试公共脚手架。
 *
 * 为什么直接调 tRPC procedure 而不是发 HTTP:
 *  `integrations/trpc/init.ts` 导出了 `createCallerFactory`,文档里写明用途就是「脚本 / 测试 /
 *  SSR loader 直接调 procedure,不走 HTTP」。于是测试不需要起服务、不需要端口、也不需要 mock fetch,
 *  测的就是真实的 procedure + 真实 SQL。
 *
 * ⚠️ 这些是**集成测试**,会真的读写 `.env.local` 指向的库。两条纪律:
 *  1. 测试数据一律用 `TEST_PREFIX` 打头的键 / 名称,结束必须清干净(tRPC 调用 `after` 里删);
 *  2. 测试之间不要依赖执行顺序 —— 每条用例自己建、自己删。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createChallenge, verifyCaptcha } from "captchakit/server";
import { and, eq, inArray } from "drizzle-orm";
import { sysCasbinRule, sysLog, sysRole } from "../src/db/data-base-schema.ts";
import { db, dmPool } from "../src/db/index.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { flushAuditWrites } from "../src/lib/audit.ts";
import { ensureCaptchaSecret } from "../src/lib/captcha-secret.ts";

/** 测试数据统一前缀:方便一眼认出、也方便误留时清理 */
export const TEST_PREFIX = "__test__";

/**
 * 测试数据用的唯一后缀 —— **固定 10 字符**(毫秒戳 8 + 随机 2)。
 *
 * 为什么定长:`testId` 按列宽算「中间留多少字符给业务标签」,尾段必须是定长才能算预算。
 * `Date.now().toString(36)` 已 8 位,随机段补 0 到 2 位,合起来恰好 10。冲突概率:
 * 同毫秒内撞上同一随机段 ≈ 1/1296,作为 fixture 标识够用了 —— 实测重复跑不会撞。
 */
export function uniqueSuffix(): string {
	const t = Date.now().toString(36).padStart(8, "0").slice(-8);
	const r = Math.floor(Math.random() * 1296)
		.toString(36)
		.padStart(2, "0");
	return t + r;
}

/**
 * 测试主键(`sys_dept.id`/`sys_user.id`/`sys_user_dept.id` …)。
 *
 * ⚠️ **必须守住列宽**:模板里这些 id 列多为 `varchar(32)`(`sys_user.*` 是 36)。
 * 直接拼 `${TEST_PREFIX}${kind}-${label}-${suffix}` 会在 `label` 是中文长名(`角色规则-甲镇网格组`)
 * 时超长,MySQL 报 `ER_DATA_TOO_LONG` ⇒ 这条 fixture 插不进库,整条用例就挂。
 * 达梦上之所以"看起来过得了",只是因为那台库是早期更宽的字段版本 —— 不应该让测试依赖**库**的宽松。
 *
 * 策略:算清预算,中间段塞得下就用原文(读性好),塞不下就**截 + 短散列**(确定性去重,
 * 同一个 label 在同一文件里截出来的结果一致)。
 */
export function testId(kind: string, label: string, suffix: string, maxLength = 32): string {
	const head = `${TEST_PREFIX}${kind}-`;
	const tail = `-${suffix}`;
	const room = maxLength - head.length - tail.length;
	if (label.length <= room) return `${head}${label}${tail}`;
	// 截中间:`head + 截 label + 分隔 + 短散列 + tail`
	const hashLen = 6;
	const keep = Math.max(1, room - 1 - hashLen);
	const hash = createHash("sha1").update(`${kind}|${label}|${suffix}`).digest("base64url").slice(0, hashLen);
	return `${head}${label.slice(0, keep)}-${hash}${tail}`;
}

/**
 * 直调 procedure 时**注入的用户**。
 *
 * 为什么必须注入:中间件要拿"当前用户",而直调 caller 压根没有请求上下文
 * (`getRequestHeaders()` 会抛)⇒ 不注入的话,加了登录校验之后**每个测试都会 401**。
 * `isSuper` 让它免去"造角色 + 授权"的样板 —— 这条注入路径**从网络不可达**
 * (HTTP 入口 `api.trpc.$.tsx` 没有 `createContext`),所以它不是后门。
 */
export const TEST_USER = { id: "test-admin", name: "测试管理员", isSuper: true };

/** 直调 procedure 的 caller(等价于服务端内部调用) */
export const caller = createCallerFactory(trpcRouter)({ user: TEST_USER });

/** **未登录**的 caller —— 用来断言"必须被拒"(在这之前根本没法测这一条) */
export const anonymousCaller = createCallerFactory(trpcRouter)({ user: null });

/**
 * 用**自定义身份**造一个 caller —— 覆盖 `id` / `name` / `isSuper`。
 *
 * 用途:admin 守卫测试要「非 admin 但有 `sys:user:edit` 权限」的角色 —— 不能用 `caller`
 * (它是 isSuper 短路,语义上就是 admin 替代品);也不能用 `anonymousCaller` (没有用户)。
 * 这里传 `isSuper: false` 让 permMiddleware 走真正的 casdb 校验路径 —— 调用前
 * 要保证该 user.id 在策略表里有 `sys:user:edit` 的授权链(用 `addUserRole` + `setRoleMenus`
 * 把对应菜单挂上 `sys:user:edit` 权限码)。HTTP 入口不可达,与 `TEST_USER` 同口径,不是后门。
 */
export function callerAs(user: { id: string; name: string; isSuper?: boolean }) {
	return createCallerFactory(trpcRouter)({ user });
}

/**
 * 清掉**这些操作人**留下的审计行(测试身份写的那些)。
 *
 * 必须先 `await flushAuditWrites()`:审计是 fire-and-forget,`after()` 常常比写库还快 ——
 * 不先等它落地,删的时候一行都查不到,然后就永久留在库里(实测漏过 14 行,
 * `operator_id` 是 `__test__u-队员A-…`,`path` 是 `demoGrid.update/remove/assign`)。
 * 按**精确 id** 删,不做模糊匹配:测试用户的 id 带唯一后缀,不可能撞到真实数据。
 */
export async function purgeTestAuditRows(operatorIds: readonly string[]): Promise<number> {
	await flushAuditWrites();
	const ids = [...operatorIds];
	if (ids.length === 0) return 0;
	const rows = await db.select({ id: sysLog.id }).from(sysLog).where(inArray(sysLog.operator_id, ids));
	if (rows.length === 0) return 0;
	await db.delete(sysLog).where(
		inArray(
			sysLog.id,
			rows.map((row) => row.id),
		),
	);
	return rows.length;
}

/**
 * 清掉指向**这批菜单**的授权策略行(测试收尾用)。
 *
 * 直接删表绕过了 `lib/casbin.ts` 的领域函数 ⇒ 调用方清完要自己 `clearCasbinCache()`
 * (这两个助手只管删行,不碰缓存 —— 有的收尾还要顺手删角色继承的 `g` 行,顺序由调用方定)。
 */
export async function purgeCasbinByMenuIds(menuIds: readonly string[]): Promise<void> {
	if (menuIds.length === 0) return;
	await db.delete(sysCasbinRule).where(
		and(
			eq(sysCasbinRule.ptype, "p"),
			inArray(
				sysCasbinRule.v1,
				menuIds.map((id) => `menu:${id}`),
			),
		),
	);
}

/** 清掉指向**这批用户**的成员关系 `g` 行(测试收尾用)—— 缓存口径同上 */
export async function purgeCasbinByUserIds(userIds: readonly string[]): Promise<void> {
	if (userIds.length === 0) return;
	await db.delete(sysCasbinRule).where(
		and(
			eq(sysCasbinRule.ptype, "g"),
			inArray(
				sysCasbinRule.v0,
				userIds.map((id) => `user:${id}`),
			),
		),
	);
}

/**
 * 清掉**这一个角色**在策略表里的全部引用 + 该角色行本身。
 *
 * 策略表里有两类行指向一个角色:
 *  - `p` 行的 `v0 = "role:<id>"` — 这个角色的授权(给哪些菜单);
 *  - `g` 行的 `v1 = "role:<id>"` — 谁继承了这个角色 / 它的成员。
 *
 * 直删表绕过了 `lib/casbin.ts` 的领域函数,调用方清完要自己 `clearCasbinCache()`
 * (跟 `purgeCasbinByMenuIds` / `purgeCasbinByUserIds` 同口径)。4 个测试文件
 * (casbin / role / user-crud / impersonate)都用同一段 `g`→`p`→`sys_role` 顺序清,集中到这里。
 */
export async function purgeRole(roleId: string): Promise<void> {
	const subject = `role:${roleId}`;
	await db.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, "p"), eq(sysCasbinRule.v0, subject)));
	await db.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, "g"), eq(sysCasbinRule.v1, subject)));
	await db.delete(sysRole).where(eq(sysRole.id, roleId));
}

/** 批量版 —— 给 `roleIds: string[]` 一次性清;空数组早退。`inArray` 拼 SQL 比循环调 `purgeRole` 少 4×round-trip */
export async function purgeRoles(roleIds: readonly string[]): Promise<void> {
	if (roleIds.length === 0) return;
	const subjects = roleIds.map((id) => `role:${id}`);
	await db.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, "p"), inArray(sysCasbinRule.v0, subjects)));
	await db.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, "g"), inArray(sysCasbinRule.v1, subjects)));
	await db.delete(sysRole).where(inArray(sysRole.id, roleIds));
}

/** 拿到库里**系统管理员**角色的 id —— admin-guard 用例反复在用,集中到这里免得每条用例自己筛 */
export async function getSystemAdminRoleRow(): Promise<{ id: string }> {
	const row = (await db.select({ id: sysRole.id, name: sysRole.name }).from(sysRole)).find(
		(item) => item.name === "系统管理员",
	);
	if (!row) throw new Error("库里没有「系统管理员」角色 —— 需要先跑 pnpm db:seed:rbac");
	return row;
}

/**
 * 答一道人机验证题,换一张 proof token —— 走的就是浏览器那条路(`/api/captcha` 的 GET + POST)。
 *
 * **登录是无条件要求验证码的**(见 `src/lib/auth.ts` 的 `hooks.before`),所以任何走登录的用例
 * 都得先换到 token,否则会被「请先完成人机验证」挡下来 —— 那不是用例想验的东西,是在验验证码。
 * 于是这一段样板集中在这里。
 *
 * `type: "number"` + `locale: "en"` 是**唯一能自动作答**的组合:`locale !== "fa"` 时 captchakit 的
 * `formatDigits` 原样返回数字串,题面即答案(`createChallenge` 本身永远不返回答案字段)。
 * `identifier` 每次都换 —— captchakit 按它限流 20 次/分钟,共用一个 key 会让并行跑的测试互相踩。
 *
 * 先调 `ensureCaptchaSecret()`:captchakit 的 `getSecret()` 调用时读 `process.env`,而密钥没配时
 * 登录钩子已经现场生成过一把了(见 `src/lib/captcha-secret.ts`)。这里再调一次是幂等的,
 * 只是保证「直接调本函数」也不会撞 `CAPTCHA_MISSING_SECRET`。
 */
export async function solveCaptcha(): Promise<string> {
	ensureCaptchaSecret();
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
 * 直调 `auth.api.signInEmail` 时要带的人机验证请求头。
 *
 * ⚠️ 只能用在**直调**上。走 `auth.handler(new Request(...))` 的用例(见 `tests/captcha.test.ts`)
 * 是自己构造 headers 的,不走这里 —— 那条路上 `ctx.request` 有值,取 header 的方式不一样。
 *
 * 为什么直调也能带上:`auth.api.*` 的钩子上下文里 `ctx.request` 是 `undefined`,
 * 只有 `ctx.getHeader()` 读得到传入的 headers(`src/lib/auth.ts` 的 `readCaptchaToken` 两条路都试)。
 */
export async function captchaHeaders(): Promise<Record<string, string>> {
	return { "x-captcha-token": await solveCaptcha() };
}

const NANOID_RE = /^[A-Za-z0-9_-]{21}$/;

/** 断言一个主键是 nanoid(21 位 URL 安全随机串) */
export function assertNanoid(value: unknown, label = "id"): void {
	assert.equal(typeof value, "string", `${label} 应为字符串`);
	assert.match(value as string, NANOID_RE, `${label} 应是 nanoid,实际是 ${String(value)}`);
}

/**
 * 关掉 MySQL 连接池。
 *
 * **每个测试文件都必须在最后一个 `after` 里调它**:node:test 会等事件循环里的空闲句柄,
 * 池不关进程就不退出 —— 症状是"测试跑完了但不返回",CI 里直接卡到超时。
 */
export async function closeDb(): Promise<void> {
	// 达梦分支没有 mysql2 那个 $client,用它自己的 pool.close();MySQL 分支照旧
	if (dmPool) {
		await dmPool.close();
		return;
	}
	await db.$client.end();
}

/** 断言 promise 以 tRPC 错误拒绝,并包含给定文案片段 */
export async function assertRejects(fn: () => Promise<unknown>, fragment: string): Promise<void> {
	let caught: unknown = null;
	try {
		await fn();
	} catch (error) {
		caught = error;
	}
	assert.ok(caught, `期望抛错(含「${fragment}」),但调用成功了`);
	const message = caught instanceof Error ? caught.message : String(caught);
	assert.ok(message.includes(fragment), `错误信息里应含「${fragment}」,实际是「${message}」`);
}
