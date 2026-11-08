import assert from "node:assert/strict";
import { test } from "node:test";
import { updateMentionRanges } from "../src/components/modules/task-close/task-close-mention.tsx";

test("提及范围随前文编辑移动，修改提及本身会移除目标", () => {
	const ranges = [
		{ id: "first", start: 0, end: 3 },
		{ id: "second", start: 4, end: 7 },
	];
	assert.deepEqual(updateMentionRanges("@甲乙 @丙丁", "前缀@甲乙 @丙丁", ranges), [
		{ id: "first", start: 2, end: 5 },
		{ id: "second", start: 6, end: 9 },
	]);
	assert.deepEqual(updateMentionRanges("@甲乙 @丙丁", "@甲 @丙丁", ranges), [{ id: "second", start: 3, end: 6 }]);
	assert.deepEqual(updateMentionRanges("@甲乙 @丙丁", "@甲乙 @丙丁好", ranges), ranges);
});
