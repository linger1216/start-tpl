import { initTRPC } from "@trpc/server";
import superjson from "superjson";

import { logger, newTraceId, sanitize } from "#/lib/logger";

const t = initTRPC.create({
	transformer: superjson,
});

/** 超过这个毫秒数记一条 warn(慢调用要能在日志里一眼看到) */
const SLOW_MS = Number(process.env.LOG_SLOW_MS ?? 1500);

/**
 * **后端日志的底座**:所有 procedure 都经过这里 —— 于是"每次后端调用都有日志"是**结构性保证**,
 * 不靠每个 resolver 记得加。
 *
 * 每条记 3 行(debug 起 / 完成或失败 / 慢调用 warn),统一带 `traceId` / `path` / `type` / `ms`;
 * `ctx.traceId` 会传给 resolver,内部日志(sync / rule / entity …)都带上它,一次调用可串成一条时间线。
 * 入参只在 debug 级记,且经 `sanitize()` 脱敏截断(凭据字段一律 `***`)。
 */
const loggingMiddleware = t.middleware(async ({ path, type, next, getRawInput, ctx }) => {
	const traceId = newTraceId();
	const startedAt = Date.now();
	logger.debug("trpc.start", { traceId, path, type, input: sanitize(await getRawInput()) });
	try {
		const result = await next({ ctx: { ...ctx, traceId } });
		const ms = Date.now() - startedAt;
		if (ms >= SLOW_MS) logger.warn("trpc.slow", { traceId, path, type, ms });
		/**
		 * 注意:`next()` 在 resolver 报错时**不抛**,而是 resolve 成 `{ ok: false, error }` ——
		 * 不判它就会出现"调用失败却记成 ok"的假日志(实测踩到)。这里判一次,失败照常记 error,
		 * 并把错误原样抛出去(不能把 `{ok:false}` 当结果返回)。
		 */
		// 失败只在这里抛,catch 里统一记 error(避免重复记两条)
		if (!result.ok) throw result.error;
		logger.info("trpc.ok", { traceId, path, type, ms });
		return result;
	} catch (error) {
		const ms = Date.now() - startedAt;
		const code = (error as { code?: string }).code ?? "INTERNAL_SERVER_ERROR";
		logger.error("trpc.err", {
			traceId,
			path,
			type,
			ms,
			code,
			message: error instanceof Error ? error.message : String(error),
		});
		if (error instanceof Error) (error as Error & { traceId?: string }).traceId = traceId;
		throw error;
	}
});

export const createTRPCRouter = t.router;
/** 所有 procedure 都挂日志中间件:**100% 的后端入口都有日志** */
export const publicProcedure = t.procedure.use(loggingMiddleware);
/**
 * 服务端直调入口工厂(`createCallerFactory`)。
 *
 * 用途:脚本 / 测试 / 服务端内部(SSR loader)直接调 procedure,不走 HTTP。
 * 实测:`@trpc/server`(v11)顶层**不导出** `createCallerFactory`,只在 `initTRPC.create()`
 * 的实例上,所以从这里转出去,避免每个脚本各写一遍。
 */
export const createCallerFactory = t.createCallerFactory;
