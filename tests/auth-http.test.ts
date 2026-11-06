import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAuth } from "../src/routes/api/auth/$.ts";

test("公开认证入口拒绝邮箱注册", async () => {
	for (const suffix of ["", "/"]) {
		const response = await handleAuth(
			new Request(`http://localhost:3000/api/auth/sign-up/email${suffix}`, { method: "POST" }),
		);
		assert.equal(response.status, 404);
	}
});
