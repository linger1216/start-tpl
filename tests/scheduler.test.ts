import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { sysJobExecution, sysScheduledJob } from "../src/db/data-base-schema.ts";
import { db, dmPool } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";
import { nextJobRun, registerJob, runScheduledJob } from "../src/lib/scheduler.ts";
import { anonymousCaller, assertRejects, caller, callerAs } from "./helpers.ts";

const ids: string[] = [];
async function fixture() {
	const name = `test:${newId()}`;
	await registerJob({ name, handler: "test", intervalSeconds: 60, retryDelaySeconds: 1 });
	const [job] = await db.select().from(sysScheduledJob).where(eq(sysScheduledJob.name, name));
	assert.ok(job);
	ids.push(job.id);
	return job.id;
}
after(async () => {
	if (ids.length) {
		await db.delete(sysJobExecution).where(inArray(sysJobExecution.job_id, ids));
		await db.delete(sysScheduledJob).where(inArray(sysScheduledJob.id, ids));
	}
	if (dmPool) await dmPool.close();
	else await db.$client.end();
});

test("多个 Worker 竞争同一到期任务时只执行一次", async () => {
	const id = await fixture();
	let calls = 0;
	const result = await Promise.all(
		Array.from({ length: 5 }, () =>
			runScheduledJob(id, async () => {
				calls += 1;
			}),
		),
	);
	assert.equal(result.filter(Boolean).length, 1);
	assert.equal(calls, 1);
	const executions = await db.select().from(sysJobExecution).where(eq(sysJobExecution.job_id, id));
	assert.equal(executions.length, 1);
	assert.equal(executions[0]?.status, "success");
});

test("失败可重试，租约过期后恢复并记录中断", async () => {
	const id = await fixture();
	await runScheduledJob(id, async () => {
		throw new Error("retry me");
	});
	let [job] = await db.select().from(sysScheduledJob).where(eq(sysScheduledJob.id, id));
	assert.equal(job?.attempts, 1);
	assert.ok(job?.next_run_at && job.next_run_at > new Date());
	const now = new Date();
	await db
		.update(sysScheduledJob)
		.set({ next_run_at: new Date(0), locked_until: new Date(0), lock_token: "expired" })
		.where(eq(sysScheduledJob.id, id));
	await db.insert(sysJobExecution).values({ id: newId(), job_id: id, started_at: now, status: "running" });
	await runScheduledJob(id, async () => {});
	[job] = await db.select().from(sysScheduledJob).where(eq(sysScheduledJob.id, id));
	assert.equal(job?.attempts, 0);
	const rows = await db.select().from(sysJobExecution).where(eq(sysJobExecution.job_id, id));
	assert.equal(rows.filter((row) => row.status === "failed").length, 2);
	assert.equal(rows.filter((row) => row.status === "success").length, 1);
});

test("调度管理需要权限，支持停用、启用、手动安排与查看记录", async () => {
	const id = await fixture();
	const stranger = callerAs({ id: `no-scheduler-${newId()}`, name: "无权用户" });
	await assertRejects(() => anonymousCaller.scheduler.list(), "请先登录");
	await assertRejects(() => stranger.scheduler.trigger({ id }), "没有权限");
	await caller.scheduler.setEnabled({ id, enabled: false });
	await assertRejects(() => caller.scheduler.trigger({ id }), "已停用");
	await caller.scheduler.setEnabled({ id, enabled: true });
	await assertRejects(
		() => caller.scheduler.configure({ id, mode: "cron", cronExpression: "invalid", timezone: "UTC" }),
		"调度表达式",
	);
	await caller.scheduler.configure({ id, mode: "cron", cronExpression: "0 9 * * *", timezone: "Asia/Shanghai" });
	const [configured] = await db.select().from(sysScheduledJob).where(eq(sysScheduledJob.id, id));
	assert.equal(configured?.cron_expression, "0 9 * * *");
	// interval 模式要清掉 cron 字段,下次时间落在「现在 + 间隔」上
	await caller.scheduler.configure({ id, mode: "interval", intervalSeconds: 300, timezone: "UTC" });
	const [interval] = await db.select().from(sysScheduledJob).where(eq(sysScheduledJob.id, id));
	assert.equal(interval?.cron_expression, null, "切到 interval 必须清掉旧的 cron 表达式");
	assert.equal(interval?.interval_seconds, 300);
	assert.ok(interval?.next_run_at, "配置后要算出下次时间");
	assert.ok(
		Math.abs((interval.next_run_at as Date).getTime() - (Date.now() + 300_000)) < 60_000,
		"下次时间应约为现在 + 间隔",
	);
	await caller.scheduler.trigger({ id });
	await runScheduledJob(id, async () => {});
	const rows = await caller.scheduler.executions({ id });
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.status, "success");
});

test("Cron 按指定时区计算下次时间，间隔使用秒", () => {
	const from = new Date("2026-11-07T00:30:00Z");
	assert.equal(
		nextJobRun({ cronExpression: "0 9 * * *", timezone: "Asia/Shanghai" }, from).toISOString(),
		"2026-11-07T01:00:00.000Z",
	);
	assert.equal(nextJobRun({ intervalSeconds: 60 }, from).toISOString(), "2026-11-07T00:31:00.000Z");
	assert.throws(() => nextJobRun({ cronExpression: "invalid" }, from));
});
