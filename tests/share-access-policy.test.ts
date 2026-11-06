import assert from "node:assert/strict";
import { test } from "node:test";
import { guestMayQuery } from "../src/lib/share-access.ts";

test("访客查询使用真实页面路径与前缀匹配,拒绝管理区和未登记接口", () => {
	assert.equal(guestMayQuery(["/demo"], "demoGrid.list"), true);
	assert.equal(guestMayQuery(["/demo/grid"], "department.tree"), true);
	assert.equal(guestMayQuery(["/demo-other"], "demoGrid.list"), false);
	assert.equal(guestMayQuery(["/demo-grid"], "demoGrid.list"), false);
	assert.equal(guestMayQuery(["/settings/users"], "shareToken.list"), false);
	assert.equal(guestMayQuery(["/task-close/task-a"], "taskClose.taskGet"), false);
});
