import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "#/db";
import { sysUser, taskActionTable, taskReminderTable, taskTable } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { cancelPendingNotifications, createNotification, type NotificationChannel } from "#/lib/notification";
import { isClosedSnapshot, taskPathOf } from "#/lib/task/close-spec";
import { eventKeyOf, targetOf } from "#/lib/task/notification-target";
import { payloadOf } from "#/lib/task/payload";
import {
	channelsOf,
	executorReminderEvents,
	nodeReminderEvents,
	readTaskReminderConfig,
} from "#/lib/task/reminder-spec";
import { isWorkingDay, nextWorkingDayAt } from "#/lib/workday";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Task = typeof taskTable.$inferSelect;

/** 结束(终态或软删)的任务不再排提醒 —— 判据在 `close-spec.isClosedSnapshot`,与其它调用点同源 */
const terminal = (task: Task) => isClosedSnapshot(payloadOf(task.payload)?.workflow, task.status, task.deleted_at);

/**
 * 一条排期的**身份** —— 「同一条」的判据只有这一份。
 *
 * 两处都用它:`insertScheduled` 拿它当 DB 里的 `event_key`,`rescheduleTaskReminders` 拿它比内存里的期望值。
 * 之前两处各抄一遍字段列表,加字段必然漏改一处。
 */
function scheduleKeyOf(row: typeof taskReminderTable.$inferInsert): string {
	return eventKeyOf("task.schedule", [
		row.task_id,
		row.kind,
		row.action_id,
		row.recipient_id,
		row.offset_minutes,
		Math.floor(row.scheduled_at.getTime() / 1000),
		[...channelsOf(row.channels)].sort(),
	]);
}

/** 持任务锁批量对齐排期；按幂等键复活取消行，已发送事件不重复创建。 */
async function insertScheduled(tx: Tx, values: Array<typeof taskReminderTable.$inferInsert>, now: Date): Promise<void> {
	const byKey = new Map<string, typeof taskReminderTable.$inferInsert>();
	for (const value of values) {
		const key = scheduleKeyOf(value);
		if (!byKey.has(key)) byKey.set(key, { ...value, event_key: key });
	}
	const entries = [...byKey.entries()];
	// 限制 IN 与多行 INSERT 的参数量，兼容双库驱动。
	for (let index = 0; index < entries.length; index += 200) {
		const chunk = entries.slice(index, index + 200);
		const existing = await tx
			.select({ id: taskReminderTable.id, key: taskReminderTable.event_key, status: taskReminderTable.status })
			.from(taskReminderTable)
			.where(
				inArray(
					taskReminderTable.event_key,
					chunk.map(([key]) => key),
				),
			);
		const existingKeys = new Set(existing.map((row) => row.key));
		const restore = existing.filter((row) => row.status === "cancelled").map((row) => row.id);
		if (restore.length)
			await tx
				.update(taskReminderTable)
				.set({ status: "pending", updated_at: now })
				.where(inArray(taskReminderTable.id, restore));
		const missing = chunk.filter(([key]) => !existingKeys.has(key)).map(([, value]) => value);
		if (missing.length) await tx.insert(taskReminderTable).values(missing);
	}
}

/** 任务行已加锁时调用;顺带取消该任务已排的待投递外部通知。 */
export async function cancelTaskReminders(
	tx: Tx,
	taskId: string,
	now: Date,
	kind?: "executor" | "node",
): Promise<void> {
	const rows = await tx
		.select({ id: taskReminderTable.id })
		.from(taskReminderTable)
		.where(
			and(
				eq(taskReminderTable.task_id, taskId),
				eq(taskReminderTable.status, "pending"),
				kind ? eq(taskReminderTable.kind, kind) : undefined,
			),
		);
	if (rows.length)
		await tx
			.update(taskReminderTable)
			.set({ status: "cancelled", updated_at: now })
			.where(
				inArray(
					taskReminderTable.id,
					rows.map((r) => r.id),
				),
			);
	const all = await tx
		.select({ id: taskReminderTable.id })
		.from(taskReminderTable)
		.where(and(eq(taskReminderTable.task_id, taskId), kind ? eq(taskReminderTable.kind, kind) : undefined));
	await cancelPendingNotifications(
		tx,
		"task_scheduled_reminder",
		all.map((r) => r.id),
	);
}

export async function cancelActionReminders(tx: Tx, actionIds: readonly string[], now: Date): Promise<void> {
	if (!actionIds.length) return;
	const rows = await tx
		.select({ id: taskReminderTable.id })
		.from(taskReminderTable)
		.where(inArray(taskReminderTable.action_id, [...actionIds]));
	if (!rows.length) return;
	const ids = rows.map((row) => row.id);
	await tx
		.update(taskReminderTable)
		.set({ status: "cancelled", updated_at: now })
		.where(and(inArray(taskReminderTable.id, ids), eq(taskReminderTable.status, "pending")));
	await cancelPendingNotifications(tx, "task_scheduled_reminder", ids);
}

