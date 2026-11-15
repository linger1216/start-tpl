import { and, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "#/db";
import { sysNotification, sysNotificationDelivery } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import type { NoticeLevel } from "#/lib/notice-levels";
import { safeNoticePath } from "#/lib/notice-path";
import { type Channel, MISSING_NOTIFICATION_TARGET, NOTIFICATION_TITLE_MAX } from "#/lib/notification-status";

/** 真源在 `notification-status.ts`(客户端安全);这里转出便于既有引用 */
export { NOTIFICATION_TITLE_MAX };

import { publish } from "#/lib/sse-bus";

/** 渠道真源在 `notification-status.ts`;这里只是模块内惯用名 */
export type NotificationChannel = Channel;
export type NotificationRecipient = { userId: string; channel: Channel; target?: string | null };
export type NotificationInput = {
	type: string;
	source?: { type: string; id: string };
	title: string;
	content?: string | null;
	/** 站内跳转路径 —— 落 `sys_notification.path` 列(白名单校验由 `createNotification` 做) */
	path?: string | null;
	/** 展示级别 —— 落 `sys_notification.level` 列,默认 `info` */
	level?: NoticeLevel;
	/** 各类通知**特有**的附加字段(`commentId` / `actionId` / `taskId` / `operatorId` …) */
	payload?: Record<string, unknown>;
	dedupeKey: string;
	recipients: readonly NotificationRecipient[];
	/** 缺少外部渠道联系方式时保留失败投递，其他渠道仍可发送。 */
	allowMissingTargets?: boolean;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
		if (
			!recipient.userId ||
			(recipient.channel !== "in_app" && !recipient.target?.trim() && !input.allowMissingTargets)
		) {
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
		path: safeNoticePath(input.path),
		level: input.level ?? "info",
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
			status: recipient.channel === "in_app" ? "sent" : recipient.target?.trim() ? "pending" : "failed",
			last_error:
				recipient.channel !== "in_app" && !recipient.target?.trim()
					? recipient.channel === "sms"
						? MISSING_NOTIFICATION_TARGET.sms
						: MISSING_NOTIFICATION_TARGET.email
					: null,
			sent_at: recipient.channel === "in_app" ? now : null,
			next_attempt_at:
				recipient.channel === "in_app" || !recipient.target?.trim()
					? null
					: new Date(Math.floor(now.getTime() / 1000) * 1000),
			created_at: now,
			updated_at: now,
		})),
	);
	return id;
}

/**
 * 往收件人的 SSE 频道推一条「有新通知」。
 *
 * 通知的频道名与事件名**只有这一处** —— 之前 `sendNotification` 与 `routers/task/common.ts`
 * 的 `publishNotice` 各写了一遍 `channel: \`notice:${userId}\` / name: "notice.new"`,
 * 改一边漏一边就是「铃铛不亮但列表里有」。
 *
 * 只在站内渠道有意义(短信 / 邮件没有浏览器订阅者)。
 */
export function publishNotice(receivers: readonly string[], data: Record<string, unknown> = {}): void {
	for (const userId of receivers) publish({ channel: `notice:${userId}`, name: "notice.new", data });
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
	publishNotice([...new Set(input.recipients.filter((item) => item.channel === "in_app").map((item) => item.userId))], {
		id,
	});
	return { id, created: true };
}
