import assert from "node:assert/strict";
import { test } from "node:test";
import { guestMayView } from "../src/lib/share-access.ts";

test("外链页面入口按路径前缀匹配,管理区不可打开", () => {
	assert.equal(guestMayView(["/demo"], "/demo/grid"), true);
	assert.equal(guestMayView(["/demo-grid"], "/demo/grid"), false);
	assert.equal(guestMayView(["/settings"], "/settings/users"), false);
});
