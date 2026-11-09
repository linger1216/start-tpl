import assert from "node:assert/strict";
import { test } from "node:test";
import { partitionReportRows } from "../src/lib/task-report-distribution.ts";

test("按各自字段划分，区分数字、空值及重复命中", () => {
	const rows = [
		{ town: "甲", amount: 2 },
		{ town: "乙", amount: 3 },
		{ town: null, amount: 4 },
	];
	const result = partitionReportRows(rows, [
		{ userId: "a", field: "town", value: "甲" },
		{ userId: "b", field: "amount", value: 3 },
		{ userId: "c", field: "town", value: null },
	]);
	assert.deepEqual(result.unassigned, []);
	assert.deepEqual(result.overlapping, []);
	assert.deepEqual(result.byUser.get("b"), [rows[1]]);
	const overlap = partitionReportRows(rows, [
		{ userId: "a", field: "town", value: "甲" },
		{ userId: "b", field: "amount", value: 2 },
	]);
	assert.deepEqual(overlap.overlapping, [0]);
	assert.deepEqual(overlap.unassigned, [1, 2]);
});
