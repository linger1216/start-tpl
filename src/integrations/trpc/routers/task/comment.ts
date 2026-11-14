import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { sysFile, taskCommentTable, taskLogTable } from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { alive, softDeleted } from "#/lib/soft-delete";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	assertAttachments,
	assertTaskReadable,
	createMentionNotifications,
	detailOf,
	getTaskRow,
	ID,
	lockTask,
	nameMapOf,
	pageInput,
	publishMentions,
	writeTaskEvent,
} from "./common";

export const taskCommentRouter = createTRPCRouter({
	// ────────────────────────────── 评论 ──────────────────────────────

	/** 评论流 —— 附件只存了 `sys_file.id`,这里回填文件名 / 大小;已删文件直接丢掉(不留空行) */
	commentList: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ ctx, input }) => {
		await assertTaskReadable(await getTaskRow(input.taskId), requireCurrentUser(ctx).id);
		const rows = await db
			.select()
			.from(taskCommentTable)
			.where(and(eq(taskCommentTable.task_id, input.taskId), alive(taskCommentTable)))
			.orderBy(asc(taskCommentTable.created_at));

		const nameOf = await nameMapOf(rows.map((row) => row.author_id));
		const fileIds = [...new Set(rows.flatMap((row) => (row.attachments as string[] | null) ?? []))];
		const files =
			fileIds.length === 0
				? []
				: await db
						.select({
							id: sysFile.id,
							name: sysFile.origin_name,
							size: sysFile.size,
							contentType: sysFile.content_type,
						})
						.from(sysFile)
						.where(and(inArray(sysFile.id, fileIds), eq(sysFile.status, 1)));
		const fileOf = new Map(files.map((file) => [file.id, file]));

		return rows.map((row) => ({
			id: row.id,
			taskId: row.task_id,
			authorId: row.author_id,
			authorName: nameOf.get(row.author_id) ?? null,
			content: row.content,
			attachments: ((row.attachments as string[] | null) ?? [])
				.map((fileId) => fileOf.get(fileId))
				.filter((file) => file !== undefined),
			createdAt: row.created_at ? row.created_at.toISOString() : null,
		}));
	}),

	/**
	 * 任务可见者可以评论,写入与任务删除按任务行锁串行。
	 *
	 * 附件 id 在事务里先验存在(`assertAttachments`):attachmentUrl 的"挂在任务上才给 URL"
	 * 归属守卫靠这里收口 —— 不校验的话 `commentCreate([任意fileId])` 能把守卫骗开。
	 */
	commentCreate: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				content: z.string().min(1, "评论内容不能为空").max(5000),
				attachments: z.array(z.string().min(1).max(32)).max(20).optional(),
				mentionIds: z.array(z.string().min(1).max(36)).max(100).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			// zod 的 min(1) 拦不住 "   ":trim 后为空的评论等于没写,直接拒(与驳回原因同一口径)
			if (!input.content.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "评论内容不能为空" });
			const id = newId();
			const now = new Date();
			let receivers: string[] = [];
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				await assertTaskReadable(task, me.id);
				// 附件 id 先验存在(见 assertAttachments):attachmentUrl 的归属守卫依赖这里收口
				await assertAttachments(tx, input.attachments ?? []);
				await tx.insert(taskCommentTable).values({
					id,
					task_id: input.taskId,
					author_id: me.id,
					content: input.content.trim(),
					attachments: input.attachments?.length ? input.attachments : null,
					created_at: now,
					updated_at: now,
				});
				receivers = await createMentionNotifications(tx, task, input.content.trim(), me, input.mentionIds ?? [], id);
				await writeTaskEvent(tx, {
					taskId: input.taskId,
					event: "comment.create",
					actor: me,
					targetId: id,
					detail: { attachments: input.attachments?.length ?? 0 },
					at: now,
				});
			});
			publishMentions(receivers);
			return { id };
		}),

	/** 删评论(软删)—— **只有作者本人**;管理员可删任意评论(任务创建者**不**在此列) */
	commentRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const [row] = await db
			.select()
			.from(taskCommentTable)
			.where(and(eq(taskCommentTable.id, input.id), alive(taskCommentTable)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在" });
		const task = await getTaskRow(row.task_id);
		if (row.author_id !== me.id && !(await isAdminUser(me.id))) {
			throw new TRPCError({ code: "FORBIDDEN", message: "只能删除自己的评论(管理员除外)" });
		}
		await db.transaction(async (tx) => {
			await tx
				.update(taskCommentTable)
				.set({ ...softDeleted(), updated_at: new Date() })
				.where(eq(taskCommentTable.id, row.id));
			await writeTaskEvent(tx, {
				taskId: task.id,
				event: "comment.remove",
				actor: me,
				targetId: row.id,
			});
		});
		return { ok: true };
	}),

	/**
	 * 任务活动流 —— 「谁、什么时候、把什么从 A 改成 B」,按时间**倒序**分页。
	 *
	 * 与 `commentList` 同权限口径(登录 + 任务可见):任务不存在 / 已软删 ⇒ `NOT_FOUND`
	 * —— 详情页据此自动回「我的任务」(见 `task-detail-page.tsx`)。
	 *
	 * `targetName` 由**读取侧**按 `event` 决定去哪张表查(动作 → 指派人,成员 → 那个人,评论 → 不查);
	 * 是"尽力而为":查不到回退 id。`comment.*` 另给 `excerpt`(正文摘要)供活动流直接渲染。
	 */
	logList: protectedProcedure.input(z.object({ taskId: ID, ...pageInput })).query(async ({ ctx, input }) => {
		const task = await getTaskRow(input.taskId);
		await assertTaskReadable(task, requireCurrentUser(ctx).id);
		const page = input.page ?? 1;
		const pageSize = input.pageSize ?? 20;

		const [counted] = await db.select({ n: count() }).from(taskLogTable).where(eq(taskLogTable.task_id, input.taskId));
		const rows = await db
			.select()
			.from(taskLogTable)
			.where(eq(taskLogTable.task_id, input.taskId))
			// 同一毫秒撞点时用 id 兜底 —— 只为**稳定**,不表示语义(见 doc/task-close.md「活动日志」)
			.orderBy(desc(taskLogTable.created_at), desc(taskLogTable.id))
			.limit(pageSize)
			.offset((page - 1) * pageSize);

		// 要查名字的人:操作人(快照缺失时兜底)+ 各事件的主对象
		const personIds = rows.flatMap((row) => {
			const detail = detailOf(row.detail);
			const ids = [row.actor_name ? "" : row.actor_id];
			if (row.event === "member.add" || row.event === "member.remove" || row.event === "member.transfer") {
				ids.push(row.target_id ?? "");
			}
			if (row.event === "action.create" || row.event === "action.respond") {
				ids.push(typeof detail.assigneeId === "string" ? detail.assigneeId : "");
			}
			// 回复征询:展示名是**被回复的征询发起人**(「对 甲 回复征询」)
			if (row.event === "action.reply") {
				ids.push(typeof detail.consultOf === "string" ? detail.consultOf : "");
			}
			return ids.filter(Boolean);
		});
		const nameOf = await nameMapOf(personIds);

		// `action.reply` 的 target 也是**一条评论**(意见本体),摘要与 comment.* 同源
		const commentIds = rows
			.filter((row) => row.event === "comment.create" || row.event === "comment.remove" || row.event === "action.reply")
			.map((row) => row.target_id)
			.filter((id): id is string => id !== null);
		const comments =
			commentIds.length === 0
				? []
				: await db
						.select({ id: taskCommentTable.id, content: taskCommentTable.content })
						.from(taskCommentTable)
						.where(inArray(taskCommentTable.id, commentIds));
		const contentOf = new Map(comments.map((row) => [row.id, row.content]));

		return {
			items: rows.map((row) => {
				const detail = detailOf(row.detail);
				const assigneeId = typeof detail.assigneeId === "string" ? detail.assigneeId : null;
				const replyOf = typeof detail.consultOf === "string" ? detail.consultOf : null;
				const personId =
					row.event === "action.create" || row.event === "action.respond"
						? assigneeId
						: row.event === "action.reply"
							? replyOf
							: row.target_id;
				const content = row.target_id ? contentOf.get(row.target_id) : undefined;
				return {
					id: row.id,
					event: row.event,
					fromStatus: row.from_status,
					toStatus: row.to_status,
					targetId: row.target_id,
					targetName: personId ? (nameOf.get(personId) ?? personId) : null,
					actorId: row.actor_id,
					actorName: row.actor_name ?? nameOf.get(row.actor_id) ?? null,
					detail: row.detail,
					excerpt: content ? content.slice(0, 80) : null,
					createdAt: row.created_at ? row.created_at.toISOString() : null,
				};
			}),
			total: Number(counted?.n ?? 0),
		};
	}),
});
