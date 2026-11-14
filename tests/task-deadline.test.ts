import assert from "node:assert/strict";
import { test } from "node:test";
import { taskDeadlineState } from "../src/lib/task/close-spec.ts";

test("任务截止标签按当前时刻与 48 小时边界判断", () => {
	const now = Date.parse("2026-11-14T04:00:00Z");
	assert.equal(taskDeadlineState(null, now), null);
	assert.equal(taskDeadlineState("invalid", now), null);
	assert.equal(taskDeadlineState(new Date(now - 1).toISOString(), now), "overdue");
	assert.equal(taskDeadlineState(new Date(now).toISOString(), now), "soon");
	assert.equal(taskDeadlineState(new Date(now + 48 * 60 * 60 * 1000).toISOString(), now), "soon");
	assert.equal(taskDeadlineState(new Date(now + 48 * 60 * 60 * 1000 + 1).toISOString(), now), null);
});
