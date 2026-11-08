import { Cron } from "croner";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { sysJobExecution, sysScheduledJob } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";

export type JobDefinition = {
	name: string;
	handler: string;
	intervalSeconds?: number;
	cronExpression?: string;
	timezone?: string;
	timeoutSeconds?: number;
	maxAttempts?: number;
	retryDelaySeconds?: number;
};

/** 仅计算下一次时间，不在 Web 或 Worker 内存中创建定时任务。 */
export function nextJobRun(
	schedule: { intervalSeconds?: number; cronExpression?: string | null; timezone?: string },
	after: Date,
): Date {
	if (schedule.cronExpression) {
		const next = new Cron(schedule.cronExpression, { timezone: schedule.timezone ?? "UTC" }).nextRun(after);
		if (!next) throw new Error("Cron 表达式没有下一次执行时间");
		return next;
	}
	if (!Number.isInteger(schedule.intervalSeconds) || (schedule.intervalSeconds ?? 0) < 1)
		throw new Error("调度间隔必须为正整数");
	return new Date(after.getTime() + (schedule.intervalSeconds ?? 0) * 1000);
}

/** 注册只补缺失任务，保留管理端对既有任务的启停和调度修改。 */
export async function registerJob(definition: JobDefinition): Promise<void> {
	if (
		!definition.name ||
		!definition.handler ||
		Boolean(definition.cronExpression) === Boolean(definition.intervalSeconds)
	)
		throw new Error("任务必须选择一种调度方式");
	nextJobRun(definition, new Date());
	const [existing] = await db
		.select({ id: sysScheduledJob.id })
		.from(sysScheduledJob)
		.where(eq(sysScheduledJob.name, definition.name))
		.limit(1);
	if (existing) return;
	const now = new Date(Math.floor(Date.now() / 1000) * 1000);
	try {
		await db.insert(sysScheduledJob).values({
			id: newId(),
			name: definition.name,
			handler: definition.handler,
			interval_seconds: definition.intervalSeconds ?? 0,
			cron_expression: definition.cronExpression ?? null,
			timezone: definition.timezone ?? "UTC",
			timeout_seconds: definition.timeoutSeconds ?? 60,
			max_attempts: definition.maxAttempts ?? 3,
			retry_delay_seconds: definition.retryDelaySeconds ?? 30,
			enabled: true,
			next_run_at: now,
			created_at: now,
			updated_at: now,
		});
	} catch (error) {
		const [created] = await db
			.select({ id: sysScheduledJob.id })
			.from(sysScheduledJob)
			.where(eq(sysScheduledJob.name, definition.name))
			.limit(1);
		if (!created) throw error;
	}
}

function claimable(now: Date) {
	return and(
		eq(sysScheduledJob.enabled, true),
		lte(sysScheduledJob.next_run_at, now),
		or(isNull(sysScheduledJob.locked_until), lte(sysScheduledJob.locked_until, now)),
	);
}

async function claimJob(id: string) {
	const token = newId();
	const now = new Date();
	return db.transaction(async (tx) => {
		const [job] = await tx.select().from(sysScheduledJob).where(eq(sysScheduledJob.id, id)).limit(1);
		if (!job) return null;
		const leaseUntil = new Date(now.getTime() + (Math.max(1, job.timeout_seconds) + 60) * 1000);
		const result = await tx
			.update(sysScheduledJob)
			.set({
				lock_token: token,
				locked_until: leaseUntil,
				attempts: sql`${sysScheduledJob.attempts} + 1`,
				updated_at: now,
			})
			.where(and(eq(sysScheduledJob.id, id), claimable(now)));
		if (result[0].affectedRows !== 1) return null;
		await tx
			.update(sysJobExecution)
			.set({ status: "failed", error: "执行租约过期，进程可能已退出", finished_at: now })
			.where(and(eq(sysJobExecution.job_id, id), eq(sysJobExecution.status, "running")));
		const executionId = newId();
		await tx.insert(sysJobExecution).values({ id: executionId, job_id: id, status: "running", started_at: now });
		return { job, token, executionId, started: now };
	});
}

/** runner 必须在超时后停止执行；独立 Worker 使用子进程以保证超时可终止。 */
export type JobRunner = (handler: string, timeoutSeconds: number) => Promise<void>;

export async function runScheduledJob(id: string, runner: JobRunner): Promise<boolean> {
	const claim = await claimJob(id);
	if (!claim) return false;
	const { job, token, executionId, started } = claim;
	let error: string | null = null;
	try {
		await runner(job.handler, job.timeout_seconds);
	} catch (cause) {
		error = ((cause instanceof Error ? cause.message : String(cause)) || "执行失败").slice(0, 2000);
	}
	const finished = new Date();
	const attempts = job.attempts + 1;
	const retry = error !== null && attempts < job.max_attempts;
	let nextRun: Date;
	let invalidSchedule = false;
	try {
		nextRun = retry
			? new Date(finished.getTime() + job.retry_delay_seconds * 2 ** (attempts - 1) * 1000)
			: nextJobRun(
					{ intervalSeconds: job.interval_seconds, cronExpression: job.cron_expression, timezone: job.timezone },
					finished,
				);
	} catch (cause) {
		invalidSchedule = true;
		error = `调度配置无效：${cause instanceof Error ? cause.message : String(cause)}`;
		nextRun = new Date(finished.getTime() + 60_000);
	}
	await db.transaction(async (tx) => {
		const result = await tx
			.update(sysScheduledJob)
			.set({
				attempts: retry ? attempts : 0,
				...(invalidSchedule ? { enabled: false } : {}),
				next_run_at: nextRun,
				lock_token: null,
				locked_until: null,
				updated_at: finished,
			})
			.where(and(eq(sysScheduledJob.id, id), eq(sysScheduledJob.lock_token, token)));
		if (result[0].affectedRows !== 1) return;
		await tx
			.update(sysJobExecution)
			.set({
				status: error ? "failed" : "success",
				error,
				finished_at: finished,
				duration_ms: Math.max(0, finished.getTime() - started.getTime()),
			})
			.where(and(eq(sysJobExecution.id, executionId), eq(sysJobExecution.status, "running")));
	});
	return true;
}

export async function runDueJobs(runner: JobRunner, limit = 20): Promise<number> {
	const rows = await db
		.select({ id: sysScheduledJob.id })
		.from(sysScheduledJob)
		.where(claimable(new Date()))
		.orderBy(sysScheduledJob.next_run_at)
		.limit(limit);
	let count = 0;
	for (const row of rows) if (await runScheduledJob(row.id, runner)) count += 1;
	return count;
}
