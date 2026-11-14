import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TASK_REMINDERS, reminderEvents, taskReminderConfigSchema } from "../src/lib/task/reminder-spec.ts";

test("提醒配置兼容旧任务并限制重复、渠道和时间范围", () => {
	assert.deepEqual(taskReminderConfigSchema.parse(undefined), DEFAULT_TASK_REMINDERS);
	assert.equal(
		taskReminderConfigSchema.safeParse({
			executor: { offsets: [0, 0], channels: ["in_app"] },
			node: { offsets: [], channels: [] },
		}).success,
		false,
	);
	assert.equal(
		taskReminderConfigSchema.safeParse({
			executor: { offsets: [525601], channels: ["in_app"] },
			node: { offsets: [], channels: [] },
		}).success,
		false,
	);
	assert.equal(
		taskReminderConfigSchema.safeParse({
			executor: { offsets: [], channels: [] },
			node: { offsets: [0], channels: ["email"] },
		}).success,
		false,
	);
});

test("提醒以截止或激活时间计算，只安排配置生效后尚未错过的时间", () => {
	const now = new Date("2026-11-14T00:00:00Z");
	const config = taskReminderConfigSchema.parse({
		executor: { offsets: [0, 60, 180], channels: ["in_app"] },
		node: { offsets: [60, 180], channels: ["email"] },
	});
	assert.deepEqual(
		reminderEvents(config, "executor", new Date(now.getTime() + 120 * 60000), now).map((event) =>
			event.at.toISOString(),
		),
		["2026-11-14T01:00:00.000Z", "2026-11-14T02:00:00.000Z"],
	);
	assert.deepEqual(
		reminderEvents(config, "node", now, now).map((event) => event.at.toISOString()),
		["2026-11-14T01:00:00.000Z", "2026-11-14T03:00:00.000Z"],
	);
});
