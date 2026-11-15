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
			executorId: "executor",
			executorName: "乙",
			members: [],
			canAddMember: false,
			canManage: false,
			removing: false,
			onAdd() {},
			onRemove() {},
			onRemind() {},
		}),
	);
	assert.match(html, /提醒甲/);
	assert.match(html, /提醒乙/);
});
