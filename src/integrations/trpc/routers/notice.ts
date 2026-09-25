import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysNotice } from "#/db/data-base-schema";
import { createTRPCRouter, currentUserOf, protectedProcedure } from "#/integrations/trpc/init";
import { notifyMany } from "#/lib/notice";

/**
 * 站内通知(**只碰自己的**)。
 *
 * 三个过程的 `user_id` **一律取 `ctx.user.id`**(由 `protectedProcedure` 的中间件注入),
 * 从不接受前端传来的用户 id —— 所以"看别人的通知 / 改别人的已读"在 SQL 层就不可能。
 *
 * 列表与未读数**一次请求返回**(铃铛就这两样东西,没必要两个往返);
 * 默认只取最近 10 条 —— 面板里就展示这么多,要更多再加"所有通知"页。
 */
const noticeOut = (row: typeof sysNotice.$inferSelect) => ({
	id: row.id,
	title: row.title,
	body: row.body,
	path: row.path,
	level: row.level,
	read: row.read_at !== null,
	createTime: row.create_time ? row.create_time.toISOString() : null,
});

export const noticeRouter = createTRPCRouter({
	/**
	 * 我的通知 + 未读数(**一次请求给全铃铛要的两样东西**)。
	 *
	 * `limit`:铃铛不传(只要最近 10 条);「我的通知」整页传 500(与其它台账页同口径 ——
	 * 拉回来在客户端分页)。上限 500 是防止有人一次把几万条拖下来。
	 */
	list: protectedProcedure
		.input(z.object({ limit: z.number().int().min(1).max(500).default(10) }).optional())
		.query(async ({ ctx, input }) => {
			const me = currentUserOf(ctx);
			const items = await db
				.select()
				.from(sysNotice)
				.where(eq(sysNotice.user_id, me.id))
				.orderBy(desc(sysNotice.create_time))
				.limit(input?.limit ?? 10);
			const unreadRows = await db
				.select({ id: sysNotice.id })
				.from(sysNotice)
				.where(and(eq(sysNotice.user_id, me.id), isNull(sysNotice.read_at)));
			return { items: items.map(noticeOut), unread: unreadRows.length };
		}),

	/** 标记一条已读(只有我的那条会变) */
	read: protectedProcedure.input(z.object({ id: z.string().max(32) })).mutation(async ({ ctx, input }) => {
		const me = currentUserOf(ctx);
		await db
			.update(sysNotice)
			.set({ read_at: new Date() })
			.where(and(eq(sysNotice.id, input.id), eq(sysNotice.user_id, me.id), isNull(sysNotice.read_at)));
		return { ok: true };
	}),

	/**
	 * 手动发通知(**需要 `sys:notice:add`**,由 `lib/rbac.ts` 的 `PERM_BY_PATH` 强制)。
	 *
	 * 给管理员一个界面入口用:选人(可多选)→ 写标题/正文 → 可选跳转路径与级别。
	 * 复用 `notifyMany` —— 一条通知一个收件人,所以群发就是多插几行。
	 */
	create: protectedProcedure
		.input(
			z.object({
				userIds: z.array(z.string().max(32)).min(1, "至少要选一个收件人"),
				title: z.string().min(1, "标题不能为空").max(128),
				body: z.string().max(255).optional(),
				path: z.string().max(255).optional(),
				level: z.enum(["info", "success", "warn", "danger"]).default("info"),
			}),
		)
		.mutation(async ({ input }) => {
			await notifyMany(input.userIds, {
				title: input.title,
				body: input.body,
				path: input.path,
				level: input.level,
			});
			return { created: input.userIds.length };
		}),

	/** 全部已读 */
	readAll: protectedProcedure.mutation(async ({ ctx }) => {
		const me = currentUserOf(ctx);
		const rows = await db
			.select({ id: sysNotice.id })
			.from(sysNotice)
			.where(and(eq(sysNotice.user_id, me.id), isNull(sysNotice.read_at)));
		if (rows.length > 0) {
			await db
				.update(sysNotice)
				.set({ read_at: new Date() })
				.where(and(eq(sysNotice.user_id, me.id), isNull(sysNotice.read_at)));
		}
		return { updated: rows.length };
	}),
});
