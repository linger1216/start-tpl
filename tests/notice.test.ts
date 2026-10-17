import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq, inArray } from "drizzle-orm";
import { sysNotice, sysUser } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { notify } from "../src/lib/notice.ts";
import { anonymousCaller, assertRejects, caller, closeDb, TEST_USER, uniqueSuffix } from "./helpers.ts";

/**
 * 站内通知。最关键的一条是**越权**:B 看不到、也改不动 A 的通知 ——
 * 这不是靠前端不显示,而是三个过程的 `user_id` 一律取 `ctx.user.id`。
 */
const SUFFIX = uniqueSuffix();
const OTHER = { id: `test-other-${SUFFIX}`, name: "另一个人", isSuper: true };
const otherCaller = createCallerFactory(trpcRouter)({ user: OTHER });

before(async () => {
	// 收件人校验(2026-10 起)会查 sys_user —— OTHER 得是真行
	await db.insert(sysUser).values({ id: OTHER.id, name: OTHER.name, email: `other-${SUFFIX}@test.local` });
});

after(async () => {
	await db.delete(sysUser).where(eq(sysUser.id, OTHER.id));
	await db.delete(sysNotice).where(inArray(sysNotice.user_id, [TEST_USER.id, OTHER.id]));
	await closeDb();
});

describe("通知", () => {
	it("发一条 → 能查到,未读数 +1", async () => {
		const before = (await caller.notice.list()).unread;
		await notify(TEST_USER.id, { title: `测试通知 ${SUFFIX}`, body: "正文", path: "/settings/files" });
		const after = await caller.notice.list();
		assert.equal(after.unread, before + 1, "未读数应当 +1");
		const hit = after.items.find((item) => item.title === `测试通知 ${SUFFIX}`);
		assert.ok(hit, "列表里应当能找到刚发的那条");
		assert.equal(hit.read, false);
		assert.equal(hit.path, "/settings/files");
	});

	it("标一条已读 → 未读数 -1、read 变 true", async () => {
		await notify(TEST_USER.id, { title: `待已读 ${SUFFIX}` });
		const mine = (await caller.notice.list()).items.find((item) => item.title === `待已读 ${SUFFIX}`);
		assert.ok(mine);
		assert.equal(mine.read, false);
		await caller.notice.read({ id: mine.id });
		const fresh = (await caller.notice.list()).items.find((item) => item.id === mine.id);
		assert.equal(fresh?.read, true, "标记之后应当是已读");
	});

	it("全部已读 → 未读清零", async () => {
		await notify(TEST_USER.id, { title: `批量1 ${SUFFIX}` });
		await notify(TEST_USER.id, { title: `批量2 ${SUFFIX}` });
		assert.ok((await caller.notice.list()).unread >= 2);
		await caller.notice.readAll();
		assert.equal((await caller.notice.list()).unread, 0, "全部已读之后未读应当为 0");
	});

	it("越权:别人的通知既看不到、也改不动", async () => {
		await notify(TEST_USER.id, { title: `私有 ${SUFFIX}`, path: "/settings/files" });
		const mine = (await caller.notice.list()).items.find((item) => item.title === `私有 ${SUFFIX}`);
		assert.ok(mine);

		// ① 看不到
		const othersView = await otherCaller.notice.list();
		assert.equal(
			othersView.items.some((item) => item.id === mine.id),
			false,
			"别人的列表里不该出现我的通知",
		);

		// ② 改不动:即便拿着我的 id 去标记,也只影响他自己的行
		await otherCaller.notice.read({ id: mine.id });
		const fresh = (await caller.notice.list()).items.find((item) => item.id === mine.id);
		assert.equal(fresh?.read, false, "别人的 read 不该改到我的那条");
	});

	it("手动发通知:能发给指定的人,对方立刻看得到", async () => {
		const created = await caller.notice.create({
			userIds: [OTHER.id],
			title: `管理员发的 ${SUFFIX}`,
			body: "来自 create",
			path: "/settings/files",
			level: "warn",
		});
		assert.equal(created.created, 1, "选了一个人就应该插一行");
		const otherView = await otherCaller.notice.list();
		const hit = otherView.items.find((item) => item.title === `管理员发的 ${SUFFIX}`);
		assert.ok(hit, "收件人应该立刻看得到");
		assert.equal(hit.level, "warn");
		assert.equal(hit.path, "/settings/files");
	});

	it("list 的 limit 生效(整页拉 500、铃铛拉 10)", async () => {
		await notify(TEST_USER.id, { title: `limit-a ${SUFFIX}` });
		await notify(TEST_USER.id, { title: `limit-b ${SUFFIX}` });
		assert.ok((await caller.notice.list({ limit: 1 })).items.length <= 1, "limit 要生效");
		const all = await caller.notice.list({ limit: 500 });
		assert.ok(all.items.length >= 2, "整页应当拿到多于一知");
	});

	it("未登录 ⇒ UNAUTHORIZED", async () => {
		await assertRejects(() => anonymousCaller.notice.list(), "请先登录");
		await assertRejects(() => anonymousCaller.notice.read({ id: "whatever" }), "请先登录");
	});

	it("path 只收站内路径:javascript: / 外链被丢掉", async () => {
		await notify(TEST_USER.id, { title: `脏路径 ${SUFFIX}`, path: "javascript:alert(1)" });
		await notify(TEST_USER.id, { title: `外链 ${SUFFIX}`, path: "http://evil.example/x" });
		await notify(TEST_USER.id, { title: `协议相对 ${SUFFIX}`, path: "//evil.example/x" });
		const items = (await caller.notice.list()).items;
		for (const title of [`脏路径 ${SUFFIX}`, `外链 ${SUFFIX}`, `协议相对 ${SUFFIX}`]) {
			const row = items.find((item) => item.title === title);
			assert.ok(row, `应当写入(只是 path 被丢):${title}`);
			assert.equal(row.path, null, `不该存下 ${title} 的非法路径`);
		}
		// 库里也确实没有脏值
		const rows = await db.select().from(sysNotice).where(eq(sysNotice.user_id, TEST_USER.id));
		assert.ok(
			rows.every((row) => row.path === null || row.path.startsWith("/")),
			"库里所有 path 都必须是站内路径",
		);
	});
});
