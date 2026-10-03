/**
 * Sentry 调用的薄壳 —— DSN 缺失时**静默 no-op**,不抛错也不打 warn。
 *
 * 设计取舍(踩过才写得出来):
 *  - DSN 是否存在只由 `instrument.server.mjs` 决定:它启动时 `Sentry.init` 没被调用,
 *    这里的 `Sentry` import 也是空壳(动态初始化的话,BA 的 SSR 路径上根本拿不到实例) → 安全做法是
 *    **用自己的 flag**,启动时把 `enabled` 写到全局,**只在 enabled 时才调用真正的 `captureException`**。
 *    这条规则比 `Sentry.isInitialized()` 更可靠:那个判断在不同版本里返回不稳定,
 *    而且 BA 在 SSR 早期模块还没加载完时返回 false。
 *  - 不强依赖 Sentry 的导出 —— 没装好/没启用时整个函数就是 `() => {}`。
 *  - 错误有 `traceId` 时一起送过去(从 tRPC `loggingMiddleware` 的 catch 块调),
 *    Sentry 面板里能跟 pino 的 trpc.err 行串成同一次调用。
 */
import * as Sentry from "@sentry/tanstackstart-react";

import { logger as loggerPkg } from "./logger";

let enabled = false;

/** `instrument.server.mjs` 在 Sentry 真正初始化后调一次。**只允许开,不允许关**。 */
export function enableSentry(): void {
	enabled = true;
}

/**
 * 上送一次异常。DSN 没配 = no-op + `pino.error`(不阻断调用)。
 *
 * `context` 的所有字段会被 Sentry 当成 tag / extra,小写优先;`traceId` 会变成 `trace` tag
 * 便于按调用链过滤。
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
	if (!enabled) {
		// 没接 Sentry 时不打 warn(测试 / 本地没配 .env 都会触发,会刷屏);走 logger 留底
		loggerPkg.error("sentry.disabled", {
			...(context ?? {}),
			message: error instanceof Error ? error.message : String(error),
		});
		return;
	}
	try {
		const { traceId: _t, ...extra } = (context ?? {}) as { traceId?: string } & Record<string, unknown>;
		Sentry.captureException(error, { extra, tags: traceIdToTags(_t) });
	} catch (sendErr) {
		// Sentry SDK 自己崩了别再把调用方拖死 —— 走 pino 兜底
		loggerPkg.error("sentry.send_failed", {
			message: sendErr instanceof Error ? sendErr.message : String(sendErr),
			original: error instanceof Error ? error.message : String(error),
		});
	}
}

function traceIdToTags(traceId?: string): Record<string, string> {
	return traceId ? { trace: traceId } : {};
}