export async function scheduleNodeReminders(
	tx: Tx,
	task: Task,
	action: { id: string; assignee_id: string; activated_at: Date | null },
	now: Date,
): Promise<void> {
	if (!action.activated_at || terminal(task)) return;
	const config = readTaskReminderConfig(payloadOf(task.payload)?.reminders);
	const values = nodeReminderEvents(config.node, action.activated_at, now, { isWorkday: isWorkingDay }).map((event) => {
		const id = newId();
		return {
			id,
			task_id: task.id,
			action_id: action.id,
			recipient_id: action.assignee_id,
			kind: "node" as const,
			offset_minutes: event.offset,
			channels: config.node.channels,
			scheduled_at: event.at,
			status: "pending" as const,
			event_key: id,
			created_at: now,
			updated_at: now,
		};
	});
	await insertScheduled(tx, values, now);
}

/** Replace future schedules only when the relevant task settings or executor change. */
export async function rescheduleTaskReminders(
	tx: Tx,
	task: Task,
	now: Date,
	kind?: "executor" | "node",
): Promise<void> {
	if (terminal(task)) {
		await cancelTaskReminders(tx, task.id, now, kind);
		return;
	}
	const config = readTaskReminderConfig(payloadOf(task.payload)?.reminders);
	// 截止提醒只发给**唯一执行人**(执行人现在是 `tc_task.executor_id`,不再是成员表里的一种角色)
	const recipients = task.executor_id ? [task.executor_id] : [];
	const actions = await tx
		.select()
		.from(taskActionTable)
		.where(
			and(
				eq(taskActionTable.task_id, task.id),
				eq(taskActionTable.status, "active"),
				isNull(taskActionTable.viewed_at),
			),
		);
	const desired: Array<{
		kind: "executor" | "node";
		actionId: string | null;
		userId: string;
		offset: number;
		at: Date;
		channels: NotificationChannel[];
	}> = [];
	// 截止提醒:窗口内**每个工作日**的时刻(周末 / 节假日跳过;调休上班日照常)
	if (kind !== "node" && task.due_at)
		for (const userId of recipients)
			for (const event of executorReminderEvents(config.executor, task.due_at, now, { isWorkday: isWorkingDay }))
				desired.push({
					kind: "executor",
					actionId: null,
					userId,
					offset: event.offset,
					at: event.at,
					channels: config.executor.channels,
				});
	// 节点未查看提醒:激活后 X 时长一次(落在非工作日顺延到下一个工作日)
	if (kind !== "executor")
		for (const action of actions)
			if (action.activated_at)
				for (const event of nodeReminderEvents(config.node, action.activated_at, now, { isWorkday: isWorkingDay }))
					desired.push({
						kind: "node",
						actionId: action.id,
						userId: action.assignee_id,
						offset: event.offset,
						at: event.at,
						channels: config.node.channels,
					});
	const existing = await tx
		.select()
		.from(taskReminderTable)
		.where(
			and(
				eq(taskReminderTable.task_id, task.id),
				eq(taskReminderTable.status, "pending"),
				kind ? eq(taskReminderTable.kind, kind) : undefined,
			),
		);
	/**
	 * 「库里这行」与「期望值」是不是同一条。
	 *
	 * **刻意逐字段比、不拿 `event_key` 比**:行可能是历史版本写进去的,`event_key` 的算法改过一次
	 * (旧版内联 sha256,新版走 `eventKeyOf` —— 逐字相同,但不能赌库里没有更早的行)。
	 * 字段清单与 `scheduleKeyOf` 必须保持一致 —— 改一处要同时改另一边(没有测试兜,靠人看)。
	 */
	const matches = (row: typeof taskReminderTable.$inferSelect, item: (typeof desired)[number]) =>
		row.kind === item.kind &&
		row.action_id === item.actionId &&
		row.recipient_id === item.userId &&
		row.offset_minutes === item.offset &&
		Math.floor(row.scheduled_at.getTime() / 1000) === Math.floor(item.at.getTime() / 1000) &&
		JSON.stringify([...channelsOf(row.channels)].sort()) === JSON.stringify([...item.channels].sort());
	const sent = await tx
		.select()
		.from(taskReminderTable)
		.where(
			and(
				eq(taskReminderTable.task_id, task.id),
				eq(taskReminderTable.status, "sent"),
				kind ? eq(taskReminderTable.kind, kind) : undefined,
			),
		);
	await cancelPendingNotifications(
		tx,
		"task_scheduled_reminder",
		sent.filter((row) => !desired.some((item) => matches(row, item))).map((row) => row.id),
	);
	const invalid = existing.filter((row) => !desired.some((item) => matches(row, item)));
	if (invalid.length) {
		const ids = invalid.map((row) => row.id);
		await tx
			.update(taskReminderTable)
			.set({ status: "cancelled", updated_at: now })
			.where(inArray(taskReminderTable.id, ids));
		await cancelPendingNotifications(tx, "task_scheduled_reminder", ids);
	}
	const additions = desired
		.filter((item) => item.at > now && !existing.some((row) => matches(row, item)))
		.map((item) => {
			const id = newId();
			return {
				id,
				task_id: task.id,
				action_id: item.actionId,
				recipient_id: item.userId,
				kind: item.kind,
				offset_minutes: item.offset,
				channels: item.channels,
				scheduled_at: item.at,
				status: "pending" as const,
				event_key: id,
				created_at: now,
				updated_at: now,
			};
		});
	await insertScheduled(tx, additions, now);
}

