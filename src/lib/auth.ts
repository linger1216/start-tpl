import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { verifyCaptcha } from "captchakit/server";

import { db } from "#/db";
import { sysAccount, sysSession, sysUser, sysVerification } from "#/db/data-base-schema";
import { userSwitchPlugin } from "#/lib/auth-debug";
import { clearSignInFailures, isAccountLocked, recordSignInFailure } from "#/lib/auth-lockout";
import { ensureCaptchaSecret } from "#/lib/captcha-secret";
import { logger } from "#/lib/logger";
import { sendMail } from "#/lib/mailer";
import { CAPTCHA_ENABLED_KEY } from "#/lib/para-spec";
import { purgeExpiredRateLimitsThrottled, rateLimitStorage } from "#/lib/rate-limit-storage";
import { getParaBool } from "#/lib/sys-para";

/**
 * Better Auth 的 origin 校验白名单。
 *
 * 浏览器 POST `/api/auth/*` 时,Better Auth 会比请求 `Origin` 头和这个列表:
 * - 不在列表里 → `Invalid origin: <origin>` → 403(也就是 portless 的
 *   `https://xxx.localhost`、自定义域名、自定义端口等场景的报错来源)
 * - 在列表里 → 放行
 *
 * 默认列表(`DEFAULT_TRUSTED_ORIGINS`)就是下面这两条:
 * - `http://localhost:3000`:`pnpm dev` 默认端口(直连)
 * - `https://*.localhost`:portless 的 `https://xxx.localhost`(单段通配,见下)
 *
 * 其它端口 / 域名(如 3000 被占时 Vite 飘到的 `http://localhost:4811`、自建域名 / 反向代理
 * 入口)都不写死在代码里,靠 `BETTER_AUTH_TRUSTED_ORIGINS` 环境变量追加(逗号分隔)。
 *
 * better-auth 1.7.4 的 `matchesOriginPattern`:
 * - 形如 `https://*.localhost`(含 `://` 与 `*`)→ 通配单段主机名;`**` 才能跨段。
 * - 因此 `https://*.localhost` 能覆盖 portless 的所有 `https://xxx.localhost`。
 * - 没有 `://` 的纯主机 glob(`*.localhost`)只比 host 不比 scheme,**不建议**用。
 */
const DEFAULT_TRUSTED_ORIGINS = ["http://localhost:3000", "https://*.localhost"];

/**
 * 从请求头里取人机验证的 proof token。
 *
 * 两条路都得试,因为 better-auth 有**两种进到钩子的方式**,两条路的上下文形状不一样(实测):
 *  - `auth.handler(new Request(...))` —— 生产真链路(`routes/api/auth/$.ts` 走这条),
 *    钩子里 `ctx.request` 有值,但 `ctx.getHeader` 不一定能拿到;
 *  - `auth.api.signInEmail({ body, headers })` —— 服务端内部直调 / 测试用,
 *    **`ctx.request` 是 `undefined`**,只有 `ctx.getHeader()` 读得到传入的 headers。
 *
 * 只写其中一条的后果很具体:测试用 `auth.api.*` 走时永远读不到 token,于是每条登录用例都被
 * 「请先完成人机验证」挡下来,查起来像是验证逻辑坏了,其实是读错了地方。
 */
function readCaptchaToken(ctx: { getHeader?: (name: string) => string | null; request?: Request }): string {
	const fromGetter = typeof ctx.getHeader === "function" ? ctx.getHeader("x-captcha-token") : null;
	return String(fromGetter ?? ctx.request?.headers.get("x-captcha-token") ?? "").trim();
}

function loadTrustedOrigins(): string[] {
	const extra = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	// 去重 + 保序,避免相同 origin 在列表里出现两次。
	const seen = new Set<string>();
	const out: string[] = [];
	for (const o of [...DEFAULT_TRUSTED_ORIGINS, ...extra]) {
		if (!seen.has(o)) {
			seen.add(o);
			out.push(o);
		}
	}
	return out;
}

