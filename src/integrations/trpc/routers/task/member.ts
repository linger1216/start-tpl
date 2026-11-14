import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { sysUser, taskActionTable, taskMemberTable } from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { alive } from "#/lib/soft-delete";
import { rescheduleTaskReminders } from "#/lib/task/scheduled-reminders";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	assertCanManage,
	getTaskRow,
	ID,
	isTaskParticipant,
	LIVE_ACTION_STATUS,
	lockTask,
	memberRolesOf,
	ROLE_ENUM,
	writeTaskEvent,
} from "./common";

export const taskMemberRouter = createTRPCRouter({
	// ────────────────────────────── 成员 ──────────────────────────────

	/**
	 * 加参与者 / 执行者 —— **任务相关方**(创建者 / 管理员 / 当前成员)可以加;陌生人不行。
	 *
	 * 为什么不是「所有登录用户」:任务列表默认对全员可见,如果谁都能写 `tc_member`,
	 * 任何人都能把自己加成 executor 拿到提交权,或把别人拉进任务、伪造参与记录。
	 * 「全员可评论」是只写日志的旁路,与「往成员表里插行」不是一回事。
	 *
	 */
	memberAdd: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				userIds: z
					.array(z.string().min(1).max(36))
					.min(1)
					.refine((ids) => new Set(ids).size === ids.length, "不能重复选择成员"),
				role: ROLE_ENUM,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const primary = input.role === "executor";
			const now = new Date();
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				if (!(await isTaskParticipant(task, me.id, tx)))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建者、管理员或任务成员可以做这个操作" });
				if (input.userIds.includes(task.creator_id))
					throw new TRPCError({ code: "BAD_REQUEST", message: "创建者不必进成员表(他是 tc_task.creator_id)" });
				const users = await tx
					.select({ id: sysUser.id })
					.from(sysUser)
					.where(and(inArray(sysUser.id, input.userIds), alive(sysUser)));
				if (users.length !== input.userIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
				if (primary) {
					if (input.userIds.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "任务只能有一个执行人" });
					const [executor] = await tx
						.select({ id: taskMemberTable.id })
						.from(taskMemberTable)
						.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.role, "executor")))
						.limit(1);
					if (executor) throw new TRPCError({ code: "BAD_REQUEST", message: "任务已有执行人，请使用转交" });
				}
				// 去重键只到「人」为止 —— 带上 role 会允许同一人同时留 participant + executor 两行
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
						role: input.role,
						created_at: now,
						updated_at: now,
					})),
				);
				if (primary) await rescheduleTaskReminders(tx, task, now, "executor");
				for (const userId of input.userIds)
					await writeTaskEvent(tx, {
						taskId: task.id,
						event: "member.add",
						actor: me,
						targetId: userId,
						detail: { role: input.role },
						at: now,
					});
			});
			return { ok: true };
		}),

	/** 移除成员 —— 仅创建者。纯关联表**真删**(与 `sys_user_dept` 同档,审计走 `sys_log`) */
	memberRemove: protectedProcedure
		.input(z.object({ taskId: ID, userId: z.string().min(1).max(36), role: ROLE_ENUM }))
		.mutation(async ({ ctx, input }) => {
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
					.where(
						and(
							eq(taskMemberTable.task_id, task.id),
							eq(taskMemberTable.user_id, input.userId),
							eq(taskMemberTable.role, input.role),
						),
					);
				if (input.role === "executor") await rescheduleTaskReminders(tx, task, now, "executor");
				await writeTaskEvent(tx, {
					taskId: task.id,
					event: "member.remove",
					actor: me,
					targetId: input.userId,
					detail: { role: input.role },
					at: now,
				});
			});
			return { ok: true };
		}),

	/**
	 * **转交**执行人 —— 把「执行者」这个身份交给同任务里的另一位成员(原子换人)。
	 *
	 * 语义(用户约定):新人成为**唯一主执行人**;其余执行者一律降为参与者。
	 * 能转交的:管理员,或当前是执行者的成员。目标只能是**本任务的成员**
	 * (创建者不进 `tc_member`),且不能是自己。
	 *
	 * 为什么不拆成 `memberAdd` + `memberRemove` 两次调用:那是两条独立事务,中间会出现
	 * 「两个主执行人 / 一个执行人都没有」的窗口;而且执行者本人并没有 `memberRemove` 权限。
	 * `tc_member` 的 UK 是 `(task_id, user_id, role)`,所以「换角色」一律**先删行再插行**,
	 * 免得同一人留下 participant + executor 两行。
	 */
	taskTransfer: protectedProcedure
		.input(z.object({ taskId: ID, userId: z.string().min(1).max(36) }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const isAdmin = await isAdminUser(me.id);
			const now = new Date();
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				const myRoles = await memberRolesOf(task.id, me.id, tx);
				if (!isAdmin && !myRoles.includes("executor")) {
					throw new TRPCError({ code: "FORBIDDEN", message: "只有执行者或管理员能转交" });
				}
				if (input.userId === task.creator_id) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "不能转交给创建者(他不在成员表里)" });
				}
				if (input.userId === me.id) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "不能转交给自己" });
				}
				const target = await tx
					.select({ id: taskMemberTable.id })
					.from(taskMemberTable)
					.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, input.userId)));
				if (target.length === 0) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "只能转交给这条任务的成员" });
				}

				// 转交前的执行人
				const [executor] = await tx
					.select({ userId: taskMemberTable.user_id })
					.from(taskMemberTable)
					.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.role, "executor")))
					.limit(1);
				const fromUserId = executor?.userId ?? null;
				if (fromUserId && fromUserId !== input.userId)
					await tx
						.update(taskMemberTable)
						.set({ role: "participant", updated_at: now })
						.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, fromUserId)));
				await tx
					.update(taskMemberTable)
					.set({ role: "executor", updated_at: now })
					.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, input.userId)));
				await rescheduleTaskReminders(tx, task, now, "executor");
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
