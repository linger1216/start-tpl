import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, like, lte, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysLog } from "#/db/data-base-schema";
import { createTRPCRouter, protectedProcedure } from "#/integrations/trpc/init";

/**
 * 审计日志(**只读**)—— 台账页 `/settings/logs` 用的接口。
 *
 * 三条刻意的设计:
 *  · **只增不改的表现在没有写接口**:写入由 `init.ts` 的 `auditMiddleware` 结构性完成,
 *    这里只读 —— 页面上也**没有删除 / 编辑入口**(清理按 `log.retention_days` 交给定时任务);
 *  · **默认只取最近 200 条**(上限 500):审计增长很快,全量返回只是把压力换个地方,
 *    要看得更久就用筛选条件收窄(时间 / 动作 / 操作人);
 *  · 权限点 `sys:log:list` 由 `lib/rbac.ts` 的 `PERM_BY_PATH` 强制(读接口也在那张表里)。
 */
const toLog = (row: typeof sysLog.$inferSelect) => ({
	id: row.id,
	traceId: row.trace_id,
	path: row.path,
	label: row.label,
	type: row.type,
	operatorId: row.operator_id,
	operatorName: row.operator_name,
	ip: row.ip,
	target: row.target,
	status: Number(row.status ?? 1),
	errorCode: row.error_code,
	errorMessage: row.error_message,
	input: row.input,
	durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
	createTime: row.create_time ? row.create_time.toISOString() : null,
});

export const logRouter = createTRPCRouter({
	/** 列表:默认最近 200 条,按时间倒序 */
	list: protectedProcedure
		.input(
			z
				.object({
					/** 精确匹配动作(如 `role.create`) */
					path: z.string().max(64).optional(),
					operatorId: z.string().max(32).optional(),
					/** 1 成功 / 0 失败 */
					status: z.number().int().min(0).max(1).optional(),
					/** 模糊匹配:动作名 / 路径 / 目标 / 操作人 —— 一个框搜全部 */
					keyword: z.string().max(64).optional(),
					from: z.string().max(32).optional(),
					to: z.string().max(32).optional(),
					limit: z.number().int().min(1).max(500).default(200),
				})
				.optional(),
		)
		.query(async ({ input }) => {
			const conditions = [];
			if (input?.path) conditions.push(eq(sysLog.path, input.path));
			if (input?.operatorId) conditions.push(eq(sysLog.operator_id, input.operatorId));
			if (input?.status !== undefined) conditions.push(eq(sysLog.status, input.status));
			if (input?.from) {
				const from = new Date(input.from);
				if (Number.isNaN(from.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "起始时间格式不对" });
				conditions.push(gte(sysLog.create_time, from));
			}
			if (input?.to) {
				const to = new Date(input.to);
				if (Number.isNaN(to.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "结束时间格式不对" });
				conditions.push(lte(sysLog.create_time, to));
			}
			const keyword = input?.keyword?.trim();
			if (keyword) {
				const pattern = `%${keyword}%`;
				conditions.push(
					or(
						like(sysLog.label, pattern),
						like(sysLog.path, pattern),
						like(sysLog.target, pattern),
						like(sysLog.operator_name, pattern),
					),
				);
			}

			const rows = await db
				.select()
				.from(sysLog)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(desc(sysLog.create_time))
				.limit(input?.limit ?? 200);
			return rows.map(toLog);
		}),
});