async function runReminder(id: string, now: Date): Promise<number> {
	const [candidate] = await db
		.select({ taskId: taskReminderTable.task_id })
		.from(taskReminderTable)
		.where(eq(taskReminderTable.id, id));
	if (!candidate) return 0;
	return db.transaction(async (tx) => {
		const [task] = await tx.select().from(taskTable).where(eq(taskTable.id, candidate.taskId)).for("update");
		const [entry] = await tx.select().from(taskReminderTable).where(eq(taskReminderTable.id, id)).for("update");
		if (!task || !entry || entry.status !== "pending" || entry.scheduled_at > now) return 0;
		let eligible = !terminal(task);
		if (entry.kind === "node") {
			const [action] = entry.action_id
				? await tx.select().from(taskActionTable).where(eq(taskActionTable.id, entry.action_id))
				: [];
			eligible &&=
				!!action && action.status === "active" && !action.viewed_at && action.assignee_id === entry.recipient_id;
		} else {
			eligible &&=
				!!task.due_at &&
				(task.executor_id ? task.executor_id === entry.recipient_id : task.creator_id === entry.recipient_id);
		}
		const [user] = await tx.select().from(sysUser).where(eq(sysUser.id, entry.recipient_id)).limit(1);
		eligible &&= !!user && !user.deleted_at;
		if (!eligible || !user) {
			await tx
				.update(taskReminderTable)
				.set({ status: "cancelled", updated_at: now })
				.where(eq(taskReminderTable.id, id));
			return 0;
		}
		/**
		 * **送达时刻本身也得是工作日**:排期只排在工作日,但 worker 可能迟到(挂了 / 被误触发),
		 * 于是"到点该发的那条"会在周末或假期才被扫到 —— 这时不发,把它挪到下一个工作日的**计划时刻**。
		 */
		if (!isWorkingDay(now)) {
			await tx
				.update(taskReminderTable)
				.set({
					scheduled_at: nextWorkingDayAt(now, entry.scheduled_at.getHours(), entry.scheduled_at.getMinutes()),
					updated_at: now,
				})
				.where(eq(taskReminderTable.id, id));
			return 0;
		}
		const channels = entry.channels as NotificationChannel[];
		await createNotification(tx, {
			type: entry.kind === "node" ? "action.unviewed" : "task.deadline",
			source: { type: "task_scheduled_reminder", id },
			title: `${entry.kind === "node" ? "待查看" : "截止提醒"}：${task.name}`,
			content: entry.kind === "node" ? "您有一项未查看的审批或征询。" : "任务即将到达截止时间。",
			path: taskPathOf(task.id),
			level: "warn",
			dedupeKey: `task.schedule:${id}`,
			allowMissingTargets: true,
			recipients: channels.map((channel) => ({
				userId: user.id,
				channel,
				target: targetOf(channel, user),
			})),
		});
		await tx.update(taskReminderTable).set({ status: "sent", updated_at: now }).where(eq(taskReminderTable.id, id));
		return 1;
	});
}

/**
 * 把到点的定时提醒发出去。
 *
 * `taskId` 只为**测试 / 定点重放**准备:不带就扫全库(worker 的用法),
 * 带上就只处理这一个任务 —— 免得测试里一次调用把别人任务的排期一起发了。
 */
export async function runScheduledTaskReminders(
	now = new Date(),
	{ taskId }: { taskId?: string } = {},
): Promise<number> {
	const rows = await db
		.select({ id: taskReminderTable.id })
		.from(taskReminderTable)
		.where(
			and(
				eq(taskReminderTable.status, "pending"),
				lte(taskReminderTable.scheduled_at, now),
				taskId ? eq(taskReminderTable.task_id, taskId) : undefined,
			),
		)
		.limit(200);
	let count = 0;
	for (const row of rows) count += await runReminder(row.id, now);
	return count;
}
