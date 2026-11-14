import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { sysNotification, sysNotificationAttempt, sysNotificationDelivery } from "../src/db/data-base-schema.ts";
import { db, dmPool } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";
import { cancelPendingNotifications, NOTIFICATION_TITLE_MAX, sendNotification } from "../src/lib/notification.ts";
import { type DeliveryProviders, processNotificationDelivery } from "../src/lib/notification-delivery.ts";

const ids: string[] = [];
async function fixture() {
	const { id } = await sendNotification({
		type: "test",
		title: "test",
		dedupeKey: `test:${newId()}`,
		recipients: [{ userId: "test-delivery", channel: "email", target: "test@example.invalid" }],
	});
	ids.push(id);
	const [row] = await db.select().from(sysNotificationDelivery).where(eq(sysNotificationDelivery.notification_id, id));
	assert.ok(row);
	return row.id;
}
after(async () => {
	if (ids.length) {
		const rows = await db
			.select({ id: sysNotificationDelivery.id })
			.from(sysNotificationDelivery)
			.where(inArray(sysNotificationDelivery.notification_id, ids));
		if (rows.length)
			await db.delete(sysNotificationAttempt).where(
				inArray(
					sysNotificationAttempt.delivery_id,
					rows.map((row) => row.id),
				),
			);
		await db.delete(sysNotificationDelivery).where(inArray(sysNotificationDelivery.notification_id, ids));
		await db.delete(sysNotification).where(inArray(sysNotification.id, ids));
	}
	if (dmPool) await dmPool.close();
	else await db.$client.end();
});

test("多个 Worker 竞争同一投递时只调用一次 Provider", async () => {
	const id = await fixture();
	let calls = 0;
	const provider = {
		name: "test",
		async send() {
			calls += 1;
			return { messageId: "receipt" };
		},
	};
	const providers: DeliveryProviders = { email: provider, sms: provider };
	const result = await Promise.all(Array.from({ length: 5 }, () => processNotificationDelivery(id, providers)));
	assert.equal(result.filter(Boolean).length, 1);
	assert.equal(calls, 1);
	const [row] = await db.select().from(sysNotificationDelivery).where(eq(sysNotificationDelivery.id, id));
	assert.equal(row?.status, "sent");
	assert.equal(row?.provider_message_id, "receipt");
	assert.equal(
		(await db.select().from(sysNotificationAttempt).where(eq(sysNotificationAttempt.delivery_id, id))).length,
		1,
	);
});

test("失败记录尝试并退避，过期租约可恢复", async () => {
	const id = await fixture();
	const failure = {
		name: "test",
		async send(): Promise<{ messageId?: string }> {
			throw new Error("temporary failure");
		},
	};
	const success = {
		name: "backup",
		async send() {
			return { messageId: "recovered" };
		},
	};
	await processNotificationDelivery(id, { email: failure, sms: failure });
	let [row] = await db.select().from(sysNotificationDelivery).where(eq(sysNotificationDelivery.id, id));
	assert.equal(row?.status, "pending");
	assert.match(row?.last_error ?? "", /temporary failure/);
	assert.ok(row?.next_attempt_at && row.next_attempt_at > new Date());
	await db
		.update(sysNotificationDelivery)
		.set({ status: "processing", lock_token: "expired", locked_until: new Date(0) })
		.where(eq(sysNotificationDelivery.id, id));
	await processNotificationDelivery(id, { email: success, sms: success });
	[row] = await db.select().from(sysNotificationDelivery).where(eq(sysNotificationDelivery.id, id));
	assert.equal(row?.status, "sent");
	assert.equal(row?.attempts, 2);
	const attempts = await db.select().from(sysNotificationAttempt).where(eq(sysNotificationAttempt.delivery_id, id));
	assert.deepEqual(attempts.map((attempt) => attempt.status).sort(), ["failed", "sent"]);
	assert.deepEqual(
		attempts.sort((a, b) => a.attempt_no - b.attempt_no).map(({ provider, error }) => ({ provider, error })),
		[
			{ provider: "test", error: "temporary failure" },
			{ provider: "backup", error: null },
		],
	);
});

test("站内通知入库即为 sent,不需要 Worker", async () => {
	const { id } = await sendNotification({
		type: "test",
		title: "in_app",
		dedupeKey: `test:${newId()}`,
		recipients: [{ userId: "test-delivery", channel: "in_app" }],
	});
	ids.push(id);
	const [row] = await db.select().from(sysNotificationDelivery).where(eq(sysNotificationDelivery.notification_id, id));
	assert.equal(row?.status, "sent");
	assert.ok(row?.sent_at, "站内投递的 sent_at 必须当场写上");
	assert.equal(row?.next_attempt_at, null, "站内投递不进外部队列");
});

