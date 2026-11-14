import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import {
	sysNotification,
	sysNotificationDelivery,
	sysUser,
	taskActionTable,
	taskCommentTable,
	taskMemberTable,
	taskTable,
} from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { cancelPendingNotifications, createNotification } from "#/lib/notification";
import { alive } from "#/lib/soft-delete";
import { publish } from "#/lib/sse-bus";
import { TASK_URGE_COOLDOWN_MINUTES, taskPathOf } from "#/lib/task/close-spec";
import { cancelActionReminders, rescheduleTaskReminders, scheduleNodeReminders } from "#/lib/task/scheduled-reminders";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	activateNextAction,
	assertAttachments,
	cancelLiveTaskActions,
	createMentionNotifications,
	getTaskRow,
	ID,
	isLocked,
	LIVE_ACTION_STATUS,
	lockAction,
	lockTask,
	memberRolesOf,
	publishMentions,
	whoAllows,
	workflowOf,
	writeTaskEvent,
} from "./common";

export const taskActionRouter = createTRPCRouter({
	// ────────────────────────────── 动作 ──────────────────────────────

	/**
	 * 侧边栏「我的任务」的**红点计数** —— 只数**未读的站内任务通知**
	 * (@提及 / "轮到你了"这类,路径都指向 `/task-close/{id}`);标已读的那一下就是消红点的那一下 ——
	 * 动作本身的待办在「我的任务」页里自己看得见,不再给徽标双记账。
	 *
	 * 它是**外壳级**读口(每个页面都在用,只哨登录,登记在 `UNMAPPED_QUERIES` 类别 1);
	 * 侧边栏 30s 轮询 + SSE(`notice.new`)一起喂它,新通知秒亮、已读秒消。
	 */
	menuBadge: protectedProcedure.query(async ({ ctx }) => {
		const me = requireCurrentUser(ctx);
		const [taskNotices] = await db
			.select({ n: count() })
			.from(sysNotificationDelivery)
			.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
			.where(
				and(
					eq(sysNotificationDelivery.recipient_id, me.id),
					eq(sysNotificationDelivery.channel, "in_app"),
					eq(sysNotificationDelivery.status, "sent"),
					isNull(sysNotificationDelivery.read_at),
					or(eq(sysNotification.source_type, "task"), eq(sysNotification.source_type, "task_action")),
				),
			);
		return { count: Number(taskNotices?.n ?? 0) };
	}),

	/**
	 * 发起动作 —— 审批(`toStatus` 有值)和征询(`toStatus` 为空)是同一张表的同一种模式。
	 *
	 * 派生规则(文档「状态机推进」):
	 *  · 首节点:`from_status = 当前任务状态`,`root_action_id = 自己 id`,`sequence = 0`;
	 *    `toStatus` 有值 → `is_locking = 1` 并锁定状态转移;`toStatus` 为空 → `is_locking = 0`(不锁、不动状态);
	 *  · 后续节点继承根 ID,按串行或并行规则激活。
	 *
	 * 权限:`toStatus` 有值 → 走快照里 `via='action'` 的边 + `who` 判定;为空 → 创建者 / 参与者 / 执行者任一。
	 */
	actionCreate: protectedProcedure
		.input(
			z.strictObject({
				taskId: ID,
				toStatus: z.string().min(1).max(32).nullish(),
				assigneeId: z.string().min(1).max(191),
				nextAssigneeIds: z.array(z.string().min(1).max(36)).max(49).optional(),
				flowMode: z.enum(["serial", "parallel"]).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const nextAssigneeIds = input.nextAssigneeIds ?? [];
			const assigneeIds = [input.assigneeId, ...nextAssigneeIds];
			if (new Set(assigneeIds).size !== assigneeIds.length)
				throw new TRPCError({ code: "BAD_REQUEST", message: "处理人不能重复" });
			const id = newId();
			const now = new Date();
			const isAdmin = await isAdminUser(me.id);
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);

				const toStatus = input.toStatus ?? null;
				if (!toStatus && workflowOf(task).statuses.some((status) => status.value === task.status && status.terminal))
					throw new TRPCError({ code: "BAD_REQUEST", message: "任务已结束，不能发起征询" });
				if (toStatus && (await isLocked(task.id, tx))) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "有未完成的审批动作,任务被锁定" });
				}
				if (toStatus) {
					const workflow = workflowOf(task);
					if (!workflow.statuses?.some((status) => status.value === toStatus)) {
						throw new TRPCError({ code: "BAD_REQUEST", message: `状态图里没有状态:${toStatus}` });
					}
					const edge = (workflow.edges ?? []).find(
						(item) => item.from === task.status && item.to === toStatus && item.via === "action",
					);
					if (!edge) {
						throw new TRPCError({ code: "BAD_REQUEST", message: `没有 ${task.status} → ${toStatus} 的审批边` });
					}
					if (!isAdmin && !(await whoAllows(task, me.id, edge.who ?? [], undefined, tx))) {
						throw new TRPCError({ code: "FORBIDDEN", message: "你没有权限发起这次状态变更" });
					}
				} else if (!isAdmin && (await memberRolesOf(task.id, me.id, tx)).length === 0 && task.creator_id !== me.id) {
					throw new TRPCError({ code: "FORBIDDEN", message: "只有创建者 / 参与者 / 执行者能发起征询" });
				}
				const taskMembers = await tx
					.select({ userId: taskMemberTable.user_id })
					.from(taskMemberTable)
					.where(eq(taskMemberTable.task_id, task.id));
				const allowedAssignees = new Set([task.creator_id, ...taskMembers.map((member) => member.userId)]);
				if (assigneeIds.some((assigneeId) => !allowedAssignees.has(assigneeId)))
					throw new TRPCError({ code: "BAD_REQUEST", message: "处理人必须是任务创建人或成员" });
				const users = await tx
					.select({ id: sysUser.id })
					.from(sysUser)
					.where(and(inArray(sysUser.id, assigneeIds), alive(sysUser)))
					.for("update");
				if (users.length !== assigneeIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "处理人不存在" });

				const isLocking = toStatus !== null;
				const notifyAssignee = (actionId: string, userId: string) =>
					createNotification(tx, {
						type: "action.assigned",
						source: { type: "task_action", id: actionId },
						title: `轮到你:${task.name}`,
						content: `${me.name || "有人"} ${isLocking ? "发起审批" : "征询了你"} —— 到「我的任务」查看`,
						payload: { path: taskPathOf(task.id), level: "info", actionId },
						dedupeKey: `action.assigned:${actionId}`,
						recipients: [{ userId, channel: "in_app" }],
					});
				await tx.insert(taskActionTable).values({
					id,
					task_id: task.id,
					root_action_id: id,
					parent_action_id: null,
					is_locking: isLocking,
					from_status: task.status,
					to_status: toStatus,
					sequence: 0,
					creator_id: me.id,
					assignee_id: input.assigneeId,
					status: "active",
					activated_at: now,
					created_at: now,
					updated_at: now,
				});
				await scheduleNodeReminders(tx, task, { id, assignee_id: input.assigneeId, activated_at: now }, now);
				let predecessor = id;
				for (const [index, assigneeId] of nextAssigneeIds.entries()) {
					const nextId = newId();
					const parallel = input.flowMode === "parallel";
					await tx.insert(taskActionTable).values({
						id: nextId,
						task_id: task.id,
						root_action_id: id,
						parent_action_id: parallel ? id : predecessor,
						is_locking: isLocking,
						from_status: null,
						to_status: null,
						sequence: index + 1,
						creator_id: me.id,
						assignee_id: assigneeId,
						status: parallel ? "active" : "queued",
						activated_at: parallel ? now : null,
						created_at: now,
						updated_at: now,
					});
					if (parallel) {
						await scheduleNodeReminders(tx, task, { id: nextId, assignee_id: assigneeId, activated_at: now }, now);
						await notifyAssignee(nextId, assigneeId);
					}
					predecessor = nextId;
				}
				await notifyAssignee(id, input.assigneeId);
				await writeTaskEvent(tx, {
					taskId: task.id,
					event: "action.create",
					actor: me,
					// 创建动作不改变任务状态
					fromStatus: null,
					toStatus: null,
					targetId: id,
					detail: {
						// 「这次想去哪」:审批是目标状态,征询是 null —— 不要拿 to_status 兼职
						intendedTo: toStatus,
						intendedFrom: isLocking ? task.status : null,
						assigneeId: input.assigneeId,
						isLocking,
					},
					at: now,
				});
			});
			publish({ channel: `notice:${input.assigneeId}`, name: "notice.new", data: { actionId: id } });
			if (input.flowMode === "parallel") publishMentions(nextAssigneeIds);
			return { id };
		}),

	/** 创建一次催办；条件更新同时保证冷却和多请求竞争安全。 */
	actionUrge: protectedProcedure
		.input(
			z.object({
				id: ID,
				requestId: z.string().min(1).max(32),
				channels: z
					.array(z.enum(["sms", "email"]))
					.min(1)
					.max(2),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const [row] = await db
				.select({ action: taskActionTable, task: taskTable, user: sysUser })
				.from(taskActionTable)
				.innerJoin(taskTable, eq(taskTable.id, taskActionTable.task_id))
				.innerJoin(sysUser, eq(sysUser.id, taskActionTable.assignee_id))
				.where(and(eq(taskActionTable.id, input.id), alive(taskTable), alive(sysUser)))
				.limit(1);
			if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "动作或处理人不存在" });
			if (
				me.id !== row.action.creator_id &&
				me.id !== row.task.creator_id &&
				!(await isAdminUser(me.id, me.isSuper === true))
			) {
				throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人、动作发起人或管理员可以催办" });
			}
			const key = `action.urged:${createHash("sha256")
				.update(JSON.stringify([input.id, input.requestId]))
				.digest("hex")}`;
			const existing = async () => {
				const [hit] = await db
					.select({ id: sysNotification.id, sourceId: sysNotification.source_id })
					.from(sysNotification)
					.where(eq(sysNotification.dedupe_key, key))
					.limit(1);
				return hit;
			};
			const previous = await existing();
			if (previous) {
				if (previous.sourceId !== input.id) throw new TRPCError({ code: "CONFLICT", message: "催办请求编号已使用" });
				return { id: previous.id, reused: true };
			}
			const channels = [...new Set(input.channels)];
			if (channels.includes("sms") && (!row.user.phone || !/^\+?[0-9][0-9 -]{5,30}$/.test(row.user.phone))) {
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "处理人未配置有效的联系电话" });
			}
			if (channels.includes("email") && !z.string().email().safeParse(row.user.email).success) {
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "处理人未配置有效的邮箱" });
			}
			const now = new Date();
			const cutoff = new Date(now.getTime() - TASK_URGE_COOLDOWN_MINUTES * 60_000);
			const id = await db.transaction(async (tx) => {
				const updated = await tx
					.update(taskActionTable)
					.set({ last_urged_at: now })
					.where(
						and(
							eq(taskActionTable.id, input.id),
							eq(taskActionTable.status, "active"),
							eq(taskActionTable.assignee_id, row.user.id),
							or(isNull(taskActionTable.last_urged_at), lte(taskActionTable.last_urged_at, cutoff)),
						),
					);
				if (updated[0].affectedRows !== 1) return null;
				return createNotification(tx, {
					type: "action.urged",
					source: { type: "task_action", id: input.id },
					title: `任务催办：${row.task.name}`,
					content: "您有一项待处理的审批或征询，请及时查看。",
					payload: { path: taskPathOf(row.task.id), actionId: input.id, operatorId: me.id },
					dedupeKey: key,
					recipients: channels.map((channel) => ({
						userId: row.user.id,
						channel,
						target: channel === "sms" ? row.user.phone : row.user.email,
					})),
				});
			});
			if (!id) {
				const raced = await existing();
				if (raced && raced.sourceId === input.id) return { id: raced.id, reused: true };
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "动作已结束或仍在 30 分钟催办冷却期" });
			}
			return { id, reused: false };
		}),

	/** 催办记录只向该动作发起人、任务创建人及管理员开放。 */
	actionUrgeHistory: protectedProcedure.input(z.object({ id: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const [row] = await db
			.select({ action: taskActionTable, task: taskTable })
			.from(taskActionTable)
			.innerJoin(taskTable, eq(taskTable.id, taskActionTable.task_id))
			.where(and(eq(taskActionTable.id, input.id), alive(taskTable)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "动作不存在" });
		if (
			me.id !== row.action.creator_id &&
			me.id !== row.task.creator_id &&
			!(await isAdminUser(me.id, me.isSuper === true))
		) {
			throw new TRPCError({ code: "FORBIDDEN", message: "没有权限查看催办记录" });
		}
		const events = await db
			.select()
			.from(sysNotification)
			.where(
				and(
					eq(sysNotification.source_type, "task_action"),
					eq(sysNotification.source_id, input.id),
					eq(sysNotification.type, "action.urged"),
				),
			)
			.orderBy(desc(sysNotification.created_at))
			.limit(100);
		const ids = events.map((event) => event.id);
		if (!ids.length) return [];
		const deliveries = await db
			.select()
			.from(sysNotificationDelivery)
			.where(inArray(sysNotificationDelivery.notification_id, ids))
			.orderBy(desc(sysNotificationDelivery.created_at));
		const admin = await isAdminUser(me.id, me.isSuper === true);
		return deliveries.map((delivery) => ({
			id: delivery.id,
			channel: delivery.channel,
			status: delivery.status,
			attempts: delivery.attempts,
			error: admin ? delivery.last_error : delivery.last_error ? "投递失败，请联系管理员" : null,
			createdAt: delivery.created_at.toISOString(),
			sentAt: delivery.sent_at?.toISOString() ?? null,
		}));
	}),

	/** 发起人或管理员撤回动作，审批会取消整条流程的未处理动作。 */
	actionWithdraw: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const admin = await isAdminUser(me.id, me.isSuper === true);
		await db.transaction(async (tx) => {
			const { task, action } = await lockAction(tx, input.id);
			if (!admin && action.creator_id !== me.id && task.creator_id !== me.id)
				throw new TRPCError({ code: "FORBIDDEN", message: "只有动作发起人、任务创建人或管理员可以撤回" });
			if (!(LIVE_ACTION_STATUS as readonly string[]).includes(action.status))
				throw new TRPCError({ code: "BAD_REQUEST", message: "该动作已结束" });
			const chain = await tx
				.select()
				.from(taskActionTable)
				.where(and(eq(taskActionTable.task_id, task.id), eq(taskActionTable.root_action_id, action.root_action_id)))
				.for("update");
			const cancelled = new Set(action.is_locking ? chain.map((item) => item.id) : [action.id]);
			let changed = true;
			while (changed) {
				changed = false;
				for (const item of chain)
					if (item.parent_action_id && cancelled.has(item.parent_action_id) && !cancelled.has(item.id)) {
						cancelled.add(item.id);
						changed = true;
					}
			}
			const ids = [...cancelled];
			const now = new Date();
			await tx
				.update(taskActionTable)
				.set({ status: "cancelled", updated_at: now })
				.where(and(inArray(taskActionTable.id, ids), inArray(taskActionTable.status, [...LIVE_ACTION_STATUS])));
			await cancelPendingNotifications(tx, "task_action", ids);
			await cancelActionReminders(tx, ids, now);
			await writeTaskEvent(tx, {
				taskId: task.id,
				event: "action.withdraw",
				actor: me,
				targetId: action.id,
				fromStatus: null,
				toStatus: null,
				detail: { cancelled: ids.length },
				at: now,
			});
		});
		return { ok: true };
	}),

	/** 查看指定动作仅记录处理人首次打开的时间，与站内通知已读无关。 */
	actionView: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const [action] = await db.select().from(taskActionTable).where(eq(taskActionTable.id, input.id)).limit(1);
		if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "动作不存在" });
		if (action.assignee_id !== me.id) throw new TRPCError({ code: "FORBIDDEN", message: "只有处理人可以查看该动作" });
		if (action.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "该动作已不在待处理状态" });
		await getTaskRow(action.task_id);
		await db.transaction(async (tx) => {
			await lockTask(tx, action.task_id);
			const now = new Date();
			await tx
				.update(taskActionTable)
				.set({ viewed_at: now })
				.where(
					and(
						eq(taskActionTable.id, input.id),
						eq(taskActionTable.assignee_id, me.id),
						eq(taskActionTable.status, "active"),
						isNull(taskActionTable.viewed_at),
					),
				);
			await cancelActionReminders(tx, [action.id], new Date());
		});
		return { ok: true };
	}),

	/**
	 * 答复动作 —— 只有 `assignee_id` 本人能答。
	 *
	 * 结算:审批全部通过后任务转根节点的 `to_status`;驳回后保持原状态(文档「状态机推进」)。
	 * 锁顺序与 `taskTransit` 一致(先 `tc_task` 再 `tc_action`),避免互相等锁。
	 */
	actionRespond: protectedProcedure
		.input(z.object({ id: ID, approved: z.boolean(), reason: z.string().max(2000).nullish() }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			let nextAssigneeId: string | null = null;
			await db.transaction(async (tx) => {
				const { task, action } = await lockAction(tx, input.id);
				if (action.assignee_id !== me.id) {
					throw new TRPCError({ code: "FORBIDDEN", message: "只有指派人能答复这个动作" });
				}
				if (!action.is_locking) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "征询必须填写意见回复" });
				}
				if (action.status !== "active") {
					throw new TRPCError({ code: "BAD_REQUEST", message: "这个动作已经答复过了" });
				}
				// 驳回**必须写原因**;原因直接以**评论**留档(复用评论流,和普通评论一起看),不另造一张"驳回意见"表
				const reason = input.reason?.trim();
				if (!input.approved && !reason) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "驳回要填写原因" });
				}
				if (input.approved && action.is_locking) {
					const [root] = await tx
						.select()
						.from(taskActionTable)
						.where(eq(taskActionTable.id, action.root_action_id))
						.limit(1)
						.for("update");
					const edge = workflowOf(task).edges.find(
						(item) => item.from === root?.from_status && item.to === root?.to_status && item.via === "action",
					);
					if (!root || !edge || task.status !== root.from_status)
						throw new TRPCError({ code: "BAD_REQUEST", message: "任务未满足流程条件，无法通过审批" });
				}

				await tx
					.update(taskActionTable)
					.set({ status: input.approved ? "done" : "rejected", updated_at: new Date() })
					.where(eq(taskActionTable.id, action.id));
				await cancelPendingNotifications(tx, "task_action", [action.id]);
				await cancelActionReminders(tx, [action.id], new Date());

				// 通过 / 驳回的意见都落成评论(有就写一条;通过的意见是可选的)
				if (reason) {
					await tx.insert(taskCommentTable).values({
						id: newId(),
						task_id: task.id,
						author_id: me.id,
						content: `${input.approved ? "通过意见" : "驳回原因"}:${reason}`,
						created_at: new Date(),
						updated_at: new Date(),
					});
				}

				const now = new Date();
				const nextAction = input.approved ? await activateNextAction(tx, task, action, now) : null;
				nextAssigneeId = nextAction?.assignee_id ?? null;
				// 审批默认全员通过；任一拒绝立即回退并取消剩余节点。
				let movedTo: string | null = null;
				if (action.is_locking) {
					const [root] = await tx
						.select()
						.from(taskActionTable)
						.where(and(eq(taskActionTable.id, action.root_action_id), eq(taskActionTable.task_id, task.id)))
						.limit(1)
						.for("update");
					if (!root || !root.is_locking)
						throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "审批流程缺少根节点" });
					if (!input.approved) {
						const pending = await tx
							.select({ id: taskActionTable.id })
							.from(taskActionTable)
							.where(
								and(
									eq(taskActionTable.task_id, task.id),
									eq(taskActionTable.root_action_id, action.root_action_id),
									inArray(taskActionTable.status, [...LIVE_ACTION_STATUS]),
								),
							)
							.for("update");
						if (pending.length) {
							const ids = pending.map((item) => item.id);
							await tx
								.update(taskActionTable)
								.set({ status: "cancelled", updated_at: now })
								.where(inArray(taskActionTable.id, ids));
							await cancelPendingNotifications(tx, "task_action", ids);
							await cancelActionReminders(tx, ids, now);
						}
					}
					const [remaining] = await tx
						.select({ id: taskActionTable.id })
						.from(taskActionTable)
						.where(
							and(
								eq(taskActionTable.task_id, task.id),
								eq(taskActionTable.root_action_id, action.root_action_id),
								eq(taskActionTable.is_locking, true),
								inArray(taskActionTable.status, [...LIVE_ACTION_STATUS]),
							),
						)
						.limit(1)
						.for("update");
					const next = input.approved ? (remaining ? null : root.to_status) : root.from_status;
					if (next && next !== task.status) {
						if (workflowOf(task).statuses.some((status) => status.value === next && status.terminal))
							await cancelLiveTaskActions(tx, task.id, now);
						await tx.update(taskTable).set({ status: next, updated_at: now }).where(eq(taskTable.id, task.id));
						if (
							workflowOf(task).statuses.some(
								(status) => (status.value === task.status || status.value === next) && status.terminal,
							)
						)
							await rescheduleTaskReminders(tx, { ...task, status: next }, now);
						movedTo = next;
					}
				}
				await writeTaskEvent(tx, {
					taskId: task.id,
					event: "action.respond",
					actor: me,
					// 仅在全部通过并推进任务时填写状态列
					fromStatus: movedTo ? task.status : null,
					toStatus: movedTo,
					targetId: action.id,
					detail: {
						approved: input.approved,
						// 驳回原因同时落了条评论(评论流要看);这里再存一份是给活动流直接渲染用
						reason: reason ?? null,
						actionStatus: input.approved ? "done" : "rejected",
						nextActionId: nextAction?.id ?? null,
					},
					at: now,
				});
			});
			if (nextAssigneeId) publishMentions([nextAssigneeId]);
			return { ok: true };
		}),

	/**
	 * **回复征询** —— 征询是「征意见」,不是审批:不需要通过 / 驳回,
	 * 指派人给一条意见(**可带附件**)即算处理完毕;意见直接以**一条评论**进讨论流
	 * (与驳回原因同一做法:复用评论流,不另造一张"意见"表)。
	 *
	 * 与 `actionRespond` 的差异:不区分 approve / reject、不碰任务状态(任务该锁还锁、该开还开)、
	 * 不写 reason 强校验(空内容直接拒,不需要"必须驳回才填"的绕弯)。
	 */
	actionReply: protectedProcedure
		.input(
			z.object({
				id: ID,
				content: z.string().min(1, "回复内容不能为空").max(5000),
				attachments: z.array(z.string().min(1).max(32)).max(20).optional(),
				mentionIds: z.array(z.string().min(1).max(36)).max(100).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			let receivers: string[] = [];
			await db.transaction(async (tx) => {
				const { task, action } = await lockAction(tx, input.id);
				if (action.assignee_id !== me.id) {
					throw new TRPCError({ code: "FORBIDDEN", message: "只有被征询的人能回复" });
				}
				if (action.is_locking) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "审批必须通过或驳回" });
				}
				if (action.status !== "active") {
					throw new TRPCError({ code: "BAD_REQUEST", message: "这个征询已经回复过了" });
				}
				const content = input.content.trim();
				if (!content) throw new TRPCError({ code: "BAD_REQUEST", message: "回复内容不能为空" });
				await assertAttachments(tx, input.attachments ?? []);
				const now = new Date();
				const commentId = newId();
				await tx
					.update(taskActionTable)
					.set({ status: "done", updated_at: now })
					.where(eq(taskActionTable.id, action.id));
				await cancelPendingNotifications(tx, "task_action", [action.id]);
				await cancelActionReminders(tx, [action.id], new Date());
				await tx.insert(taskCommentTable).values({
					id: commentId,
					task_id: action.task_id,
					author_id: me.id,
					content,
					attachments: input.attachments?.length ? input.attachments : null,
					created_at: now,
					updated_at: now,
				});
				receivers = await createMentionNotifications(tx, task, content, me, input.mentionIds ?? [], commentId);
				const nextAction = await activateNextAction(tx, task, action, now);
				if (nextAction) receivers.push(nextAction.assignee_id);
				await writeTaskEvent(tx, {
					taskId: action.task_id,
					event: "action.reply",
					actor: me,
					// target = **意见那条评论** —— 读取侧按它取摘要(excerpt),动态流直接渲染
					targetId: commentId,
					detail: {
						consultOf: action.creator_id, // 征询是谁发起的(展示:"对 甲 回复征询")
						commentId,
						nextActionId: nextAction?.id ?? null,
						attachments: input.attachments?.length ?? 0,
					},
					at: now,
				});
			});
			publishMentions(receivers);
			return { ok: true };
		}),
});
