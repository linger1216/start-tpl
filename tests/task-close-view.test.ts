import assert from "node:assert/strict";
import { it } from "node:test";
import { orderHintOf, peopleOptionsOf } from "../src/lib/task/close-view.ts";

it("候选人去重并排除非管理员本人", () => {
	const input = {
		creatorId: "a",
		creatorName: "甲",
		members: [
			{ userId: "b", name: "乙", role: "executor" },
			{ userId: "b", name: "乙", role: "participant" },
		],
		meId: "b",
		isAdmin: false,
	};
	assert.deepEqual(
		peopleOptionsOf(input).map((row) => row.value),
		["a"],
	);
	assert.deepEqual(
		peopleOptionsOf({ ...input, isAdmin: true }).map((row) => row.value),
		["a", "b"],
	);
});

it("审批顺序说明遵循选择顺序并反映目标状态", () => {
	const hint = orderHintOf(
		"approve",
		["b", "a"],
		[
			{ value: "a", label: "甲" },
			{ value: "b", label: "乙" },
		],
		"已关闭",
	);
	assert.deepEqual(hint.names, ["乙", "甲"]);
	assert.match(hint.text, /依次审批.*已关闭/);
});
