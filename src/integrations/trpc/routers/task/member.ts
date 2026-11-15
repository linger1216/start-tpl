import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { sysUser, taskActionTable, taskMemberTable, taskTable } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { alive } from "#/lib/soft-delete";
import { rescheduleTaskReminders } from "#/lib/task/scheduled-reminders";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	assertCanManage,
	getTaskRow,
	ID,
	isAdminOf,
	isParticipantOf,
	isTaskParticipant,
	LIVE_ACTION_STATUS,
	lockTask,
	USER_ID,
	writeTaskEvent,
	writeTaskEvents,
} from "./common";

export const taskMemberRouter = createTRPCRouter({
	// ────────────────────────────── 成员 ──────────────────────────────

	/**
	 * 加**参与者** —— **任务相关方**(创建者 / 管理员 / 当前成员)可以加;陌生人不行。
	 * 执行人不走这里:它是 `tc_task.executor_id`,建任务 / 转交时定。
	 *
	 * 为什么不是「所有登录用户」:任务列表默认对全员可见,如果谁都能写 `tc_member`,
	 * 任何人都能把自己拉进任务、伪造参与记录。
	 */
	memberAdd: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				userIds: z
					.array(USER_ID)
					.min(1)
					.refine((ids) => new Set(ids).size === ids.length, "不能重复选择成员"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const now = new Date();
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				if (!(await isTaskParticipant(task, me.id, tx)))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建者、管理员或任务成员可以做这个操作" });
				if (input.userIds.includes(task.creator_id))
					throw new TRPCError({ code: "BAD_REQUEST", message: "创建者不必进成员表(他是 tc_task.creator_id)" });
				if (task.executor_id && input.userIds.includes(task.executor_id))
					throw new TRPCError({ code: "BAD_REQUEST", message: "这个人已经是任务的执行人了" });
				const users = await tx
					.select({ id: sysUser.id })
					.from(sysUser)
					.where(and(inArray(sysUser.id, input.userIds), alive(sysUser)));
				if (users.length !== input.userIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
				const [dup] = await tx
					.select({ id: taskMemberTable.id })
					.from(taskMemberTable)
					.where(and(eq(taskMemberTable.task_id, task.id), inArray(taskMemberTable.user_id, input.userIds)))
					.limit(1);
				if (dup) throw new TRPCError({ code: "BAD_REQUEST", message: "这个人已经是任务成员了" });
				await tx.insert(taskMemberTable).values(
					input.userIds.map((userId) => ({
						id: newId(),
						task_id: task.id,
						user_id: userId,
						created_at: now,
						updated_at: now,
					})),
				);
				await writeTaskEvents(
					tx,
					input.userIds.map((userId) => ({
						taskId: task.id,
						event: "member.add" as const,
						actor: me,
						targetId: userId,
						detail: {},
						at: now,
					})),
				);
			});
			return { ok: true };
		}),

	/** 移除参与者 —— 仅创建者 / 管理员。纯关联表**真删**(与 `sys_user_dept` 同档,审计走 `sys_log`) */
	memberRemove: protectedProcedure.input(z.object({ taskId: ID, userId: USER_ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.taskId);
		await assertCanManage(task, me.id);
		const now = new Date();
		await db.transaction(async (tx) => {
			await lockTask(tx, task.id);
			const [pending] = await tx
				.select({ id: taskActionTable.id })
				.from(taskActionTable)
				.where(
					and(
						eq(taskActionTable.task_id, task.id),
						eq(taskActionTable.assignee_id, input.userId),
						inArray(taskActionTable.status, [...LIVE_ACTION_STATUS]),
					),
				)
				.limit(1);
			if (pending) throw new TRPCError({ code: "BAD_REQUEST", message: "该成员还有未完成的动作，不能移除" });
			await tx
				.delete(taskMemberTable)
				.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, input.userId)));
			await writeTaskEvent(tx, {
				taskId: task.id,
				event: "member.remove",
				actor: me,
				targetId: input.userId,
				at: now,
			});
		});
		return { ok: true };
	}),

	/**
	 * **转交**执行人 —— 把 `tc_task.executor_id` 交给同任务的另一位参与者(原子换人)。
	 *
	 * 新人成为**唯一执行人**(写入任务列);原执行人降为参与者;新执行人从成员表移除
	 * (执行人不是参与者)。能转交的:管理员,或当前执行者;目标只能是**参与者**(创建者不在成员表)。
	 */
	taskTransfer: protectedProcedure.input(z.object({ taskId: ID, userId: USER_ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const isAdmin = await isAdminOf(me);
		const now = new Date();
		await db.transaction(async (tx) => {
			const task = await lockTask(tx, input.taskId);
			if (!isAdmin && task.executor_id !== me.id) {
				throw new TRPCError({ code: "FORBIDDEN", message: "只有执行者或管理员能转交" });
			}
			if (input.userId === task.creator_id) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "不能转交给创建者(他不在成员表里)" });
			}
			// 转给当前执行人是空操作(执行人本来就不是参与者,却可能仍留着成员行 ⇒ 会写出一条 from=target 的假日志)
			if (task.executor_id && input.userId === task.executor_id) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "不能转交给当前执行人" });
			}
			if (input.userId === me.id) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "不能转交给自己" });
			}
			if (!(await isParticipantOf(task.id, input.userId, tx))) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "只能转交给这条任务的参与者" });
			}

			const fromUserId = task.executor_id;
			await tx.update(taskTable).set({ executor_id: input.userId, updated_at: now }).where(eq(taskTable.id, task.id));
			// 新执行人不再是参与者
			await tx
				.delete(taskMemberTable)
				.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, input.userId)));
			// 原执行人降为参与者(不是创建人、也不是新任时;已经在成员表里就不重复插)
			if (fromUserId && fromUserId !== input.userId && fromUserId !== task.creator_id) {
				const [exists] = await tx
					.select({ id: taskMemberTable.id })
					.from(taskMemberTable)
					.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, fromUserId)))
					.limit(1);
				if (!exists)
					await tx.insert(taskMemberTable).values({
						id: newId(),
						task_id: task.id,
						user_id: fromUserId,
						created_at: now,
						updated_at: now,
					});
			}
			await rescheduleTaskReminders(tx, { ...task, executor_id: input.userId }, now, "executor");
			await writeTaskEvent(tx, {
				taskId: task.id,
				event: "member.transfer",
				actor: me,
				targetId: input.userId,
				detail: { from: fromUserId },
				at: now,
			});
		});
		return { ok: true };
	}),
});
