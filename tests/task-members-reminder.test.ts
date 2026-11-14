import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskMembers } from "../src/components/modules/task-close/task-members.tsx";

test("任务创建人和各成员行均提供针对个人的提醒入口", () => {
	const html = renderToStaticMarkup(
		createElement(TaskMembers, {
			creatorId: "creator",
			creatorName: "甲",
			members: [{ userId: "executor", role: "executor", name: "乙" }],
			canAddMember: false,
			canManage: false,
			removing: false,
			onAdd() {},
			onRemove() {},
			roleText: () => "执行人",
			onRemind() {},
		}),
	);
	assert.match(html, /提醒甲/);
	assert.match(html, /提醒乙/);
});
