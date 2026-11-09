import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { sysJobExecution, sysScheduledJob } from "#/db/data-base-schema";
import { nextJobRun } from "#/lib/scheduler";
import { createTRPCRouter, protectedProcedure } from "../init";

const idInput = z.object({ id: z.string().min(1).max(32) });
export const schedulerRouter = createTRPCRouter({
	list: protectedProcedure.query(async () => {
		const jobs = await db.select().from(sysScheduledJob).orderBy(sysScheduledJob.name);
		return jobs.map((job) => ({
			id: job.id,
			name: job.name,
			handler: job.handler,
			enabled: job.enabled,
			intervalSeconds: job.interval_seconds,
			cronExpression: job.cron_expression,
			timezone: job.timezone,
			timeoutSeconds: job.timeout_seconds,
			nextRunAt: job.next_run_at.toISOString(),
			lockedUntil: job.locked_until?.toISOString() ?? null,
		}));
	}),
	configure: protectedProcedure
		.input(
			idInput.extend({
				mode: z.enum(["interval", "cron"]),
				intervalSeconds: z.number().int().min(1).max(31_536_000).optional(),
				cronExpression: z.string().trim().min(1).max(128).optional(),
				timezone: z.string().trim().min(1).max(64).default("UTC"),
			}),
		)
		.mutation(async ({ input }) => {
			const schedule =
				input.mode === "cron"
					? { cronExpression: input.cronExpression, timezone: input.timezone }
					: { intervalSeconds: input.intervalSeconds };
			let next: Date;
			try {
				next = nextJobRun(schedule, new Date());
			} catch {
				throw new TRPCError({ code: "BAD_REQUEST", message: "调度表达式、时区或间隔无效" });
			}
			const now = new Date();
			// 先查再写:`affectedRows` 是「实际改了行」而非「匹配到行」,重复提交同一份配置会得 0。
			// WHERE 里的锁条件仍保留 —— 它是并发守卫,只是不再拿它当「存在性」判据。
			const [job] = await db
				.select({ id: sysScheduledJob.id, lockedUntil: sysScheduledJob.locked_until })
				.from(sysScheduledJob)
				.where(eq(sysScheduledJob.id, input.id))
				.limit(1);
			if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
			if (job.lockedUntil && job.lockedUntil > now)
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "任务正在执行" });
			const updated = await db
				.update(sysScheduledJob)
				.set({
					interval_seconds: input.mode === "interval" ? (input.intervalSeconds ?? 0) : 0,
					cron_expression: input.mode === "cron" ? (input.cronExpression ?? null) : null,
					timezone: input.timezone,
					next_run_at: next,
					attempts: 0,
					updated_at: now,
				})
				.where(
					and(
						eq(sysScheduledJob.id, input.id),
						or(isNull(sysScheduledJob.locked_until), lte(sysScheduledJob.locked_until, now)),
					),
				);
			// 0 行 = 上面查完之后才被别的进程抢走锁,不是「不存在」
			if (updated[0].affectedRows === 0)
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "任务刚刚开始执行,请稍后重试" });
			return { ok: true };
		}),
	executions: protectedProcedure.input(idInput).query(async ({ input }) => {
		const rows = await db
			.select()
			.from(sysJobExecution)
			.where(eq(sysJobExecution.job_id, input.id))
			.orderBy(desc(sysJobExecution.started_at))
			.limit(50);
		return rows.map((row) => ({
			id: row.id,
			status: row.status,
			error: row.error,
			durationMs: row.duration_ms,
			startedAt: row.started_at.toISOString(),
			finishedAt: row.finished_at?.toISOString() ?? null,
		}));
	}),
	setEnabled: protectedProcedure.input(idInput.extend({ enabled: z.boolean() })).mutation(async ({ input }) => {
		const [job] = await db
			.select({ id: sysScheduledJob.id })
			.from(sysScheduledJob)
			.where(eq(sysScheduledJob.id, input.id))
			.limit(1);
		if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "调度任务不存在" });
		await db
			.update(sysScheduledJob)
			.set({ enabled: input.enabled, updated_at: new Date() })
			.where(eq(sysScheduledJob.id, input.id));
		return { ok: true };
	}),
	trigger: protectedProcedure.input(idInput).mutation(async ({ input }) => {
		const now = new Date();
		// 同 `configure`:先查后写。WHERE 里保留状态守卫防并发,但不拿 `affectedRows` 当存在性判据
		const [job] = await db
			.select({
				id: sysScheduledJob.id,
				enabled: sysScheduledJob.enabled,
				lockedUntil: sysScheduledJob.locked_until,
			})
			.from(sysScheduledJob)
			.where(eq(sysScheduledJob.id, input.id))
			.limit(1);
		if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "调度任务不存在" });
		if (!job.enabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "调度任务已停用" });
		if (job.lockedUntil && job.lockedUntil > now)
			throw new TRPCError({ code: "PRECONDITION_FAILED", message: "调度任务正在执行" });
		const updated = await db
			.update(sysScheduledJob)
			.set({ next_run_at: new Date(Math.floor(now.getTime() / 1000) * 1000), attempts: 0, updated_at: now })
			.where(
				and(
					eq(sysScheduledJob.id, input.id),
					eq(sysScheduledJob.enabled, true),
					or(isNull(sysScheduledJob.locked_until), lte(sysScheduledJob.locked_until, now)),
				),
			);
		if (updated[0].affectedRows === 0)
			throw new TRPCError({ code: "PRECONDITION_FAILED", message: "调度任务刚刚开始执行,请稍后重试" });
		return { ok: true };
	}),
});
