import { getRequestHeaders } from "@tanstack/react-start/server";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

import { describeTarget, labelOf, readAuditConfig, shouldAudit, writeAudit } from "#/lib/audit";
import { enforceAny, isPermissionConfigured } from "#/lib/casbin";
import { getCurrentUser } from "#/lib/current-user";
import { logger, newTraceId, sanitize } from "#/lib/logger";
import { PERM_BY_PATH } from "#/lib/rbac";

const t = initTRPC.create({
	transformer: superjson,
});

/** 超过这个毫秒数记一条 warn(慢调用要能在日志里一眼看到) */
function slowMs(): number {
	return Number(process.env.LOG_SLOW_MS ?? 1500);
}

/**
 * **后端日志的底座**:所有 procedure 都经过这里 —— 于是"每次后端调用都有日志"是**结构性保证**,
 * 不靠每个 resolver 记得加。
 *
 * 每条记 3 行(debug 起 / 完成或失败 / 慢调用 warn),统一带 `traceId` / `path` / `type` / `ms`;
 * `ctx.traceId` 会传给 resolver,内部日志(sync / rule / entity …)都带上它,一次调用可串成一条时间线。
 * 入参只在 debug 级记,且经 `sanitize()` 脱敏截断(凭据字段一律 `***`)。
 *
 * **导出**:`tests/logging.test.ts` 拿它做同一性断言(每个 procedure 挂的都是这一个),进而保证
 * 「所有后端调用都有日志」这件事有回归用例守着,而不只是注释里的一句话。
 */