/**
 * Better Auth 服务端实例 —— 认证的唯一入口。
 *
 * 本文件**只跑在服务端**:
 *  - 被 `src/routes/api/auth/$.ts` 的 `server.handlers` 引用(GET/POST 都交给 `auth.handler`);
 *  - 客户端不要 import 它(客户端走 `src/lib/auth-client.ts` 的 `createAuthClient()`);
 *  - 它 import 了 `#/db`,`#/db` 在 `DATABASE_URL` 缺失时直接抛错,所以 env 必须齐(见 `.env.example`)。
 *
 * 适配器:`drizzleAdapter(db, { provider: "mysql", schema: {...} })` —— 表定义在 `src/db/data-base-schema.ts`,
 * 迁移在 `./drizzle`。better-auth 按**模型名**在传给 adapter 的 schema 映射里找表(`user` / `session` / `account` /
 * `verification`),所以映射的**键名**不能改(值可以随便,DB 表名走 `sys_` 前缀);
 * DB 列名是 snake_case,drizzle 负责映射。
 *
 * 版本:实测 better-auth **1.7.4**(`package.json` 声明 `^1.5.3`)。1.7.x 的核心四表字段见
 * `doc/archive/表结构设计.md` §11.1;升级版本后请重新核对,字段变了 better-auth 会在运行时报
 * 「Model xxx not found」/「field not found」,typecheck 抓不到。
 *
 * 已经接好的部分:
 *  - 登录页 `/login`(`routes/login.tsx`,在后台外壳之外):邮箱 + 密码,成功后回 `?redirect=` 的原地址;
 *  - **整个后台都要登录**:`routes/(main)/route.tsx` 的 `beforeLoad` 在**服务端**读会话
 *    (`auth.api.getSession` + `getRequestHeaders()`),没有就 307 到登录页并带上原地址;
 *  - 顶栏用户菜单(个人资料 / 显示姓名 / 邮箱 / 退出登录),退出后 by 守卫自动回登录页;
 *  - **个人资料页** `/settings/profile`:改姓名(`updateUser`)、改密码(`changePassword`)、
 *    邮箱验证状态 + 重发验证信、改邮箱(`changeEmail`,走邮件确认);
 *  - 回归测试:`tests/better-auth.test.ts`(注册 / 登录 / 取会话 / 错密码 / 登出)。
 *
 * 未接的部分(**不开放自注册**,账号需要先在库里建 —— 见 AGENTS.md「认证」):
 *  - 业务字段(账号 / 手机号 / 所属部门 / 状态)与 RBAC 的绑定:TBD —— 走 better-auth 的
 *    `user.additionalFields` 或独立的用户资料表,**目前未加**,见 doc/archive/表结构设计.md §11.4;
 *  - 注册页 / 忘记密码:未做(不开放自注册,所以"注册"是管理员在用户台账里建账号;
 *    忘记密码同理走管理员重置 —— `user.ts` 的 `update` 能改邮箱,密码走 BA 的 `setPassword`);
 *  - 权限点下发给前端:已由 `menu.mine`(`lib/rbac.ts` 的 `effectiveMenusFor`)提供,
 *    前端挂载点见 `hooks/use-perms.ts`;
 *  - 第三方登录(微信 / 统一身份认证等):TBD,加 `socialProviders` 即可,表结构无需改动。
 */
