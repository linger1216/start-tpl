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

/**
 * 当前会话的用户 id;没有会话(或不在请求上下文里,比如脚本 / 单测直调 procedure)返回 `null`。
 *
 * 吞掉异常是刻意的:`createCallerFactory` 直调时根本没有 request 上下文,`getRequestHeaders()`
 * 会抛 —— 那时"没有用户"就是正确结论,不该让整个查询炸掉。
 */
export async function getCurrentUserId(): Promise<string | null> {
	try {
		const session = await auth.api.getSession({ headers: getRequestHeaders() });
		return session?.user.id ?? null;
	} catch {
		return null;
	}
}

/** 当前登录用户(**带姓名** —— 审计要存姓名快照,账号将来被删也能读懂历史) */
type CurrentUser = { id: string; name: string };

/**
 * 读当前用户(id + 姓名)。与 `getCurrentUserId` 同样吞掉"没有请求上下文"的异常:
 * 脚本 / 单测直调 procedure 时,"没有用户"就是正确结论 —— 该由 `protectedProcedure` 拒绝,
 * 不该在这里炸成 500。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
	try {
		const session = await auth.api.getSession({ headers: getRequestHeaders() });
		if (!session?.user) return null;
		return { id: session.user.id, name: session.user.name ?? "" };
	} catch {
		return null;
	}
}
