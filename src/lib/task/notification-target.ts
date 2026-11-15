/**
 * 通知收件人相关的**唯一一份**口径:手机 / 邮箱校验、渠道 → 投递目标、事件幂等键。
 *
 * 为什么收口:同一个手机号正则、同一段「渠道 → target」分支、同一个 sha256 幂等键
 * 原本在 `routers/task/action.ts`、`routers/task/reminder.ts`、`lib/task/scheduled-reminders.ts`
 * 各写一遍 —— 改一处漏一处,就会出现「界面能发、后端拒收」或两条前缀不同的键互相不认。
 *
 * ⚠️ **服务端专用**(用 `node:crypto`)。客户端要的渠道名 / 冷却分钟数在 `lib/task/reminder-spec.ts`。
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { type Channel, MISSING_NOTIFICATION_TARGET } from "#/lib/notification-status";

/** 中国大陆手机号(带可选 `+` / 空格 / 横线);与用户资料里的写法保持一致 */
const PHONE_PATTERN = /^\+?[0-9][0-9 -]{5,30}$/;

function isValidPhone(phone: string | null | undefined): phone is string {
	return typeof phone === "string" && PHONE_PATTERN.test(phone);
}

function isValidEmail(email: string | null | undefined): email is string {
	return typeof email === "string" && z.string().email().safeParse(email).success;
}

/** 渠道 → 投递目标;站内没有外部目标,联系方式无效时返回 null(调用方按「该渠道失败」处理) */
export function targetOf(channel: Channel, user: { phone: string | null; email: string }): string | null {
	if (channel === "in_app") return null;
	if (channel === "sms") return isValidPhone(user.phone) ? user.phone : null;
	return isValidEmail(user.email) ? user.email : null;
}

/** 幂等键:`前缀:sha256(parts)` —— 两类事件(task.reminder / task.schedule)只有前缀不同 */
export function eventKeyOf(prefix: string, parts: readonly unknown[]): string {
	return `${prefix}:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

/** 仅公开可操作的配置错误，不泄露投递渠道返回的内部信息。 */
export function redactDeliveryError(error: string | null, admin: boolean): string | null {
	if (!error) return null;
	if (admin || Object.values(MISSING_NOTIFICATION_TARGET).some((value) => value === error)) return error;
	return "投递失败，请联系管理员";
}
