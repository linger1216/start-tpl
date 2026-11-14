import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "#/db";
import { sysNotification, taskActionTable, taskTable } from "#/db/data-base-schema";
import { createNotification } from "#/lib/notification";
import { taskPathOf } from "#/lib/task/close-spec";
import { runScheduledTaskReminders } from "#/lib/task/scheduled-reminders";

/** 所有时间单位为分钟；第二轮距激活 180 分钟。 */
export const TASK_REMINDER_MINUTES = [60, 180] as const;

/**
 * 锁住动作行，在同一事务中再次检查状态并创建提醒。
 *
 * 用 `for update` 而不是「值不变的 UPDATE + 看 affectedRows」:后者依赖驱动把
 * 「匹配行数」报成影响行数(mysql2 默认带 `FOUND_ROWS` 才成立),达梦的 `rowsAffected`
 * 语义没有验证过 —— 一旦按「真正变更行数」计,这里会恒返回 0,两条提醒静默不发。
 * `for update` 与任务闭环其它并发路径同一套写法,语义确定。
 */
export async function checkActionReminder(actionId: string, now = new Date()): Promise<number> {
	return db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ id: taskActionTable.id })
			.from(taskActionTable)
			.where(
				and(
					eq(taskActionTable.id, actionId),
					eq(taskActionTable.status, "active"),
					isNull(taskActionTable.viewed_at),
					lte(taskActionTable.activated_at, now),
				),
			)
			.for("update");
		if (!locked) return 0;
		const [row] = await tx
			.select({ action: taskActionTable, task: taskTable })
			.from(taskActionTable)
			.innerJoin(taskTable, eq(taskTable.id, taskActionTable.task_id))
			.where(and(eq(taskActionTable.id, actionId), isNull(taskTable.deleted_at)))
			.limit(1);
		if (!row?.action.activated_at || row.task.reminder_config) return 0;
		const workflow = row.task.workflow as { statuses?: Array<{ value: string; terminal?: boolean }> } | null;
		if (workflow?.statuses?.some((status) => status.value === row.task.status && status.terminal)) return 0;
		let created = 0;
		for (const [index, minutes] of TASK_REMINDER_MINUTES.entries()) {
			if (now.getTime() - row.action.activated_at.getTime() < minutes * 60_000) continue;
			const key = `action.unviewed:${actionId}:${index + 1}`;
			const [existing] = await tx
				.select({ id: sysNotification.id })
				.from(sysNotification)
				.where(eq(sysNotification.dedupe_key, key))
				.limit(1);
			if (existing) continue;
			await createNotification(tx, {
				type: "action.unviewed",
				source: { type: "task_action", id: actionId },
				title: `待查看：${row.task.name}`,
				content: "您有一项未查看的审批或征询。",
				payload: { path: taskPathOf(row.task.id), actionId, level: "warn" },
				dedupeKey: key,
				recipients: [{ userId: row.action.assignee_id, channel: "in_app" }],
			});
			created += 1;
		}
		return created;
	});
}

export async function checkUnviewedActions(): Promise<number> {
	const threshold = new Date(Date.now() - TASK_REMINDER_MINUTES[0] * 60_000);
	const rows = await db
		.select({ id: taskActionTable.id })
		.from(taskActionTable)
		.where(
			and(
				eq(taskActionTable.status, "active"),
				isNull(taskActionTable.viewed_at),
				lte(taskActionTable.activated_at, threshold),
			),
		);
	let count = 0;
	for (const row of rows) count += await checkActionReminder(row.id);
	return count + (await runScheduledTaskReminders());
}
