import { z } from "zod";

/** 提醒方式:站内 / 短信 / 邮件(多选、不重复) */
export const REMINDER_CHANNELS = ["in_app", "sms", "email"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
export const CHANNEL_LABELS: Record<ReminderChannel, string> = {
	in_app: "站内",
	email: "邮件",
	sms: "短信",
};

const channels = z
	.array(z.enum(REMINDER_CHANNELS))
	.max(3)
	.refine((values) => new Set(values).size === values.length);

/** 提醒频率:关闭 / 每天 / 每周(每周 = 从窗口起点那天起每 7 天) */
export const REMINDER_CADENCES = ["off", "daily", "weekly"] as const;
export type ReminderCadence = (typeof REMINDER_CADENCES)[number];
export const CADENCE_LABELS: Record<ReminderCadence, string> = {
	off: "关闭",
	daily: "每天一次",
	weekly: "每周一次",
};

/** 本地时间点 `HH:mm` */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 窗口最长 90 天:再长也不像"提前提醒",也给每天一次的排期留个上界 */
export const MAX_DAYS_BEFORE = 90;

/**
 * 执行人截止提醒:截止前 `daysBefore` 天起,每天(或每 7 天)在 `time` 提醒一次,直到截止。
 * 只在**工作日**提醒 —— 周末与法定节假日跳过(调休上班的周末照常)。
 */
export const executorReminderRuleSchema = z
	.object({
		cadence: z.enum(REMINDER_CADENCES),
		time: z.string().regex(TIME_PATTERN, "时间写成 HH:mm"),
		daysBefore: z.number().int().min(1).max(MAX_DAYS_BEFORE),
		channels,
	})
	.refine((value) => value.cadence === "off" || value.channels.length > 0, { message: "请至少选择一种提醒方式" });

/** 节点未查看提醒的时长选项(下拉与摘要共用同一份措辞) */
export const NODE_REMINDER_OPTIONS = [
	{ value: "", label: "关闭" },
	{ value: "30", label: "30 分钟" },
	{ value: "60", label: "1 小时" },
	{ value: "240", label: "4 小时" },
	{ value: "1440", label: "1 天" },
] as const;

/** 节点处理人未查看提醒:激活后超过这个时长仍未查看 → 提醒一次;`null` = 关闭 */
const nodeRule = z
	.object({
		afterMinutes: z.number().int().min(1).max(10080).nullable(),
		channels,
	})
	.refine((value) => value.afterMinutes === null || value.channels.length > 0, { message: "请至少选择一种提醒方式" });

export type ExecutorReminderRule = z.infer<typeof executorReminderRuleSchema>;
export type NodeReminderRule = z.infer<typeof nodeRule>;
export type TaskReminderConfig = { executor: ExecutorReminderRule; node: NodeReminderRule };

/** 新建任务的默认:截止提醒默认**关**(要人主动开);节点未查看默认 1 小时、站内 */
export function defaultTaskReminders(): TaskReminderConfig {
	return {
		executor: { cadence: "off", time: "09:00", daysBefore: 3, channels: [] },
		node: { afterMinutes: 60, channels: ["in_app"] },
	};
}

export const DEFAULT_TASK_REMINDERS = defaultTaskReminders();

export const taskReminderConfigSchema = z
	.object({ executor: executorReminderRuleSchema, node: nodeRule })
	.default(defaultTaskReminders);

/**
 * 读一条 `tc_task.reminder_config`。
 *
 * **旧结构(offsets 数组)按「关」处理**:开发期不做迁移,但绝不能让一条老配置把任务列表 / 详情读崩。
 */
export function readTaskReminderConfig(value: unknown): TaskReminderConfig {
	const parsed = taskReminderConfigSchema.safeParse(value);
	return parsed.success ? parsed.data : defaultTaskReminders();
}

/**
 * 工作日判据(**由调用方注入**)。
 *
 * 这里刻意**不 import** `#/lib/workday`:那份节假日数据只有服务端需要,
 * 本模块被建任务弹窗(客户端)引用 —— 一旦在这里 import,数据就有机会被打进客户端包。
 */
export type WorkdayFilter = (date: Date) => boolean;

/** 某个自然日的 `HH:mm`(本地) */
function atTime(day: Date, hour: number, minute: number): Date {
	return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

/** 同一时刻往下找最近的工作日(跨周末 / 长假) */
function nextWorkdayAt(at: Date, isWorkday: WorkdayFilter): Date {
	const next = new Date(at);
	for (let i = 0; i < 15; i += 1) {
		next.setDate(next.getDate() + 1);
		if (isWorkday(next)) return next;
	}
	return next;
}

/** 提醒时刻离目标时间还有几分钟(写进 `tc_task_reminder.offset_minutes`;每天的值不同) */
function offsetMinutes(from: Date, to: Date): number {
	return Math.round((from.getTime() - to.getTime()) / 60000);
}

/**
 * 展开执行人截止提醒:
 * **截止前 `daysBefore` 天起,每天(weekly = 每 7 天)的 `time`,只留工作日、只留未来、不晚于截止。**
 *
 * 每周那次若落在非工作日 → 顺延到下一个工作日(顺延后仍要 ≤ 截止才算数);每天那次直接跳过非工作日。
 */
export function executorReminderEvents(
	rule: ExecutorReminderRule,
	dueAt: Date,
	now: Date,
	{ isWorkday }: { isWorkday: WorkdayFilter },
): Array<{ at: Date; offset: number }> {
	if (rule.cadence === "off") return [];
	const [hour, minute] = rule.time.split(":").map(Number);
	if (!Number.isInteger(hour) || !Number.isInteger(minute)) return [];
	const step = rule.cadence === "weekly" ? 7 : 1;
	const start = atTime(
		new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate() - rule.daysBefore),
		hour,
		minute,
	);
	const events: Array<{ at: Date; offset: number }> = [];
	// 窗口 ≤ 90 天 + 步长 ≥ 1 天,循环有天然上界
	for (let cursor = start; cursor.getTime() <= dueAt.getTime(); ) {
		const at = !isWorkday(cursor) && step === 7 ? nextWorkdayAt(cursor, isWorkday) : cursor;
		if (isWorkday(at) && at.getTime() <= dueAt.getTime() && at.getTime() > now.getTime())
			events.push({ at, offset: offsetMinutes(dueAt, at) });
		cursor = atTime(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + step), hour, minute);
	}
	return events;
}

