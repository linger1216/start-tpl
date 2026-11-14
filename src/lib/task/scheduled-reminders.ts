import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import {
	sysNotification,
	sysUser,
	taskActionTable,
	taskMemberTable,
	taskReminderTable,
	taskTable,
} from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { cancelPendingNotifications, createNotification, type NotificationChannel } from "#/lib/notification";
import { taskPathOf } from "#/lib/task/close-spec";
import { reminderEvents, taskReminderConfigSchema } from "#/lib/task/reminder-spec";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Task = typeof taskTable.$inferSelect;

function terminal(task: Task): boolean {
	const workflow = task.workflow as { statuses?: Array<{ value: string; terminal?: boolean }> } | null;
	return !!task.deleted_at || !!workflow?.statuses?.some((s) => s.value === task.status && s.terminal);
}

/** The task lock serializes changes; the deterministic key also protects each logical event. */
async function insertScheduled(tx: Tx, value: typeof taskReminderTable.$inferInsert): Promise<void> {
	const key = `task.schedule:${createHash("sha256")
		.update(
			JSON.stringify([
				value.task_id,
				value.kind,
				value.action_id,
				value.recipient_id,
				value.offset_minutes,
				Math.floor(value.scheduled_at.getTime() / 1000),
				[...(value.channels as string[])].sort(),
			]),
		)
		.digest("hex")}`;
	const [existing] = await tx.select().from(taskReminderTable).where(eq(taskReminderTable.event_key, key)).limit(1);
	if (existing) {
		if (existing.status === "cancelled")
			await tx
				.update(taskReminderTable)
				.set({ status: "pending", updated_at: value.updated_at })
				.where(eq(taskReminderTable.id, existing.id));
		return;
	}
	await tx.insert(taskReminderTable).values({ ...value, event_key: key });
}

/** Called while the task row is locked. Existing pending external deliveries are also cancelled. */
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
	if (!task.reminder_config || !action.activated_at || terminal(task)) return;
	const config = taskReminderConfigSchema.parse(task.reminder_config);
	for (const event of reminderEvents(config, "node", action.activated_at, now)) {
		const id = newId();
		await insertScheduled(tx, {
			id,
			task_id: task.id,
			action_id: action.id,
			recipient_id: action.assignee_id,
			kind: "node",
			offset_minutes: event.offset,
			channels: config.node.channels,
			scheduled_at: event.at,
			status: "pending",
			event_key: id,
			created_at: now,
			updated_at: now,
		});
	}
}

/** Replace future schedules only when the relevant task settings or executor change. */
export async function rescheduleTaskReminders(
	tx: Tx,
	task: Task,
	now: Date,
	kind?: "executor" | "node",
): Promise<void> {
	if (!task.reminder_config || terminal(task)) {
		await cancelTaskReminders(tx, task.id, now, kind);
		return;
	}
	const config = taskReminderConfigSchema.parse(task.reminder_config);
	const members = await tx
		.select({ userId: taskMemberTable.user_id })
		.from(taskMemberTable)
		.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.role, "executor")));
	const recipients = members.map((m) => m.userId);
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
	if (kind !== "node" && task.due_at)
		for (const userId of recipients)
			for (const offset of config.executor.offsets)
				desired.push({
					kind: "executor",
					actionId: null,
					userId,
					offset,
					at: new Date(task.due_at.getTime() - offset * 60000),
					channels: config.executor.channels,
				});
	if (kind !== "executor")
		for (const action of actions)
			if (action.activated_at)
				for (const offset of config.node.offsets)
					desired.push({
						kind: "node",
						actionId: action.id,
						userId: action.assignee_id,
						offset,
						at: new Date(action.activated_at.getTime() + offset * 60000),
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
	const matches = (row: typeof taskReminderTable.$inferSelect, item: (typeof desired)[number]) =>
		row.kind === item.kind &&
		row.action_id === item.actionId &&
		row.recipient_id === item.userId &&
		row.offset_minutes === item.offset &&
		Math.floor(row.scheduled_at.getTime() / 1000) === Math.floor(item.at.getTime() / 1000) &&
		JSON.stringify([...(row.channels as string[])].sort()) === JSON.stringify([...item.channels].sort());
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
	for (const item of desired) {
		if (item.at <= now || existing.some((row) => matches(row, item))) continue;
		const id = newId();
		await insertScheduled(tx, {
			id,
			task_id: task.id,
			action_id: item.actionId,
			recipient_id: item.userId,
			kind: item.kind,
			offset_minutes: item.offset,
			channels: item.channels,
			scheduled_at: item.at,
			status: "pending",
			event_key: id,
			created_at: now,
			updated_at: now,
		});
	}
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
			// The pre-upgrade worker used these keys for the default first and second reminders.
			if (eligible && entry.action_id && (entry.offset_minutes === 60 || entry.offset_minutes === 180)) {
				const key = `action.unviewed:${entry.action_id}:${entry.offset_minutes === 60 ? 1 : 2}`;
				const [old] = await tx
					.select({ id: sysNotification.id })
					.from(sysNotification)
					.where(eq(sysNotification.dedupe_key, key))
					.limit(1);
				if (old) eligible = false;
			}
		} else {
			const members = await tx
				.select({ userId: taskMemberTable.user_id })
				.from(taskMemberTable)
				.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.role, "executor")));
			eligible &&=
				!!task.due_at &&
				(members.length
					? members.some((m) => m.userId === entry.recipient_id)
					: task.creator_id === entry.recipient_id);
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
		const channels = entry.channels as NotificationChannel[];
		await createNotification(tx, {
			type: entry.kind === "node" ? "action.unviewed" : "task.deadline",
			source: { type: "task_scheduled_reminder", id },
			title: `${entry.kind === "node" ? "待查看" : "截止提醒"}：${task.name}`,
			content: entry.kind === "node" ? "您有一项未查看的审批或征询。" : "任务即将到达截止时间。",
			payload: { path: taskPathOf(task.id), taskId: task.id, actionId: entry.action_id, level: "warn" },
			dedupeKey: `task.schedule:${id}`,
			allowMissingTargets: true,
			recipients: channels.map((channel) => ({
				userId: user.id,
				channel,
				target:
					channel === "email"
						? z.string().email().safeParse(user.email).success
							? user.email
							: null
						: channel === "sms"
							? user.phone && /^\+?[0-9][0-9 -]{5,30}$/.test(user.phone)
								? user.phone
								: null
							: null,
			})),
		});
		await tx.update(taskReminderTable).set({ status: "sent", updated_at: now }).where(eq(taskReminderTable.id, id));
		return 1;
	});
}

export async function runScheduledTaskReminders(now = new Date()): Promise<number> {
	const rows = await db
		.select({ id: taskReminderTable.id })
		.from(taskReminderTable)
		.where(and(eq(taskReminderTable.status, "pending"), lte(taskReminderTable.scheduled_at, now)))
		.limit(200);
	let count = 0;
	for (const row of rows) count += await runReminder(row.id, now);
	return count;
}
