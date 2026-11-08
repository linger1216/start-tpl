import { and, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "#/db";
import { sysNotification, sysNotificationDelivery } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { publish } from "#/lib/sse-bus";

export type NotificationChannel = "in_app" | "sms" | "email";
export type NotificationRecipient = { userId: string; channel: NotificationChannel; target?: string | null };
export type NotificationInput = {
	type: string;
	source?: { type: string; id: string };
	title: string;
	content?: string | null;
	payload?: Record<string, unknown>;
	dedupeKey: string;
	recipients: readonly NotificationRecipient[];
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 与 `sys_notification.title` 的 varchar(128) 对齐;调用点的任务名可长达 255。 */
export const NOTIFICATION_TITLE_MAX = 128;

/**
 * 业务终结时取消尚未发出的外部投递；已发送的投递保留实际结果。
 *
 * 「尚未发出」包含两段:`pending`(还没被认领),以及 `processing` 但租约已过期
 * —— 后者意味着认领它的进程已经退出,外层一定没真正发出去(见 Worker 的 `due()`)。
 * 仍持有活跃租约的 `processing` 不碰:调用可能已经在服务商侧发生,撤回只会让记录说谎。
 */
export async function cancelPendingNotifications(
	tx: Tx,
	sourceType: string,
	sourceIds: readonly string[],
): Promise<void> {
	if (!sourceIds.length) return;
	const events = await tx
		.select({ id: sysNotification.id })
		.from(sysNotification)
		.where(and(eq(sysNotification.source_type, sourceType), inArray(sysNotification.source_id, [...sourceIds])));
	if (!events.length) return;
	const now = new Date();
	await tx
		.update(sysNotificationDelivery)
		.set({ status: "cancelled", next_attempt_at: null, updated_at: now })
		.where(
			and(
				inArray(
					sysNotificationDelivery.notification_id,
					events.map((event) => event.id),
				),
				or(
					eq(sysNotificationDelivery.status, "pending"),
					and(eq(sysNotificationDelivery.status, "processing"), lte(sysNotificationDelivery.locked_until, now)),
				),
			),
		);
}

/**
 * 与业务变更共用事务；调用者负责在提交后发刷新信号。
 *
 * 标题在这里统一截断到列宽(`sys_notification.title` 是 varchar(128))。
 * 调用方普遍拼了任务名(`轮到你:${task.name}`),而任务名上限 255 —— 不截断的话
 * MySQL 严格模式会抛 `Data too long`,把**整个业务事务**一起回滚。
 */
export async function createNotification(tx: Tx, input: NotificationInput): Promise<string> {
	const id = newId();
	const now = new Date();
	const recipients = new Map<string, NotificationRecipient>();
	for (const recipient of input.recipients) {
		if (!recipient.userId || (recipient.channel !== "in_app" && !recipient.target?.trim())) {
			throw new Error("通知收件人或渠道目标无效");
		}
		recipients.set(`${recipient.userId}:${recipient.channel}`, recipient);
	}
	if (!input.dedupeKey || recipients.size === 0) throw new Error("通知必须有幂等键和收件人");
	// 按码点截断,避免把 emoji 之类的代理对切成半个字符
	const title = [...input.title].slice(0, NOTIFICATION_TITLE_MAX).join("");
	await tx.insert(sysNotification).values({
		id,
		type: input.type,
		source_type: input.source?.type ?? null,
		source_id: input.source?.id ?? null,
		title,
		content: input.content ?? null,
		payload: input.payload ? JSON.stringify(input.payload) : null,
		dedupe_key: input.dedupeKey,
		created_at: now,
	});
	await tx.insert(sysNotificationDelivery).values(
		[...recipients.values()].map((recipient) => ({
			id: newId(),
			notification_id: id,
			recipient_id: recipient.userId,
			channel: recipient.channel,
			target: recipient.target ?? null,
			status: recipient.channel === "in_app" ? "sent" : "pending",
			sent_at: recipient.channel === "in_app" ? now : null,
			next_attempt_at: recipient.channel === "in_app" ? null : new Date(Math.floor(now.getTime() / 1000) * 1000),
			created_at: now,
			updated_at: now,
		})),
	);
	return id;
}

/** 允许业务使用同一幂等键安全重试；只有整个事务成功才对外可见。 */
export async function sendNotification(input: NotificationInput): Promise<{ id: string; created: boolean }> {
	let id: string;
	try {
		id = await db.transaction((tx) => createNotification(tx, input));
	} catch (error) {
		const [existing] = await db
			.select({ id: sysNotification.id })
			.from(sysNotification)
			.where(eq(sysNotification.dedupe_key, input.dedupeKey))
			.limit(1);
		if (existing) return { id: existing.id, created: false };
		throw error;
	}
	for (const userId of new Set(
		input.recipients.filter((item) => item.channel === "in_app").map((item) => item.userId),
	)) {
		publish({ channel: `notice:${userId}`, name: "notice.new", data: { id } });
	}
	return { id, created: true };
}