/**
 * 展开节点未查看提醒:激活后 `afterMinutes` 一次;落在非工作日就顺延到下一个工作日的**同一时刻**。
 */
export function nodeReminderEvents(
	rule: NodeReminderRule,
	activatedAt: Date,
	now: Date,
	{ isWorkday }: { isWorkday: WorkdayFilter },
): Array<{ at: Date; offset: number }> {
	if (rule.afterMinutes === null) return [];
	const after = new Date(activatedAt.getTime() + rule.afterMinutes * 60_000);
	const at = isWorkday(after) ? after : nextWorkdayAt(after, isWorkday);
	if (at.getTime() <= now.getTime()) return [];
	return [{ at, offset: rule.afterMinutes }];
}

/** 时长数字 → 人话(下拉选项的措辞就是唯一真源) */
function nodeLabelOf(minutes: number): string {
	return NODE_REMINDER_OPTIONS.find((item) => item.value === String(minutes))?.label ?? `${minutes} 分钟`;
}

/** 执行人截止提醒的人话:编辑区就用它,别在各处重拼措辞 */
export function executorSummaryOf(rule: ExecutorReminderRule): string {
	if (rule.cadence === "off") return "已关闭。要提醒就选「每天一次」或「每周一次」。";
	const cadence = rule.cadence === "daily" ? "每天" : "每 7 天";
	return `截止前 ${rule.daysBefore} 天起,${cadence} ${rule.time} 提醒一次,直到截止;周末与法定节假日不提醒(调休上班日照常)。`;
}

/** 节点未查看提醒的人话 */
export function nodeSummaryOf(rule: NodeReminderRule): string {
	if (rule.afterMinutes === null) return "已关闭。";
	return `节点激活后超过 ${nodeLabelOf(rule.afterMinutes)} 仍未查看时提醒一次(落在非工作日顺延到下一个工作日)。`;
}

/** 一句话摘要:表单折叠区的 meta 用它(短版) */
export function reminderSummaryOf(config: TaskReminderConfig): string {
	const { executor, node } = config;
	const executorText =
		executor.cadence === "off"
			? "截止提醒已关闭"
			: `截止前 ${executor.daysBefore} 天起${executor.cadence === "daily" ? "每天" : "每 7 天"} ${executor.time}(工作日)`;
	const nodeText = node.afterMinutes === null ? "未查看提醒已关闭" : `未查看 ${nodeLabelOf(node.afterMinutes)}后提醒`;
	return `${executorText};${nodeText}`;
}
