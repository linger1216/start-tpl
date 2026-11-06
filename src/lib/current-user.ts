/**
 * 读当前登录用户 —— **只在服务端**,供 tRPC procedure 使用。
 *
 * 为什么可以在这里**静态** import `#/lib/auth`:`trpc/router.ts` 的**值**在整个仓库里
 * 只被 `src/routes/api.trpc.$.tsx`(服务端路由)引用,客户端全是 `import type TRPCRouter`
 * —— 所以 routers 及其依赖不会进客户端包(和 `#/db` 是同一个道理)。
 *
 * ⚠️ **路由文件不要 import 本模块**(`routes/(main)/route.tsx` 那条路径要自己走
 * `createServerFn` + 动态 import):route 文件会被 `routeTree.gen.ts` **静态引用**,
 * 一旦顺着这里静态拖进 `#/lib/auth` → `#/db` → mysql2,浏览器里没有 `Buffer.prototype`,
 * 整个应用直接崩。那条坑的详细记录见 `(main)/route.tsx` 的注释。
 */
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "#/lib/auth";
import { matchShareToken, readShareTokenFromHeaders, SHARE_GUEST } from "#/lib/share-access";

/**
 * 当前会话的用户 id;没有会话(或不在请求上下文里,比如脚本 / 单测直调 procedure)返回 `null`。
 *
 * 直接复用下面的 `getCurrentUser()`(它同样吞掉"没有 request 上下文"的异常)—— 语义与原来一致。
 */
export async function getCurrentUserId(): Promise<string | null> {
	return (await getCurrentUser())?.id ?? null;
}

/** 当前登录用户(**带姓名** —— 审计要存姓名快照,账号将来被删也能读懂历史) */
type CurrentUser = {
	id: string;
	name: string;
	/**
	 * 访客身份时命中令牌的**允许页面**前缀(tRPC 权限中间件按它放行读接口);
	 * 普通登录用户没有这个字段 —— 它是 `share-guest` 专属的。
	 */
	sharePaths?: readonly string[];
};

/**
 * 读当前用户(id + 姓名)。与 `getCurrentUserId` 同样吞掉"没有请求上下文"的异常:
 * 脚本 / 单测直调 procedure 时,"没有用户"就是正确结论 —— 该由 `protectedProcedure` 拒绝,
 * 不该在这里炸成 500。
 *
 * 会话为空时**追加访客兜底**(外链 share token,见 `lib/share-access.ts` 与 `doc/外链分享.md`):
 * 读同一颗 httpOnly cookie 比对令牌表,命中即返回「访客」—— 数据层认人就到这里为止,
 * 访客能调哪些接口由权限中间件的访客特判收口(只读 + 只放行允许页面的 query)。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
	try {
		const session = await auth.api.getSession({ headers: getRequestHeaders() });
		if (session?.user) return { id: session.user.id, name: session.user.name ?? "" };
	} catch {
		// 脚本 / 单测没有请求上下文:拿不到会话也拿不到 Cookie,自然走不到访客
		return null;
	}
	try {
		const token = readShareTokenFromHeaders(getRequestHeaders());
		const matched = token ? await matchShareToken(token) : null;
		if (!matched) return null;
		return { id: SHARE_GUEST.id, name: SHARE_GUEST.name, sharePaths: matched.allowedPaths };
	} catch {
		// 同上:没有请求上下文(读不到 Cookie)就按未登录处理
		return null;
	}
}
