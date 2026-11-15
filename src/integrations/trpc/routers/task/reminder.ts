import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import {
	sysNotification,
	sysNotificationDelivery,
	sysUser,
	taskActionTable,
	taskMemberTable,
	taskReminderTable,
} from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { createNotification } from "#/lib/notification";
import { CHANNELS, UNKNOWN_USER_LABEL } from "#/lib/notification-status";
import { alive } from "#/lib/soft-delete";
import { REMINDER_COOLDOWN_MINUTES, taskPathOf } from "#/lib/task/close-spec";
import { eventKeyOf, redactDeliveryError, targetOf } from "#/lib/task/notification-target";
import { channelsOf, reminderKindOf } from "#/lib/task/reminder-spec";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	getTaskRow,
	ID,
	isAdminOf,
	isTaskParticipant,
	lockTask,
	nameMapOf,
	publishNotice,
	type TaskRow,
	type Tx,
} from "./common";

/** 提醒记录一次最多取这么多(与页面上的说明一致) */
const HISTORY_LIMIT = 200;
/** 悬浮预览最多给几条(再多就用"共 N 次 + 最后一次"概括) */
const PLAN_PREVIEW_LIMIT = 5;
/** 记录列表里「计划」最多列几条 —— 再多就把列表刷满了,完整计划看右上角预览 */
const HISTORY_PLAN_LIMIT = 3;

/** 按排期顺序获取未来待发提醒，供历史和预览共用。 */
async function pendingRemindersOf(reader: Pick<typeof db, "select">, taskId: string, now: number) {
	const rows = await reader
		.select()
		.from(taskReminderTable)
		.where(and(eq(taskReminderTable.task_id, taskId), eq(taskReminderTable.status, "pending")))
		.orderBy(asc(taskReminderTable.scheduled_at));
	return rows.filter((row) => row.scheduled_at.getTime() > now);
}

const channelsSchema = z
	.array(z.enum(CHANNELS))
	.min(1)
	.max(3)
	.refine((items) => new Set(items).size === items.length);
const requestSchema = z.object({
	taskId: ID,
	recipientIds: z
		.array(ID)
		.min(1)
		.max(100)
		.refine((ids) => new Set(ids).size === ids.length),
	channels: channelsSchema,
	requestId: z.string().min(1).max(64),
});

async function canRemind(
	task: TaskRow,
	user: { id: string; isSuper?: boolean },
	reader: Pick<typeof db, "select"> = db,
) {
	return (await isAdminOf(user)) || (await isTaskParticipant(task, user.id, reader));
}

async function candidates(task: TaskRow, reader: Pick<typeof db, "select"> = db) {
	const members = await reader
		.select({ id: taskMemberTable.user_id })
		.from(taskMemberTable)
		.where(eq(taskMemberTable.task_id, task.id));
	const actions = await reader
		.select({ id: taskActionTable.assignee_id })
		.from(taskActionTable)
		.where(and(eq(taskActionTable.task_id, task.id), eq(taskActionTable.status, "active")));
	const ids = [
		...new Set([
			task.creator_id,
			...(task.executor_id ? [task.executor_id] : []),
			...members.map((m) => m.id),
			...actions.map((a) => a.id),
		]),
	];
	return reader
		.select({ id: sysUser.id, name: sysUser.name, email: sysUser.email, phone: sysUser.phone })
		.from(sysUser)
		.where(and(inArray(sysUser.id, ids), alive(sysUser)));
}

