import assert from "node:assert/strict";
import { it } from "node:test";
import { redactDeliveryError } from "../src/lib/task/notification-target.ts";

it("投递错误只向管理员或安全提示开放详情", () => {
	assert.equal(redactDeliveryError(null, false), null);
	assert.equal(redactDeliveryError("provider token secret", false), "投递失败，请联系管理员");
	assert.equal(redactDeliveryError("provider token secret", true), "provider token secret");
	assert.equal(redactDeliveryError("未配置有效的联系电话", false), "未配置有效的联系电话");
	assert.equal(redactDeliveryError("未配置有效的邮箱", false), "未配置有效的邮箱");
});
