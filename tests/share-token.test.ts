import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { sysLog, sysShareToken } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { flushAuditWrites } from "../src/lib/audit.ts";
import { clearShareTokenCache, matchShareToken } from "../src/lib/share-access.ts";
import { assertRejects, caller, closeDb, TEST_PREFIX, testId, uniqueSuffix } from "./helpers.ts";

/**
 * 访客令牌(shareToken)—— CRUD 与「访客只读」的判定链。
 *
 * 机制本体(`matchShareToken` → 守卫 → 中间件)见 `lib/share-access.ts` 与 `doc/外链分享.md`;
 * 守卫那一段(307 摘参 / cookie)要真浏览器才测得了,走手工清单,这里用 caller 直调收口
 * **数据层**的口径:凭证 CRUD、过期 / 停用不命中、访客以管理员视角只读。
 */
const guestCaller = (sharePaths: string[]) =>
	createCallerFactory(trpcRouter)({ user: { id: "share-guest", name: "访客", sharePaths } });

/** 本文件建过的令牌行 —— after 里硬删(凭证表没有软删) */
const createdIds: string[] = [];
const guestAuditKey = `${TEST_PREFIX}share-audit-${uniqueSuffix()}`;

async function insertToken(overrides: Partial<typeof sysShareToken.$inferInsert> = {}): Promise<string> {
	const id = testId("share", "token", uniqueSuffix());
	createdIds.push(id);
	await db.insert(sysShareToken).values({
		id,
		token: `${TEST_PREFIX}tok-${uniqueSuffix()}`,
		remark: `${TEST_PREFIX}访客令牌`,
		allowed_paths: '["/demo/grid"]',
		enabled: 1,
		...overrides,
	});
	return id;
}

/** 按 token 从 list 里捞回本文件刚建的那一行(捞不到直接断言失败) */
async function rowByToken(token: string) {
	const row = (await caller.shareToken.list()).find((item) => item.token === token);
	assert.ok(row, `list 应能查到刚生成的令牌(${token})`);
	createdIds.push(row.id);
	return row;
}

after(async () => {
	await flushAuditWrites();
	// 只清理本次测试产生的访客审计,不能删除真实访客的记录。
	await db.delete(sysLog).where(and(eq(sysLog.operator_id, "share-guest"), eq(sysLog.target, `key=${guestAuditKey}`)));
	if (createdIds.length > 0) await db.delete(sysShareToken).where(inArray(sysShareToken.id, createdIds));
	await closeDb();
});

describe("访客令牌 CRUD", () => {
	it("create 由服务端生成 32 位 hex 令牌,list 能按它查回整行", async () => {
		const created = await caller.shareToken.create({
			remark: `${TEST_PREFIX}合作方`,
			allowedPaths: ["/demo/grid", "/notices"],
			expiresAt: "2099-01-01",
		});
		assert.match(created.token, /^[0-9a-f]{32}$/, "令牌应为 32 位 hex");
		assert.ok(created.expiresAt, "带了有效期,出参应有 ISO 时刻");

		const row = await rowByToken(created.token);
		assert.deepEqual(row.allowedPaths, ["/demo/grid", "/notices"]);
		assert.equal(row.enabled, true);
		assert.equal(row.remark, `${TEST_PREFIX}合作方`);
	});

	it("允许超过 10 字符的页面路径", async () => {
		const created = await caller.shareToken.create({
			remark: `${TEST_PREFIX}长路径`,
			allowedPaths: ["/task-close"],
			expiresAt: null,
		});
		const row = await rowByToken(created.token);
		assert.deepEqual(row.allowedPaths, ["/task-close"]);
	});

	it("update 改备注 / 允许页面 / 有效期;remove 是硬删 —— 行真的没了", async () => {
		const created = await caller.shareToken.create({ remark: "旧备注", allowedPaths: ["/demo/grid"], expiresAt: null });
		const row = await rowByToken(created.token);

		await caller.shareToken.update({
			id: row.id,
			remark: `${TEST_PREFIX}新备注`,
			allowedPaths: ["/notices"],
			expiresAt: null,
		});
		const [updated] = (await caller.shareToken.list()).filter((item) => item.id === row.id);
		assert.equal(updated.remark, `${TEST_PREFIX}新备注`);
		assert.deepEqual(updated.allowedPaths, ["/notices"]);
		assert.equal(updated.expiresAt, null, "传 null = 清掉有效期");

		await caller.shareToken.remove({ id: row.id });
		const left = (await caller.shareToken.list()).filter((item) => item.id === row.id);
		assert.equal(left.length, 0, "硬删后 list 不应再有这一行");
	});

	it("改不存在的令牌(update / toggle / remove)报 NOT_FOUND", async () => {
		const ghost = testId("share", "ghost", uniqueSuffix());
		await assertRejects(
			() => caller.shareToken.update({ id: ghost, remark: "x", allowedPaths: ["/demo/grid"], expiresAt: null }),
			"令牌不存在",
		);
		await assertRejects(() => caller.shareToken.toggle({ id: ghost, enabled: true }), "令牌不存在");
		await assertRejects(() => caller.shareToken.remove({ id: ghost }), "令牌不存在");
	});
});

describe("matchShareToken(判定核心)", () => {
	it("启用 ∧ 未过期才命中;过期 / 停用都不命中", async () => {
		const activeId = await insertToken();
		const expiredId = await insertToken({ expires_at: new Date(Date.now() - 1000) });
		const disabledId = await insertToken({ enabled: 0 });
		const [activeRow] = await db.select().from(sysShareToken).where(eq(sysShareToken.id, activeId));
		const [expiredRow] = await db.select().from(sysShareToken).where(eq(sysShareToken.id, expiredId));
		const [disabledRow] = await db.select().from(sysShareToken).where(eq(sysShareToken.id, disabledId));

		clearShareTokenCache();
		const matched = await matchShareToken(activeRow.token);
		assert.ok(matched, "启用且未过期应命中");
		assert.deepEqual(matched.allowedPaths, ["/demo/grid"]);
		assert.deepEqual(await matchShareToken(`  ${activeRow.token}  `), matched, "输入两端空白不影响匹配");
		assert.equal(await matchShareToken(`${activeRow.token}x`), null, "不同长度的令牌不能命中");
		assert.equal(await matchShareToken(expiredRow.token), null, "过期的令牌不命中");
		assert.equal(await matchShareToken(disabledRow.token), null, "停用的令牌不命中");
		assert.equal(await matchShareToken("  "), null, "空白令牌不命中");
		assert.equal(await matchShareToken(null), null);
	});

	it("toggle 停用后立即不命中(路由里写口已清缓存)", async () => {
		const created = await caller.shareToken.create({
			remark: "启停用例",
			allowedPaths: ["/demo/grid"],
			expiresAt: null,
		});
		const row = await rowByToken(created.token);

		await caller.shareToken.toggle({ id: row.id, enabled: false });
		assert.equal(await matchShareToken(row.token), null, "停用后旧链接应立即失效");
		await caller.shareToken.toggle({ id: row.id, enabled: true });
		assert.ok(await matchShareToken(row.token), "重新启用后恢复");
	});
});

describe("访客以管理员视角只读", () => {
	it("未登记的资源查询放行,写操作仍被拒绝", async () => {
		const guest = guestCaller(["/task-close/task-a"]);
		const result = await guest.para.list();
		assert.ok(Array.isArray(result));
		await assertRejects(() => guest.para.update({ key: guestAuditKey, value: "50" }), "外链访客只读,不能执行该操作");
	});
});
