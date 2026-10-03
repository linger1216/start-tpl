import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { db } from "#/db";
import { sysAccount, sysSession, sysUser, sysVerification } from "#/db/data-base-schema";
import { userSwitchPlugin } from "#/lib/auth-debug";
import { clearSignInFailures, isAccountLocked, recordSignInFailure } from "#/lib/auth-lockout";
import { logger } from "#/lib/logger";

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
 * `doc/表结构设计.md` §11.1;升级版本后请重新核对,字段变了 better-auth 会在运行时报
 * 「Model xxx not found」/「field not found」,typecheck 抓不到。
 *
 * 已经接好的部分:
 *  - 登录页 `/login`(`routes/login.tsx`,在后台外壳之外):邮箱 + 密码,成功后回 `?redirect=` 的原地址;
 *  - **整个后台都要登录**:`routes/(main)/route.tsx` 的 `beforeLoad` 在**服务端**读会话
 *    (`auth.api.getSession` + `getRequestHeaders()`),没有就 307 到登录页并带上原地址;
 *  - 顶栏用户菜单(显示姓名 / 邮箱 / 退出登录),退出后 by 守卫自动回登录页;
 *  - 回归测试:`tests/better-auth.test.ts`(注册 / 登录 / 取会话 / 错密码 / 登出)。
 *
 * 未接的部分(**不开放自注册**,账号需要先在库里建 —— 见 AGENTS.md「认证」):
 *  - 业务字段(账号 / 手机号 / 所属部门 / 状态)与 RBAC 的绑定:TBD —— 走 better-auth 的
 *    `user.additionalFields` 或独立的用户资料表,**本轮未加**,见 doc/表结构设计.md §11.4;
 *  - 注册页 / 忘记密码 / 改密:未做(要发邮件的那类流程还没接);
 *  - 权限点下发给前端:`session` 里目前不带权限,需要一个服务端 procedure 读
 *    `user_role → role_permission` 后返回权限码数组(接口未实现,前端已留好挂载点,见 §11.3);
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
	},
	trustedOrigins: loadTrustedOrigins(),
	/**
	 * 限流(in-memory,默认)—— 跨实例部署前**改成 `database` + 一张小表**(`sys_rate_limit`):
	 *  - dev / 单实例:memory 够用(重启清零,刚好兜住「忘记改密码重试」这类用户);
	 *  - 多实例 / 生产:必须 db 共享,否则每个进程的计数各算各的,等于没限。
	 *
	 * `customRules` 用 glob;`*` 通配单段 —— `/sign-in/*` 同时覆盖 email 与 token,
	 * 实际生效时按精确路径优先(`api/rate-limiter/index.mjs` 的 `wildcardMatch` 排序)。
	 */
	rateLimit: {
		enabled: true,
		window: 10,
		max: 100,
		// 派生新项目加 `database` 时,新建一张 `sys_rate_limit(key varchar PK, count int, expires_at timestamp)`
		// 然后 storage 改 `database` —— 模板故意没建表,是为了避免给一次性用户多增一张表的迁移成本。
		storage: "memory",
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