export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "mysql",
		// better-auth 按**这里的键名**找模型(它不看 DB 表名),所以键必须是它写死的
		// user / session / account / verification;DB 里叫什么由 drizzle 的表定义决定(system 表,走 sys_ 前缀)。
		schema: { user: sysUser, session: sysSession, account: sysAccount, verification: sysVerification },
	}),
	emailAndPassword: {
		enabled: true,
		// 刻意**不开** requireEmailVerification:模板不发邮件(见下),开了等于谁都登不进来。
		// 真实项目接了邮件服务商以后,把这个开关打开就是"必须验证邮箱才能登录"。
	},
	/**
	 * 邮箱验证 —— 只提供**发送**能力,是否强制验证由上面那个开关决定。
	 *
	 * `sendVerificationEmail` 是 BA 在 `/send-verification-email`(重新发验证信)与
	 * 注册流程里回调我们的唯一出口;邮件本身走 `lib/mailer.ts`(开发态打到终端)。
	 * `expiresIn` 取 1 小时(BA 默认值,写出来是为了让人看见有这么个可调项)。
	 */
	emailVerification: {
		expiresIn: 60 * 60,
		sendVerificationEmail: async ({ user, url }) => {
			await sendMail({
				to: user.email,
				subject: "验证你的邮箱",
				text: `你好 ${user.name || user.email}:点下面的链接完成邮箱验证(1 小时内有效)。\n${url}`,
				link: url,
			});
		},
	},
	/**
	 * 改邮箱 —— BA 默认**关闭**这个端点(`user.changeEmail.enabled`),所以要显式打开。
	 *
	 * 走的是"发确认信 → 点链接才改"的往返:`sendChangeEmailConfirmation` 是那封信的出口。
	 * 关掉 `updateEmailWithoutVerification`(默认)是刻意的 —— 改邮箱是账号接管的第一手段,
	 * "谁改了谁的邮箱"必须留下一封可点的确认信。个人资料页 `/settings/profile` 是它的入口。
	 */
	user: {
		changeEmail: {
			enabled: true,
			sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
				await sendMail({
					to: newEmail,
					subject: "确认更换邮箱",
					text: `${user.name || user.email} 想把邮箱换成 ${newEmail}:点下面的链接确认。\n${url}`,
					link: url,
				});
			},
		},
	},
	trustedOrigins: loadTrustedOrigins(),
	/**
	 * 限流 + session cache 落地表(`sys_rate_limit`,A1)。
	 *
	 * `secondaryStorage` 同时被两件事用:
	 *  1. **限流计数**(BA 的 `rateLimit` 模块)—— 走 `count` 列。
	 *  2. **session cache**(BA 的 `internalAdapter.createSession` 镜写二级缓存)——
	 *     走 `value` 列(默认 BA **不再写 `sys_session` 表**;详见
	 *     `@better-auth/core/dist/db/adapter/factory.mjs:818` + `get-tables.mjs:197`:
	 *     「`secondaryStorage` + 不设 `storeSessionInDatabase` ⇒ `tables.session` 被删」)。
	 *
	 * 我们要保留 `sys_session` 表里的审计痕迹 —— 因为:
	 *  - 「用户在哪个 IP 登录 / 浏览器 UA」对审计日志(`sys_log`)是补充信息;
	 *  - 旧的 BA 测试断言「登录后 `sys_session` 多一行」,改测试成本远大于一行配置。
	 *
	 * 因此打开 `storeSessionInDatabase: true`,**两路都写** —— 读仍走 secondaryStorage
	 * (因为那是最新的,没有 DB cache invalidation 问题)。
	 *
	 * `customRules` 用 glob;`*` 通配单段 —— `/sign-in/*` 同时覆盖 email 与 token。
	 */
	secondaryStorage: rateLimitStorage,
	session: {
		// 让 BA 同时把 session 写进 `sys_session` 表;读仍走 secondaryStorage。
		storeSessionInDatabase: true,
	},
	rateLimit: {
		enabled: true,
		window: 10,
		max: 100,
		// 注释保留:`storage` 默认随 `secondaryStorage` 自动切换 —— 见上。
		// 想显式走内存:解开下面这一行注释,把 `secondaryStorage` 那行注释掉。
		// storage: "memory",
		customRules: {
			"/sign-in/email": { window: 60, max: 5 },
			"/sign-in/*": { window: 60, max: 10 },
			"/sign-up/email": { window: 60, max: 3 },
			"/forget-password/email": { window: 60, max: 3 },
		},
	},
	/**
	 * 登录失败锁定 —— `before` 拦账号级(`sys_account_lockout` 表),
	 * `after` 在 sign-in 失败时 +1,成功时清零。
	 *
	 * 与 `rateLimit` 的区别:那一层按「IP + 端点」控速,这一层按「账号」累计失败。
	 * 攻击者每轮换 IP 也会撞到这一层,5 次失败 15 分钟(阈值见 `auth-lockout.ts`)。
	 */
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			// 只拦 /sign-in/email —— 注册 / 找回密码的失败不计(被 rateLimit 兜着)。
			if (ctx.path !== "/sign-in/email") return;
			/**
			 * CaptchaKit 人机验证(自托管,不对接 Turnstile / reCAPTCHA 任何第三方)。
			 *
			 * **默认要求,开关在「参数管理」的 `login.captcha_enabled`**(默认 `true`)。
			 * 关掉后这里直接放行 —— 登录接口就只剩限流与账号锁定兜底,生产不建议关。
			 * 参数读的是 30 秒缓存,但 `para.update` 会 `clearParaCache()` ⇒ 改完立即生效;
			 * 读不到 / 没配过一律按 `true`(fail-safe:宁可多要一次验证码,不可裸奔)。
			 *
			 * `ensureCaptchaSecret()` 会在 `CAPTCHAKIT_SECRET` 没配时现场生成一把(开发态写回
			 * `.env.local`,见 `lib/captcha-secret.ts`),所以「忘了配密钥」不等于「登录接口裸奔」。
			 *
			 * 这一层是**兜底**:`/api/captcha` 端点(见 `routes/api.captcha.ts`)已经在前端答题时
			 * verify 过一次;这里再过一次是为了「绕过前端直 POST /api/auth/sign-in/email」这条路也走不通。
			 *
			 * token 走 `x-captcha-token` 请求头而不是 body:better-auth 客户端给 `signIn.email`
			 * 的 body 写了严格 schema,多一个字段就得 cast;走头两边都干净。
			 */
			if (!(await getParaBool(CAPTCHA_ENABLED_KEY, true))) return;
			ensureCaptchaSecret();
			const captchaToken = readCaptchaToken(ctx);
			if (!captchaToken) {
				throw new APIError("BAD_REQUEST", {
					message: "请先完成人机验证",
				});
			}
			// 一次性消费:proof token 验过就作废,所以前端每次提交失败都必须换一道新题
			const captcha = await verifyCaptcha({ token: captchaToken });
			if (!captcha.success) {
				logger.warn("auth.sign-in.captcha_invalid", { error: captcha.error });
				throw new APIError("BAD_REQUEST", {
					message: captcha.error === "CAPTCHA_EXPIRED" ? "人机验证已过期,请重试" : "人机验证失败,请重试",
				});
			}
			const email = String(ctx.body?.email ?? "")
				.trim()
				.toLowerCase();
			if (!email) return;
			const status = await isAccountLocked(email);
			if (status.locked) {
				const sec = Math.ceil(status.remainingMs / 1000);
				logger.warn("auth.sign-in.locked", { email, remainingSec: sec });
				throw new APIError("TOO_MANY_REQUESTS", {
					message: `账号已被锁定,请 ${sec} 秒后再试`,
				});
			}
		}),
		after: createAuthMiddleware(async (ctx) => {
			// 顺手清一次 `sys_rate_limit` 的过期行(内部节流:一小时最多真跑一次)。
			// 模板没有内置调度器,就拿认证请求当心跳 —— 失败只记日志,不影响登录。
			void purgeExpiredRateLimitsThrottled();
			if (ctx.path !== "/sign-in/email") return;
			const email = String(ctx.body?.email ?? "")
				.trim()
				.toLowerCase();
			if (!email) return;
			const ip = (() => {
				try {
					const h = ctx.request?.headers;
					const forwarded = h?.get?.("x-forwarded-for");
					const real = h?.get?.("x-real-ip");
					const raw = forwarded ? String(forwarded).split(",")[0].trim() : real ? String(real) : null;
					return raw || null;
				} catch {
					return null;
				}
			})();
			// 成功判定:better-auth 在 sign-in 成功后会把 `{ user, token }` 写到 `ctx.context.returned`。
			// 用 duck-typing 判(避免在 BA 版本演进时锁死具体返回结构),只看 returned 里有 user.id 就记成功。
			const returned = (ctx as { context?: { returned?: unknown } }).context?.returned as
				| { user?: { id?: string }; redirect?: boolean }
				| null
				| undefined;
			if (returned?.user?.id) {
				void clearSignInFailures(email);
			} else {
				void recordSignInFailure(email, ip).catch((err: unknown) => {
					logger.warn("auth.sign-in.record_failed.error", {
						email,
						message: err instanceof Error ? err.message : String(err),
					});
				});
			}
		}),
	},
	// `userSwitchPlugin` = 运维用的「切换用户」端点(见 lib/auth-debug.ts 的注释:为什么必须是插件)
	plugins: [tanstackStartCookies(), userSwitchPlugin()],
});
