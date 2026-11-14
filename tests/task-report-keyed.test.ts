import assert from "node:assert/strict";
import { test } from "node:test";
import { updateKeyedItem } from "../src/lib/task/report-keyed.ts";

test("异步结果按原始行身份写回，行被删除时丢弃结果", () => {
	const first = { name: "甲" };
	const second = { name: "乙" };
	assert.deepEqual(
		updateKeyedItem([second], ["b"], "b", (row) => ({ ...row, file: "附件" })),
		[{ name: "乙", file: "附件" }],
	);
	assert.deepEqual(
		updateKeyedItem([second], ["b"], "a", (row) => ({ ...row, file: "附件" })),
		[second],
	);
	assert.deepEqual(
		updateKeyedItem([first, second], ["a", "b"], "b", (row) => ({ ...row, file: "附件" })),
		[first, { name: "乙", file: "附件" }],
	);
});
