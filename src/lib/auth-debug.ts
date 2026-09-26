/**
 * 运维用「切换用户」—— **一个 BA 自定义插件端点**。
 *
 *   POST /api/auth/debug/switch-user   { userId }
 *
 * 用途:运维 / 排障时**不用登出登录**就能以某个人的身份看一遍界面(部门、角色、菜单可见性、数据归属)。
 *
 * ## 为什么必须做成 BA 插件的端点
 *
 * 切换身份 = **给当前浏览器换一个会话 cookie**,而 BA 的会话 cookie 是**签过名**的。三条路都不通:
 *  - `createServerFn` 里自己设 cookie:`setSessionCookie` 需要 BA 的 endpoint 上下文
 *    (`ctx.context.authCookies` / `ctx.setSignedCookie` / `ctx.context.secret`),普通 server function **没有**;
 *  - 自己拼 cookie 值 = 跟 BA 的私有格式绑定(升级即碎);
 *  - 直接往 `sys_session` 写一行也不够 —— cookie 是签过名的,写库不等于拿到有效 cookie。
 *
 * 走 BA 自己的端点,`ctx` 是**真的**:建会话用 `internalAdapter.createSession`、
 * 下发 cookie 用 `setSessionCookie`,这两步就是 BA 官方 admin 插件 `impersonateUser` 的实现
 * (`better-auth/dist/plugins/admin/routes.mjs` 里能读到同一套写法)。
 *
 * ⚠️ **`internalAdapter` 是 BA 的内部适配器**(官方插件自己在用,但不在公开 API 面上)。
 * 升级 better-auth 后**必须重跑 `tests/impersonate.test.ts`**;哪天它变了,退路是启用官方 `admin()` 插件用
 * `impersonateUser`(代价:认证表要加 5 个列,而且"谁是管理员"会多出 `sys_user.role` 这个第二真源)。
 *
 * ## 谁能用 —— 服务端说了算
 *
 * 这里是**全站第一处真正的服务端权限拦截**(此前只有前端"显不显示")。它查的是和侧边栏**同一份**权限集合
 * (`lib/rbac.ts` 的 `effectiveMenusFor`)—— 所以"给谁看按钮"和"谁能真的切"永远一致,不存在两处定义。
 * `perms === null`(权限体系未启用)时**也拒绝**:运维接口不能靠"未启用就放行"的兜底放开。
 */
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

import { logger } from "#/lib/logger";
import { IMPERSONATE_PERM } from "#/lib/menu-spec";
import { effectiveMenusFor } from "#/lib/rbac";

/** 切换出来的身份有效期:1 小时后自动失效,避免"运维切完忘了切回来"长期留在别人身份里 */
const IMPERSONATION_TTL_MS = 60 * 60 * 1000;

/**
 * 「原身」记在一个**签名 cookie** 里(内容 = 切换发起人的 userId)。
 *
 * 为什么需要它:**切回去这件事不能再要求"有切换权限"** —— 一旦切到一个没有该权限的人,
 * 那个新身份就点不动任何东西,人就被困在别人身份里了(实测踩到过:徽章和入口一起消失)。
 * 所以"回到原身"必须放行;而"谁算原身"不能由客户端说了算(否则等于谁都能切到谁),
 * 于是用 BA 的签名机制存:改不了、伪造不了,只有我们这条切换路径写进去过。
 */
const IMPERSONATOR_COOKIE = "impersonator_id";

export function userSwitchPlugin() {
	return {
		id: "user-switch",
		endpoints: {
			switchUser: createAuthEndpoint(
				"/debug/switch-user",
				{
					method: "POST",
					use: [sessionMiddleware],
					body: z.object({ userId: z.string().min(1) }),
				},
				async (ctx) => {
					const { user } = ctx.context.session;

					// 「切回原身」例外:不需要权限(否则切到一个没有权限的人就再也回不来了)
					const impersonator = await ctx.getSignedCookie(IMPERSONATOR_COOKIE, ctx.context.secret);
					const isUndo = Boolean(impersonator) && ctx.body.userId === impersonator;
					if (!isUndo) {
						const { perms } = await effectiveMenusFor(user.id);
						let allowed = Boolean(perms?.includes(IMPERSONATE_PERM));
						// 原身份由 **签名 cookie** 证明,且它本来就有权限才能切过来 —— 所以「继续切到别人」
						// 沿用它的授权。这不是提权:仍然要求**原身份**本身有权限。
						if (!allowed && impersonator) {
							const { perms: originalPerms } = await effectiveMenusFor(impersonator);
							allowed = Boolean(originalPerms?.includes(IMPERSONATE_PERM));
						}
						if (!allowed) {
							throw new APIError("FORBIDDEN", { message: "你的账号没有被授予「切换用户」的权限" });
						}
					}

					const target = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
					if (!target) throw new APIError("NOT_FOUND", { message: "用户不存在" });
					if (target.id === user.id) throw new APIError("BAD_REQUEST", { message: "已经是这个身份了" });

					// 运维留痕:谁、什么时候、变成了谁(生产环境必须能查)
					logger.info("impersonate", {
						from: `${user.name ?? ""}<${user.email}>`,
						to: `${target.name ?? ""}<${target.email}>`,
					});

					const created = await ctx.context.internalAdapter.createSession(target.id, true, {
						expiresAt: new Date(Date.now() + IMPERSONATION_TTL_MS),
					});
					if (!created) throw new APIError("INTERNAL_SERVER_ERROR", { message: "建立会话失败" });

					// `dontRememberMe = true`:会话 cookie(关掉浏览器就没了),不长期留在别人身份里
					await setSessionCookie(ctx, { session: created, user: target }, true);

					// 记下原身;切回原身时把它清掉(不再需要这个例外了)
					await ctx.setSignedCookie(IMPERSONATOR_COOKIE, isUndo ? "" : user.id, ctx.context.secret, {
						httpOnly: true,
						sameSite: "lax",
						path: "/",
					});
					return ctx.json({ user: { id: target.id, name: target.name, email: target.email } });
				},
			),
		},
	};
}
