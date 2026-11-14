import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { sysNotification, sysNotificationAttempt, sysNotificationDelivery } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { sendMail } from "#/lib/mailer";

export type DeliveryMessage = {
	idempotencyKey: string;
	target: string;
	title: string;
	content: string;
};
export type DeliveryProvider = {
	name: string;
	send: (message: DeliveryMessage) => Promise<{ messageId?: string }>;
};
export type DeliveryProviders = { email: DeliveryProvider; sms: DeliveryProvider };

const MAX_ATTEMPTS = 5;
const LEASE_MS = 120_000;

/** 开发驱动不会把打印日志伪装成真实投递。可在 Worker 启动时注入真实 SMS provider。 */
export const defaultDeliveryProviders: DeliveryProviders = {
	email: {
		name: "smtp",
		async send(message) {
			if (process.env.MAIL_DRIVER !== "smtp") throw new Error("邮件未配置 SMTP，未投递");
			return sendMail({
				to: message.target,
				subject: message.title,
				text: message.content,
				messageId: message.idempotencyKey,
			});
		},
	},
	sms: {
		name: "unconfigured",
		async send() {
			throw new Error("短信服务商未配置，未投递");
		},
	},
};

function due(now: Date) {
	return or(
		and(eq(sysNotificationDelivery.status, "pending"), lte(sysNotificationDelivery.next_attempt_at, now)),
		and(eq(sysNotificationDelivery.status, "processing"), lte(sysNotificationDelivery.locked_until, now)),
	);
}

/** 条件更新是唯一认领点；即使两个 Worker 看到同一候选，也只有一个可以取得租约。 */
async function claimDelivery(id: string, now: Date) {
	const token = newId();
	return db.transaction(async (tx) => {
		const result = await tx
			.update(sysNotificationDelivery)
			.set({
				status: "processing",
				lock_token: token,
				locked_until: new Date(now.getTime() + LEASE_MS),
				attempts: sql`${sysNotificationDelivery.attempts} + 1`,
				updated_at: now,
			})
			.where(and(eq(sysNotificationDelivery.id, id), due(now)));
		if (result[0].affectedRows !== 1) return null;
		const [row] = await tx
			.select({ delivery: sysNotificationDelivery, notification: sysNotification })
			.from(sysNotificationDelivery)
			.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
			.where(and(eq(sysNotificationDelivery.id, id), eq(sysNotificationDelivery.lock_token, token)))
			.limit(1);
		if (!row) throw new Error("已认领的投递不存在");
		// 过期租约说明前一次进程在回写结果之前退出，真实结果未知。
		await tx
			.update(sysNotificationAttempt)
			.set({ status: "failed", error: "租约过期，投递结果未知", finished_at: now })
			.where(and(eq(sysNotificationAttempt.delivery_id, id), eq(sysNotificationAttempt.status, "processing")));
		if (row.delivery.attempts > MAX_ATTEMPTS) {
			await tx
				.update(sysNotificationDelivery)
				.set({
					status: "failed",
					attempts: MAX_ATTEMPTS,
					last_error: "重试次数已用尽，上次投递结果未知",
					locked_until: null,
					lock_token: null,
					next_attempt_at: null,
					updated_at: now,
				})
				.where(and(eq(sysNotificationDelivery.id, id), eq(sysNotificationDelivery.lock_token, token)));
			return null;
		}
		const attemptId = newId();
		await tx.insert(sysNotificationAttempt).values({
			id: attemptId,
			delivery_id: id,
			attempt_no: row.delivery.attempts,
			status: "processing",
			started_at: now,
		});
		return { ...row, token, attemptId };
	});
}

/** 认领并执行一条投递；Provider 在事务之外调用，投递语义为至少一次。 */
export async function processNotificationDelivery(
	id: string,
	providers: DeliveryProviders = defaultDeliveryProviders,
): Promise<boolean> {
	const claim = await claimDelivery(id, new Date());
	if (!claim) return false;
	const { delivery, notification, token, attemptId } = claim;
	let provider: DeliveryProvider | undefined;
	let providerMessageId: string | null = null;
	let error: string | null = null;
	try {
		if (delivery.channel !== "email" && delivery.channel !== "sms") throw new Error("不支持的外部投递渠道");
		if (!delivery.target) throw new Error("缺少投递目标");
		provider = providers[delivery.channel];
		const result = await provider.send({
			idempotencyKey: delivery.id,
			target: delivery.target,
			title: notification.title,
			content: notification.content ?? "",
		});
		providerMessageId = result.messageId ?? null;
	} catch (cause) {
		error = ((cause instanceof Error ? cause.message : String(cause)) || "投递失败").slice(0, 2000);
	}
	const finished = new Date();
	await db.transaction(async (tx) => {
		const result = await tx
			.update(sysNotificationDelivery)
			.set({
				status: error ? (delivery.attempts >= MAX_ATTEMPTS ? "failed" : "pending") : "sent",
				provider_message_id: providerMessageId,
				sent_at: error ? null : finished,
				last_error: error,
				next_attempt_at:
					error && delivery.attempts < MAX_ATTEMPTS
						? new Date(finished.getTime() + Math.min(3_600_000, 30_000 * 2 ** (delivery.attempts - 1)))
						: null,
				locked_until: null,
				lock_token: null,
				updated_at: finished,
			})
			.where(
				and(
					eq(sysNotificationDelivery.id, delivery.id),
					eq(sysNotificationDelivery.status, "processing"),
					eq(sysNotificationDelivery.lock_token, token),
				),
			);
		if (result[0].affectedRows !== 1) return;
		await tx
			.update(sysNotificationAttempt)
			.set({ status: error ? "failed" : "sent", provider: provider?.name ?? null, error, finished_at: finished })
			.where(and(eq(sysNotificationAttempt.id, attemptId), isNull(sysNotificationAttempt.finished_at)));
	});
	return true;
}

/** 扫描到期投递，认领时再次检查状态以处理多 Worker 竞争。 */
export async function processNotificationDeliveries(
	providers: DeliveryProviders = defaultDeliveryProviders,
	limit = 50,
): Promise<number> {
	const candidates = await db
		.select({ id: sysNotificationDelivery.id })
		.from(sysNotificationDelivery)
		.where(due(new Date()))
		.orderBy(sysNotificationDelivery.created_at)
		.limit(limit);
	let processed = 0;
	for (const candidate of candidates) if (await processNotificationDelivery(candidate.id, providers)) processed += 1;
	return processed;
}
