import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { sysNotification, sysNotificationAttempt, sysNotificationDelivery, sysUser } from "#/db/data-base-schema";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "#/integrations/trpc/init";
import { isAdminUser, isPermissionConfigured } from "#/lib/casbin";
import { notifyMany } from "#/lib/notice";
import { alive } from "#/lib/soft-delete";

/**
 * 投递管理读的是跨用户数据(收件人姓名、渠道状态、服务商错误原文),不是自限范围。
 *
 * 权限码 `sys:notice:history` 已登记进 `PERM_BY_PATH`,正常路径由中间件拦截;
 * 这里额外兜一道**失败关闭**:权限体系未配置(库里一条 `p` 行都没有)时中间件一律放行,
 * 而这两个接口不该因此对所有人开放 —— 那种情况下只有管理员/超管能读。
 */
async function assertMayReadDelivery(user: { id: string; isSuper?: boolean } | null | undefined): Promise<void> {
	if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
	if (await isAdminUser(user.id, user.isSuper === true)) return;
	if (await isPermissionConfigured()) return; // 中间件已按 PERM_BY_PATH 判过
	throw new TRPCError({ code: "FORBIDDEN", message: "没有权限查看投递记录" });
}

function payloadOf(raw: string | null): { path: string | null; level: string } {
	try {
		const value: unknown = raw ? JSON.parse(raw) : null;
		if (value && typeof value === "object") {
			const payload = value as Record<string, unknown>;
			const path =
				typeof payload.path === "string" && /^\/(?!\/)[A-Za-z0-9\-/_.[\]]*$/.test(payload.path) ? payload.path : null;
			return { path, level: typeof payload.level === "string" ? payload.level : "info" };
		}
	} catch {
		/* 损坏的数据不影响列表 */
	}
	return { path: null, level: "info" };
}

export const noticeRouter = createTRPCRouter({
	/** 投递管理包含跨用户信息，必须具备独立权限。 */
	history: protectedProcedure
		.input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
		.query(async ({ ctx, input }) => {
			await assertMayReadDelivery(ctx.user);
			const rows = await db
				.select({ delivery: sysNotificationDelivery, notification: sysNotification, recipientName: sysUser.name })
				.from(sysNotificationDelivery)
				.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
				.leftJoin(sysUser, eq(sysUser.id, sysNotificationDelivery.recipient_id))
				.orderBy(desc(sysNotificationDelivery.created_at))
				.limit(input?.limit ?? 100);
			return rows.map(({ delivery, notification, recipientName }) => ({
				id: delivery.id,
				title: notification.title,
				recipientName,
				channel: delivery.channel,
				status: delivery.status,
				attempts: delivery.attempts,
				error: delivery.last_error,
				createdAt: delivery.created_at.toISOString(),
			}));
		}),
	attempts: protectedProcedure.input(z.object({ id: z.string().min(1).max(32) })).query(async ({ ctx, input }) => {
		await assertMayReadDelivery(ctx.user);
		const rows = await db
			.select()
			.from(sysNotificationAttempt)
			.where(eq(sysNotificationAttempt.delivery_id, input.id))
			.orderBy(desc(sysNotificationAttempt.attempt_no));
		return rows.map((row) => ({
			id: row.id,
			number: row.attempt_no,
			status: row.status,
			provider: row.provider,
			error: row.error,
			startedAt: row.started_at.toISOString(),
			finishedAt: row.finished_at?.toISOString() ?? null,
		}));
	}),
	/**
	 * 我的通知 + 未读数(**一次请求给全铃铛要的两样东西**)。
	 *
	 * `limit`:铃铛不传(只要最近 10 条);「我的通知」整页传 500(与其它台账页同口径 ——
	 * 拉回来在客户端分页)。上限 500 是防止有人一次把几万条拖下来。
	 */
	list: protectedProcedure
		.input(z.object({ limit: z.number().int().min(1).max(500).default(10) }).optional())
		.query(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const mine = and(
				eq(sysNotificationDelivery.recipient_id, me.id),
				eq(sysNotificationDelivery.channel, "in_app"),
				eq(sysNotificationDelivery.status, "sent"),
			);
			const items = await db
				.select({ delivery: sysNotificationDelivery, notification: sysNotification })
				.from(sysNotificationDelivery)
				.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
				.where(mine)
				.orderBy(desc(sysNotificationDelivery.created_at))
				.limit(input?.limit ?? 10);
			const [unread] = await db
				.select({ n: count() })
				.from(sysNotificationDelivery)
				.where(and(mine, isNull(sysNotificationDelivery.read_at)));
			return {
				items: items.map(({ delivery, notification }) => ({
					id: delivery.id,
					title: notification.title,
					body: notification.content,
					...payloadOf(notification.payload),
					read: delivery.read_at !== null,
					createTime: delivery.created_at.toISOString(),
				})),
				unread: Number(unread?.n ?? 0),
			};
		}),

	/** 标记一条已读(只有我的那条会变) */
	read: protectedProcedure.input(z.object({ id: z.string().max(32) })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		await db
			.update(sysNotificationDelivery)
			.set({ read_at: new Date() })
			.where(
				and(
					eq(sysNotificationDelivery.id, input.id),
					eq(sysNotificationDelivery.recipient_id, me.id),
					eq(sysNotificationDelivery.channel, "in_app"),
					isNull(sysNotificationDelivery.read_at),
				),
			);
		return { ok: true };
	}),

	/**
	 * 手动发通知(**需要 `sys:notice:add`**,由 `lib/rbac.ts` 的 `PERM_BY_PATH` 强制)。
	 *
	 * 给管理员一个界面入口用:选人(可多选)→ 写标题/正文 → 可选跳转路径与级别。
	 * 通知主体和所有收件人投递在一个事务中创建。
	 */
	create: protectedProcedure
		.input(
			z.object({
				// 与 `sys_user.id` 的 varchar(36) 对齐;BA 默认生成 32 位,但 uuid 配置下是 36 位
				userIds: z.array(z.string().max(36)).min(1, "至少要选一个收件人"),
				title: z.string().min(1, "标题不能为空").max(128),
				body: z.string().max(255).optional(),
				path: z.string().max(255).optional(),
				level: z.enum(["info", "success", "warn", "danger"]).default("info"),
			}),
		)
		.mutation(async ({ input }) => {
			// 收件人先验存在(活着的用户):手输 id / 传错错集合时,悄悄写成"通知里没主的收件人"最难查
			const [hit] = await db
				.select({ n: count() })
				.from(sysUser)
				.where(and(inArray(sysUser.id, input.userIds), alive(sysUser)));
			if (Number(hit?.n ?? 0) !== new Set(input.userIds).size) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "有收件人不存在(或已删除),别往不存在的人身上发通知",
				});
			}
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
		const me = requireCurrentUser(ctx);
		const rows = await db
			.select({ id: sysNotificationDelivery.id })
			.from(sysNotificationDelivery)
			.where(
				and(
					eq(sysNotificationDelivery.recipient_id, me.id),
					eq(sysNotificationDelivery.channel, "in_app"),
					isNull(sysNotificationDelivery.read_at),
				),
			);
		if (rows.length > 0) {
			await db
				.update(sysNotificationDelivery)
				.set({ read_at: new Date() })
				.where(
					and(
						eq(sysNotificationDelivery.recipient_id, me.id),
						eq(sysNotificationDelivery.channel, "in_app"),
						isNull(sysNotificationDelivery.read_at),
					),
				);
		}
		return { updated: rows.length };
	}),
});
