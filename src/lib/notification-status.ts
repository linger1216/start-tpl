/**
 * 通知投递状态的中文名 —— **全站一份**。
 *
 * 之前 `task-reminders.tsx`、`task-urge.tsx`、`notice-delivery-history.tsx` 各抄了一遍,
 * 改一个措辞要动三处;状态码来自 `sys_notification_delivery.status`(与库里的字符串一一对应)。
 */
export const DELIVERY_STATUS_LABEL: Record<string, string> = {
	pending: "等待投递",
	processing: "投递中",
	sent: "已发送",
	failed: "投递失败",
	cancelled: "已取消",
};

/**
 * 投递状态 → 中文;认不出的原样返回。
 *
 * `status` 列是 `varchar`,库里可能留着退役状态值 —— 所以必须兜底,
 * 但兜底**只写这一处**(之前 3 个调用点各写一遍 `DELIVERY_STATUS_LABEL[x] ?? x`)。
 */
export const deliveryStatusLabel = (status: string): string => DELIVERY_STATUS_LABEL[status] ?? status;

/**
 * 通知渠道 —— **全站唯一真源**。
 *
 * 之前这份清单在四处各写一遍:`notification.ts` 的 `NotificationChannel` 类型、
 * `reminder-spec.ts` 的 `REMINDER_CHANNELS` + `ReminderChannel`、`reminder.ts` 的 `z.enum([...])`、
 * `notification-target.ts` 的 `targetOf` 参数。加一个渠道要改四处。
 *
 * 放这里(而不是 `notification.ts`)是因为本文件是**纯字面量、客户端安全** —— 前端也要读它,
 * 而 `notification.ts` 引了 `db`。
 */
export const CHANNELS = ["in_app", "sms", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

/** 渠道 → 中文名(与 `CHANNELS` 一一对应,加渠道时两处都要改) */
export const CHANNEL_LABELS: Record<Channel, string> = { in_app: "站内", sms: "短信", email: "邮件" };

/** 运行时判定:JSON 列 / 表单值里读出来的东西是不是一个合法渠道 */
export const isChannel = (value: unknown): value is Channel =>
	typeof value === "string" && (CHANNELS as readonly string[]).includes(value);

/**
 * 渠道 → 中文;认不出的原样返回(`channel` 列是 `varchar`,可能留着退役值)。
 *
 * 兜底只写这一处 —— 之前 `notice-delivery-history` 与 `task-reminders` 各写一遍
 * `CHANNEL_LABELS[x] ?? x`,后者还多包了一层 `channelLabelOf`。
 */
export const channelLabel = (channel: string): string => (isChannel(channel) ? CHANNEL_LABELS[channel] : channel);

/**
 * 收件人 / 处理人查不到名字时的占位 —— 用户被软删之后,通知与投递记录仍要能显示,
 * 不能留空也不能崩。四处(`task/reminder.ts` 三处 + `notice-delivery-history` 一处)之前各写一遍。
 */
export const UNKNOWN_USER_LABEL = "已删除用户";

/** 可安全向接收者展示的投递配置错误。 */
export const MISSING_NOTIFICATION_TARGET = { sms: "未配置有效的联系电话", email: "未配置有效的邮箱" } as const;

/** 通知标题上限 —— 与 `sys_notification.title` 的 `varchar(128)` 对齐,`createNotification` 按码点截断 */
export const NOTIFICATION_TITLE_MAX = 128;

/** 通知正文上限 —— `content` 列是 `text`,这是**业务**上愿意让人读的长度 */
export const NOTICE_BODY_MAX = 255;

/** 一次拉取的通知条数上限 —— 台账页与监听器都按它 */
export const NOTICE_PAGE_LIMIT = 500;