export const taskReminderRouter = createTRPCRouter({
	reminderSend: protectedProcedure.input(requestSchema).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const created: { id: string; recipientId: string }[] = [];
		const results = await db.transaction(async (tx: Tx) => {
			// 同任务的冷却检查和创建通知串行，跨 Worker / 多发送人不会穿透。
			const task = await lockTask(tx, input.taskId);
			if (!(await canRemind(task, me, tx))) throw new TRPCError({ code: "FORBIDDEN", message: "无权发送任务提醒" });
			const users = new Map((await candidates(task, tx)).map((user) => [user.id, user]));
			if (input.recipientIds.some((id) => !users.has(id)))
				throw new TRPCError({ code: "BAD_REQUEST", message: "提醒对象必须是任务相关人员" });
			const output: { recipientId: string; status: "sent" | "cooldown" | "reused"; notificationId: string | null }[] =
				[];
			for (const recipientId of input.recipientIds) {
				const key = eventKeyOf("task.reminder", [task.id, me.id, input.requestId, recipientId]);
				const [existing] = await tx
					.select({ id: sysNotification.id, type: sysNotification.type })
					.from(sysNotification)
					.where(eq(sysNotification.dedupe_key, key))
					.limit(1);
				if (existing) {
					output.push({
						recipientId,
						status: existing.type === "task.reminder.cooldown" ? "cooldown" : "reused",
						notificationId: existing.type === "task.reminder.cooldown" ? null : existing.id,
					});
					continue;
				}
				const cutoff = new Date(Date.now() - REMINDER_COOLDOWN_MINUTES * 60_000);
				const [recent] = await tx
					.select({ id: sysNotification.id })
					.from(sysNotification)
					.innerJoin(sysNotificationDelivery, eq(sysNotificationDelivery.notification_id, sysNotification.id))
					.where(
						and(
							eq(sysNotification.source_type, "task_reminder"),
							eq(sysNotification.source_id, task.id),
							eq(sysNotification.type, "task.reminder.manual"),
							eq(sysNotificationDelivery.recipient_id, recipientId),
							gte(sysNotification.created_at, cutoff),
						),
					)
					.limit(1);
				if (recent) {
					// 持久记录跳过结果，使同一个请求即使在冷却结束后重放也不会意外发送。
					await tx.insert(sysNotification).values({
						id: newId(),
						type: "task.reminder.cooldown",
						source_type: "task_reminder",
						source_id: task.id,
						title: "任务提醒已跳过",
						dedupe_key: key,
						operator_id: me.id,
						created_at: new Date(),
					});
					output.push({ recipientId, status: "cooldown", notificationId: null });
					continue;
				}
				const user = users.get(recipientId);
				if (!user) throw new TRPCError({ code: "BAD_REQUEST" });
				const id = await createNotification(tx, {
					type: "task.reminder.manual",
					source: { type: "task_reminder", id: task.id },
					title: `任务提醒：${task.name}`,
					content: "请及时查看并处理任务。",
					path: taskPathOf(task.id),
					operatorId: me.id,
					dedupeKey: key,
					allowMissingTargets: true,
					recipients: input.channels.map((channel) => ({
						userId: recipientId,
						channel,
						target: targetOf(channel, user),
					})),
				});
				created.push({ id, recipientId });
				output.push({ recipientId, status: "sent", notificationId: id });
			}
			return output;
		});
		if (input.channels.includes("in_app"))
			for (const item of created) publishNotice([item.recipientId], { id: item.id });
		return { results };
	}),
	/**
	 * **即将发生的计划内提醒**(待发的排期)。
	 *
	 * 详情页「任务提醒」右上角那个图标悬停时看它:排期本身不在记录列表里展示(内部行为),
	 * 但用户需要能一眼预览"接下来会在什么时候、提醒谁、哪种提醒"。
	 */
	taskReminderSchedulePreview: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.taskId);
		if (!(await canRemind(task, me))) throw new TRPCError({ code: "FORBIDDEN", message: "无权查看任务提醒计划" });
		// 已到点但 worker 尚未处理的不算“即将发生”。
		const upcoming = await pendingRemindersOf(db, task.id, Date.now());
		const head = upcoming.slice(0, PLAN_PREVIEW_LIMIT);
		const ids = [...new Set(head.map((row) => row.recipient_id))];
		const names = await nameMapOf(ids);
		return {
			/** 待发总数(只算未来的) */
			total: upcoming.length,
			items: head.map((row) => ({
				id: row.id,
				reminder: reminderKindOf(row.kind),
				scheduledAt: row.scheduled_at.toISOString(),
				recipientName: names.get(row.recipient_id) ?? UNKNOWN_USER_LABEL,
				channels: channelsOf(row.channels),
			})),
			/** 最后一次的时刻(只给前几条容易让人误判) */
			last: upcoming.at(-1)?.scheduled_at.toISOString() ?? null,
		};
	}),

	/**
	 * 提醒记录 = **计划**(接下来几条待发的排期) + **已送达/投递中**的投递记录。
	 *
	 * 两边都带 `kind` 区分,前端给「计划 / 已送达」标识:
	 *   · `planned` —— 还没到点的排期(只列**最近 3 条**,否则"每天一次 × 90 天"会把列表刷满;
	 *     完整计划看右上角那个预览图标)。**不会**被标成"已发送",避免误以为已经提醒过了;
	 *   · `delivery` —— 真正投递过的:即时提醒 / 节点催办 / 到点发出的定时提醒,状态取投递行
	 *     (已送达 / 待投递 / 投递中 / 投递失败)。
	 */
	reminderHistory: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.taskId);
		if (!(await canRemind(task, me))) throw new TRPCError({ code: "FORBIDDEN", message: "无权查看任务提醒记录" });
		const admin = await isAdminOf(me);
		const actions = await db
			.select({ id: taskActionTable.id })
			.from(taskActionTable)
			.where(eq(taskActionTable.task_id, task.id));
		const scheduled = await db
			.select({ id: taskReminderTable.id })
			.from(taskReminderTable)
			.where(eq(taskReminderTable.task_id, task.id));
		const filters = [
			and(
				eq(sysNotification.source_type, "task_reminder"),
				eq(sysNotification.source_id, task.id),
				eq(sysNotification.type, "task.reminder.manual"),
			),
		];
		if (actions.length)
			filters.push(
				and(
					eq(sysNotification.source_type, "task_action"),
					inArray(
						sysNotification.source_id,
						actions.map((a) => a.id),
					),
					eq(sysNotification.type, "action.unviewed"),
				),
			);
		if (scheduled.length)
			filters.push(
				and(
					eq(sysNotification.source_type, "task_scheduled_reminder"),
					inArray(
						sysNotification.source_id,
						scheduled.map((entry) => entry.id),
					),
				),
			);
		// 计划:接下来还没到点的排期(升序,只给最近几条)
		const upcoming = await pendingRemindersOf(db, task.id, Date.now());
		const plannedRows = upcoming.slice(0, HISTORY_PLAN_LIMIT);
		const events = await db
			.select()
			.from(sysNotification)
			.where(or(...filters))
			.orderBy(desc(sysNotification.created_at))
			.limit(HISTORY_LIMIT);
		if (!events.length && plannedRows.length === 0) return { planned: [], records: [], plannedTotal: 0 };
		const deliveries = await db
			.select()
			.from(sysNotificationDelivery)
			.where(
				inArray(
					sysNotificationDelivery.notification_id,
					events.map((e) => e.id),
				),
			);
		const eventById = new Map(events.map((event) => [event.id, event]));
		const ids = [
			...new Set(
				[
					...events.map((e) => e.operator_id ?? ""),
					...deliveries.map((d) => d.recipient_id),
					...plannedRows.map((row) => row.recipient_id),
				].filter(Boolean),
			),
		];
		const names = await nameMapOf(ids);
		const planned = plannedRows.map((row) => ({
			kind: "planned" as const,
			id: row.id,
			/** 截止提醒 / 节点未查看提醒 */
			reminder: reminderKindOf(row.kind),
			scheduledAt: row.scheduled_at.toISOString(),
			recipientId: row.recipient_id,
			recipientName: names.get(row.recipient_id) ?? UNKNOWN_USER_LABEL,
			channels: channelsOf(row.channels),
		}));
		const records = deliveries.map((delivery) => {
			const event = eventById.get(delivery.notification_id);
			const sender = event?.operator_id ?? "";
			const error = redactDeliveryError(delivery.last_error, admin);
			return {
				kind: "delivery" as const,
				id: delivery.id,
				senderId: sender,
				senderName: names.get(sender) ?? "系统",
				recipientId: delivery.recipient_id,
				recipientName: names.get(delivery.recipient_id) ?? UNKNOWN_USER_LABEL,
				channel: delivery.channel,
				status: delivery.status,
				error,
				createdAt: delivery.created_at.toISOString(),
			};
		});
		// 先「计划」(升序:最近的在前),再历史(投递行本来就是倒序)
		return { planned, records, plannedTotal: upcoming.length };
	}),
});