/** 撤回用例要能按 `source` 找到事件,所以单独造一组带来源键的通知。 */
async function sourcedFixture(sourceType: string, sourceId: string) {
	const { id } = await sendNotification({
		type: "test",
		source: { type: sourceType, id: sourceId },
		title: "test",
		dedupeKey: `test:${newId()}`,
		recipients: [{ userId: "test-delivery", channel: "email", target: "test@example.invalid" }],
	});
	ids.push(id);
	const [row] = await db.select().from(sysNotificationDelivery).where(eq(sysNotificationDelivery.notification_id, id));
	assert.ok(row);
	return row.id;
}

test("撤回时取消待发投递,但不碰仍持租约的在途投递", async () => {
	const sourceId = newId();
	const pendingId = await sourcedFixture("test-source", sourceId);
	const expiredId = await sourcedFixture("test-source", sourceId);
	const leasedId = await sourcedFixture("test-source", sourceId);
	// 模拟崩溃留下的两段 processing:一个租约已过期(外层肯定没发出去),一个还活着
	await db
		.update(sysNotificationDelivery)
		.set({ status: "processing", lock_token: "expired", locked_until: new Date(Date.now() - 1000) })
		.where(eq(sysNotificationDelivery.id, expiredId));
	await db
		.update(sysNotificationDelivery)
		.set({ status: "processing", lock_token: "live", locked_until: new Date(Date.now() + 60_000) })
		.where(eq(sysNotificationDelivery.id, leasedId));

	await db.transaction((tx) => cancelPendingNotifications(tx, "test-source", [sourceId]));

	const statusOf = async (id: string) =>
		(await db.select().from(sysNotificationDelivery).where(eq(sysNotificationDelivery.id, id)))[0]?.status;
	assert.equal(await statusOf(pendingId), "cancelled");
	assert.equal(await statusOf(expiredId), "cancelled", "租约已过期的 processing 也应当被取消");
	assert.equal(await statusOf(leasedId), "processing", "仍持活跃租约的在途投递不能撤回");
});

test("通知标题按列宽截断,长任务名不会让业务事务回滚", async () => {
	const long = "长".repeat(300);
	const { id } = await sendNotification({
		type: "test",
		title: long,
		dedupeKey: `test:${newId()}`,
		recipients: [{ userId: "test-delivery", channel: "in_app" }],
	});
	ids.push(id);
	const [row] = await db.select().from(sysNotification).where(eq(sysNotification.id, id));
	assert.equal([...(row?.title ?? "")].length, NOTIFICATION_TITLE_MAX);
});

test("标题截断按码点切,不劈开 emoji 的代理对", async () => {
	// 前缀长度为奇数时,按 UTF-16 码元 `slice` 会把第 128 个单元切在 emoji 中间。
	// `lib/notice.ts` 曾自己做 `slice(0, 128)`,这里守住"只在一个地方截断、且按码点截"。
	const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
	const title = `a${"😀".repeat(200)}`;
	const { id } = await sendNotification({
		type: "test",
		title,
		dedupeKey: `test:${newId()}`,
		recipients: [{ userId: "test-delivery", channel: "in_app" }],
	});
	ids.push(id);
	const [row] = await db.select().from(sysNotification).where(eq(sysNotification.id, id));
	assert.equal(lone.test(row?.title ?? ""), false, "标题里不该出现孤立的代理项");
	assert.equal([...(row?.title ?? "")].length, NOTIFICATION_TITLE_MAX);
});

test("允许缺少联系方式时其他渠道继续投递，缺失渠道记录失败", async () => {
	const { id } = await sendNotification({
		type: "test",
		title: "缺联系方式",
		dedupeKey: `test:${newId()}`,
		allowMissingTargets: true,
		recipients: [
			{ userId: "test-delivery", channel: "in_app" },
			{ userId: "test-delivery", channel: "sms", target: null },
			{ userId: "test-delivery", channel: "email", target: "test@example.invalid" },
		],
	});
	ids.push(id);
	const rows = await db.select().from(sysNotificationDelivery).where(eq(sysNotificationDelivery.notification_id, id));
	const byChannel = new Map(rows.map((row) => [row.channel, row]));
	assert.equal(byChannel.get("in_app")?.status, "sent");
	assert.equal(byChannel.get("email")?.status, "pending");
	assert.equal(byChannel.get("sms")?.status, "failed");
	assert.equal(byChannel.get("sms")?.last_error, "未配置有效的联系电话");
	assert.equal(byChannel.get("sms")?.next_attempt_at, null);
});