export const loggingMiddleware = t.middleware(async ({ path, type, next, getRawInput, ctx }) => {
	const traceId = newTraceId();
	const startedAt = Date.now();
	logger.debug("trpc.start", { traceId, path, type, input: sanitize(await getRawInput()) });
	try {
		const result = await next({ ctx: { ...ctx, traceId } });
		const ms = Date.now() - startedAt;
		if (ms >= slowMs()) logger.warn("trpc.slow", { traceId, path, type, ms });
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

/** 直调 caller 可以注入的用户(脚本 / 测试);HTTP 路径永远拿不到它,只能靠会话 */
type InjectedUser = { id: string; name: string; isSuper?: boolean };

/** 请求来源 IP;没有请求上下文(脚本 / 单测)返回 null */
function clientIp(): string | null {
	try {
		const headers = getRequestHeaders();
		const forwarded = headers.get("x-forwarded-for");
		return (forwarded ? forwarded.split(",")[0].trim() : headers.get("x-real-ip")) ?? null;
	} catch {
		return null;
	}
}

/**
 * ② 登录:tRPC 层的**第一道真拦截**。
 *
 * `ctx.user` **直调 caller 注入的优先**(脚本 / 测试),否则读会话。
 * ⚠️ HTTP 路径没有 `createContext`,所以 `ctx.user` 永远是 undefined ⇒ 注入这条路**从网络不可达**;
 * 下面的测试正是用「注入一个 isSuper 用户」来免去造角色授权的,安全性来自这一点。
 */
const requireUser = t.middleware(async ({ ctx, next }) => {
	const injected = (ctx as { user?: InjectedUser | null }).user;
	if (injected !== undefined) {
		if (!injected) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
		return next({ ctx: { ...ctx, user: injected } });
	}
	const user = await getCurrentUser();
	if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
	return next({ ctx: { ...ctx, user: { id: user.id, name: user.name } } });
});

/**
 * ③ 审计:L2 结构性地把每次**写调用**记进 `sys_log`(只记 mutation)。
 *
 * 两处刻意的写法:
 *  · **fire-and-forget**(`void writeAudit(...)`)—— 业务永远不等审计;
 *  · **只写一次** —— `next()` 在失败时**不抛**而是 resolve 成 `{ ok:false }`(与日志中间件同一个坑),
 *    所以这里把成败都收敛到一处再写,否则失败会被记成两条。
 *
 * **导出**:原因同 `loggingMiddleware` —— 覆盖率用例要断言每个 mutation 都经过它。
 */
export const auditMiddleware = t.middleware(async ({ ctx, path, type, getRawInput, next }) => {
	const startedAt = Date.now();
	const rawInput = await getRawInput();
	const user = (ctx as { user?: InjectedUser | null }).user ?? null;
	const config = await readAuditConfig().catch(() => ({ enabled: true, skipPrefixes: ["page."] }));
	const wanted = config.enabled && shouldAudit({ type, rawInput, skipPrefixes: config.skipPrefixes });
	const base = {
		traceId: String((ctx as { traceId?: string }).traceId ?? ""),
		path,
		label: labelOf(path),
		type,
		operatorId: user?.id ?? null,
		operatorName: user?.name ?? null,
		ip: clientIp(),
		target: describeTarget(rawInput),
		rawInput,
	};

	let failure: unknown = null;
	try {
		const result = await next();
		if (result.ok) {
			if (wanted) void writeAudit({ ...base, status: 1, durationMs: Date.now() - startedAt });
			return result;
		}
		failure = result.error;
	} catch (error) {
		failure = error;
	}
	if (wanted) {
		const shaped = failure as { code?: string; message?: string } | undefined;
		void writeAudit({
			...base,
			status: 0,
			errorCode: shaped?.code ?? "INTERNAL_SERVER_ERROR",
			errorMessage: shaped?.message ?? String(failure),
			durationMs: Date.now() - startedAt,
		});
	}
	throw failure;
});

/**
 * ④ 权限:按 **path 查表**(`PERM_BY_PATH`)而不是每个 procedure 手写权限码 ——
 * 漏写一个就静默放开,而查表天然全覆盖。表里既可以写一个码,也可以写一组码(命中任一即放行,
 * 读接口被多个页面共用时用它);没有登记的接口只要求登录,由 `tests/auth.test.ts` 的分类守卫
 * 盯着(新增接口必须显式归类到 `PERM_BY_PATH` 或两个 `UNMAPPED_*` 之一)。
 *
 * 判决策在 `lib/casbin.ts`:`enforceAny` 对一组码逐个 `enforce`、命中任一即可 ——
 * 与数组语义一一对应(不是"全都要")。这里不再取 `effectiveMenusFor`,因为那要**译成菜单树**,
 * 而接口守卫只关心"这个码放不放行",少一层翻译就少一处漂移。
 */
const permMiddleware = t.middleware(async ({ ctx, path, next }) => {
	const mapped = PERM_BY_PATH[path];
	if (!mapped) return next();
	const user = (ctx as { user?: InjectedUser | null }).user ?? null;
	// 超级管理员短路 —— 测试与脚本注入的用户走这条(HTTP 路径拿不到注入,见上面 `requireUser` 的注释)
	if (user?.isSuper) return next();
	// `p` 行一条都没有 = 权限体系未启用 ⇒ 一律放行,与前端 `useHasPerm` 同口径
	if (!(await isPermissionConfigured())) return next();
	const codes = typeof mapped === "string" ? [mapped] : mapped;
	// 认不到人时失败关闭(`enforceAny` 拿空主体必然不命中);正常路径上 `requireUser` 已保证有用户
	if (!user || !(await enforceAny(user.id, codes))) {
		throw new TRPCError({ code: "FORBIDDEN", message: `没有权限:${codes.join(" 或 ")}` });
	}
	return next();
});

/**
 * 在 `protectedProcedure` 的 resolver 里取当前用户。
 *
 * 中间件已经保证了"有用户",所以这里只是把类型收紧 —— 业务代码不用每处都写一遍
 * `(ctx as { user: ... }).user` 的转换。
 */
export function currentUserOf(ctx: unknown): { id: string; name: string } {
	const user = (ctx as { user?: InjectedUser | null }).user;
	if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
	return { id: user.id, name: user.name };
}

export const createTRPCRouter = t.router;

/** 只挂日志与审计:**任何人**都能调(本项目当前没有这种接口,留着表达"公开"的语义) */
export const publicProcedure = t.procedure.use(loggingMiddleware).use(auditMiddleware);
/** 基础写/读接口:**必须登录**(全站默认用这个) */
export const protectedProcedure = t.procedure
	.use(loggingMiddleware)
	.use(requireUser)
	.use(auditMiddleware)
	.use(permMiddleware);
/**
 * 服务端直调入口工厂(`createCallerFactory`)。
 *
 * 用途:脚本 / 测试 / 服务端内部(SSR loader)直接调 procedure,不走 HTTP。
 * 实测:`@trpc/server`(v11)顶层**不导出** `createCallerFactory`,只在 `initTRPC.create()`
 * 的实例上,所以从这里转出去,避免每个脚本各写一遍。
 */
export const createCallerFactory = t.createCallerFactory;
