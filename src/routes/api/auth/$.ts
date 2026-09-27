import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/lib/auth";
import { logger } from "#/lib/logger";

/**
 * 认证端点的日志(TanStack Start 的 server handler 不走 tRPC 中间件,这里得自己包一层)。
 *
 * 只记「谁 · 什么时候 · 对哪个端点 · 成没成 · 多久」:
 *  · **不记请求体**(密码之类的东西一个字节都不进日志,登录名单独取 `email` 一个字段);
 *  · **会话轮询(`get-session`)不记** —— 每次页面加载都调,记出来只会把别的日志淹掉;
 *  · 登录失败记 `auth.failed`(warn):「我为什么登不上」的第一现场就是这里;
 *  · 端点名放在 `endpoint` 字段里 —— `event` 是日志自己的保留名(`ts` / `level` / `event`),不能借。
 */
const SKIP = new Set(["get-session", "session", "ok"]);

/** `/api/auth/sign-in/email` → `auth.sign_in`;登录相关一律收敛成 `auth.sign_in`,其余按路径拼 */
function authEvent(pathname: string): string | null {
	const rest = pathname.replace(/^\/api\/auth\/?/, "");
	if (!rest) return "auth.request";
	if (SKIP.has(rest)) return null;
	if (rest.startsWith("sign-in")) return "auth.sign_in";
	if (rest === "sign-out") return "auth.sign_out";
	return `auth.${rest.replaceAll("/", ".")}`;
}

/** 只从请求体里摘 `email`(脱敏靠"只取这一个字段",不靠事后过滤) */
async function emailOf(request: Request): Promise<string | null> {
	try {
		const body = (await request.clone().json()) as { email?: unknown };
		return typeof body.email === "string" ? body.email : null;
	} catch {
		return null;
	}
}

async function handleAuth(request: Request): Promise<Response> {
	const startedAt = Date.now();
	const { pathname } = new URL(request.url);
	const event = authEvent(pathname);
	if (!event) return auth.handler(request);
	const email = event === "auth.sign_in" ? await emailOf(request) : null;
	const base = { endpoint: event, method: request.method, path: pathname, ms: 0, ...(email ? { email } : {}) };
	try {
		const response = await auth.handler(request);
		const fields = { ...base, ms: Date.now() - startedAt, status: response.status };
		if (response.ok) logger.info("auth.ok", fields);
		else logger.warn("auth.failed", fields);
		return response;
	} catch (error) {
		logger.error("auth.err", {
			...base,
			ms: Date.now() - startedAt,
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => handleAuth(request),
			POST: ({ request }) => handleAuth(request),
		},
	},
});
