import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
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
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { createNotification } from "#/lib/notification";
import { alive } from "#/lib/soft-delete";
import { publish } from "#/lib/sse-bus";
import { taskPathOf } from "#/lib/task/close-spec";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import { getTaskRow, ID, isTaskParticipant, lockTask, type TaskRow, type Tx } from "./common";

const channelsSchema = z
	.array(z.enum(["in_app", "sms", "email"]))
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
	return (await isAdminUser(user.id, user.isSuper === true)) || (await isTaskParticipant(task, user.id, reader));
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
	const ids = [...new Set([task.creator_id, ...members.map((m) => m.id), ...actions.map((a) => a.id)])];
	return reader
		.select({ id: sysUser.id, name: sysUser.name, email: sysUser.email, phone: sysUser.phone })
		.from(sysUser)
		.where(and(inArray(sysUser.id, ids), alive(sysUser)));
}

function dedupeKey(taskId: string, senderId: string, requestId: string, recipientId: string) {
	return `task.reminder:${createHash("sha256")
		.update(JSON.stringify([taskId, senderId, requestId, recipientId]))
		.digest("hex")}`;
}

function targetFor(channel: "in_app" | "sms" | "email", user: { phone: string | null; email: string }) {
	if (channel === "in_app") return null;
	if (channel === "sms") return user.phone && /^\+?[0-9][0-9 -]{5,30}$/.test(user.phone) ? user.phone : null;
	return z.string().email().safeParse(user.email).success ? user.email : null;
}

export const taskReminderRouter = createTRPCRouter({
	reminderCandidates: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.taskId);
		if (!(await canRemind(task, me))) throw new TRPCError({ code: "FORBIDDEN", message: "无权发送任务提醒" });
		return (await candidates(task)).map(({ id, name }) => ({ id, name }));
	}),
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
				const key = dedupeKey(task.id, me.id, input.requestId, recipientId);
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
				const cutoff = new Date(Date.now() - 30 * 60_000);
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
						payload: JSON.stringify({ operatorId: me.id, recipientId }),
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
					payload: { path: taskPathOf(task.id), operatorId: me.id },
					dedupeKey: key,
					allowMissingTargets: true,
					recipients: input.channels.map((channel) => ({
						userId: recipientId,
						channel,
						target: targetFor(channel, user),
					})),
				});
				created.push({ id, recipientId });
				output.push({ recipientId, status: "sent", notificationId: id });
			}
			return output;
		});
		if (input.channels.includes("in_app"))
			for (const item of created)
				publish({ channel: `notice:${item.recipientId}`, name: "notice.new", data: { id: item.id } });
		return { results };
	}),
	reminderHistory: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.taskId);
		if (!(await canRemind(task, me))) throw new TRPCError({ code: "FORBIDDEN", message: "无权查看任务提醒记录" });
		const admin = await isAdminUser(me.id, me.isSuper === true);
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
					inArray(sysNotification.type, ["action.urged", "action.unviewed"]),
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
		const events = await db
			.select()
			.from(sysNotification)
			.where(or(...filters))
			.orderBy(desc(sysNotification.created_at))
			.limit(200);
		if (!events.length) return [];
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
		const senderId = (payload: string | null) => {
			try {
				const p = JSON.parse(payload ?? "{}");
				return typeof p.operatorId === "string" ? p.operatorId : "";
			} catch {
				return "";
			}
		};
		const ids = [
			...new Set([...events.map((e) => senderId(e.payload)), ...deliveries.map((d) => d.recipient_id)].filter(Boolean)),
		];
		const names = new Map(
			(ids.length
				? await db.select({ id: sysUser.id, name: sysUser.name }).from(sysUser).where(inArray(sysUser.id, ids))
				: []
			).map((user) => [user.id, user.name]),
		);
		return deliveries.map((delivery) => {
			const event = eventById.get(delivery.notification_id);
			const sender = senderId(event?.payload ?? null);
			const error = delivery.last_error
				? admin
					? delivery.last_error
					: ["未配置有效的联系电话", "未配置有效的邮箱"].includes(delivery.last_error)
						? delivery.last_error
						: "投递失败，请联系管理员"
				: null;
			return {
				id: delivery.id,
				senderId: sender,
				senderName: names.get(sender) ?? "系统",
				recipientId: delivery.recipient_id,
				recipientName: names.get(delivery.recipient_id) ?? "已删除用户",
				channel: delivery.channel,
				status: delivery.status,
				error,
				createdAt: delivery.created_at.toISOString(),
			};
		});
	}),
});
