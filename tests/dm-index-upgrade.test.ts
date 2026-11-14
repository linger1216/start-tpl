import assert from "node:assert/strict";
import { test } from "node:test";
import { upgradeTaskStatusIndex } from "../scripts/dm-index-upgrade";

test("达梦任务索引仅在旧列不匹配时删除，由建表流程重建", async () => {
	for (const [columns, expected] of [
		[[], false],
		[["status"], true],
		[["status", "created_at"], false],
		[["created_at", "status"], true],
	] as const) {
		const statements: string[] = [];
		await upgradeTaskStatusIndex(
			"eg",
			async () => columns.map((column) => ({ COLUMN_NAME: column })),
			async (sql) => {
				statements.push(sql);
			},
		);
		assert.equal(statements.length === 1, expected);
	}
});
