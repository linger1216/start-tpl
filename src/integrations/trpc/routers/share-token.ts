/**
 * 外链访客令牌路由 —— 「用户管理 ▸ 访客管理」Tab(见 `doc/外链分享.md`)。
 *
 * 表是 **`sys_share_token`**(凭证表:**硬删**,不软删 —— 见 `lib/soft-delete.ts` 的运维表口径)。
 * 五件事:列出令牌、生成一条(服务端出随机 token)、改备注/允许页面/有效期、启停、删除。
 * 令牌命中与否的判定在 `lib/share-access.ts`;这里只管这张表自己的 CRUD,
 * 四个写口都 `clearShareTokenCache()` —— 否则改完旧令牌还能再活 30 秒(缓存见那边)。
 */
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysShareToken } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { clearShareTokenCache, newShareToken, parseStoredPaths } from "#/lib/share-access";
import { SHARE_EXPIRES_PATTERN, SHARE_PATH_MAX, SHARE_PATHS_MAX, SHARE_REMARK_MAX } from "#/lib/share-token-spec";
import { createTRPCRouter, protectedProcedure } from "../init";

const allowedPathsSchema = z
	.array(z.string().max(SHARE_PATH_MAX))
	.min(1, "至少填一条允许页面")
	.max(SHARE_PATHS_MAX, `最多 ${SHARE_PATHS_MAX} 条允许页面`)
	.refine((paths) => paths.every((p) => p.startsWith("/") && !/\s/.test(p)), {
		message: "允许页面必须是以 / 开头的路径前缀(行内不能有空白)",
	});

/** 「YYYY-MM-DD」或 null(长期有效);null 表示"清掉有效期" */
const expiresAtSchema = z.string().regex(SHARE_EXPIRES_PATTERN, "有效期要是 YYYY-MM-DD").nullable();

/** 落库成**当天 23:59:59**(本地时区):填 2027-06-30 意味着那一天整天都有效 */
function toExpiresDate(value: string | null): Date | null {
	return value ? new Date(`${value}T23:59:59`) : null;
}

export const shareTokenRouter = createTRPCRouter({
	/** 令牌清单(含令牌本体 —— 「复制链接」要随时拿得到;页面权限已收口到用户管理页) */
	list: protectedProcedure.query(async () => {
		const rows = await db.select().from(sysShareToken).orderBy(desc(sysShareToken.created_at));
		return rows.map((row) => ({
			id: row.id,
			token: row.token,
			remark: row.remark,
			allowedPaths: parseStoredPaths(row.allowed_paths),
			expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
			enabled: row.enabled === 1,
			createdAt: row.created_at ? row.created_at.toISOString() : null,
			updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
		}));
	}),

	/** 生成一条令牌:token 由服务端出(`randomBytes`),入参只描述"发给谁、看什么、到何时" */
	create: protectedProcedure
		.input(
			z.object({
				remark: z.string().max(SHARE_REMARK_MAX).default(""),
				allowedPaths: allowedPathsSchema,
				expiresAt: expiresAtSchema,
			}),
		)
		.mutation(async ({ input }) => {
			const token = newShareToken();
			const expiresAt = toExpiresDate(input.expiresAt);
			await db.insert(sysShareToken).values({
				id: newId(),
				token,
				remark: input.remark.trim(),
				allowed_paths: JSON.stringify(input.allowedPaths),
				expires_at: expiresAt,
				enabled: 1,
			});
			clearShareTokenCache();
			return { token, allowedPaths: input.allowedPaths, expiresAt: expiresAt ? expiresAt.toISOString() : null };
		}),

	/** 改备注 / 允许页面 / 有效期 —— 令牌本体不变,已发出去的外链继续有效 */
	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				remark: z.string().max(SHARE_REMARK_MAX).default(""),
				allowedPaths: allowedPathsSchema,
				expiresAt: expiresAtSchema,
			}),
		)
		.mutation(async ({ input }) => {
			const expiresAt = toExpiresDate(input.expiresAt);
			const result = await db
				.update(sysShareToken)
				.set({
					remark: input.remark.trim(),
					allowed_paths: JSON.stringify(input.allowedPaths),
					expires_at: expiresAt,
					updated_at: new Date(),
				})
				.where(eq(sysShareToken.id, input.id));
			if (result[0].affectedRows === 0) {
				throw new TRPCError({ code: "NOT_FOUND", message: "令牌不存在(可能已被删除)" });
			}
			clearShareTokenCache();
			return { id: input.id };
		}),

	/** 启停 —— 停用 = 这条外链立即失效(再启用即恢复);这就是访客的"总开关" */
	toggle: protectedProcedure
		.input(z.object({ id: z.string().min(1), enabled: z.boolean() }))
		.mutation(async ({ input }) => {
			const [row] = await db
				.select({ id: sysShareToken.id })
				.from(sysShareToken)
				.where(eq(sysShareToken.id, input.id))
				.limit(1);
			if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "令牌不存在(可能已被删除)" });
			await db
				.update(sysShareToken)
				.set({ enabled: input.enabled ? 1 : 0, updated_at: new Date() })
				.where(eq(sysShareToken.id, input.id));
			clearShareTokenCache();
			return { id: input.id, enabled: input.enabled };
		}),

	/**
	 * 删除 —— **硬删**(凭证表口径):行没了,链接立即失效且不可恢复。
	 * 留痕交给审计中间件(sys_log 记 operator + 入参快照)。
	 */
	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		const [row] = await db
			.select({ id: sysShareToken.id })
			.from(sysShareToken)
			.where(eq(sysShareToken.id, input.id))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "令牌不存在(可能已被删除)" });
		await db.delete(sysShareToken).where(eq(sysShareToken.id, input.id));
		clearShareTokenCache();
		return { id: input.id };
	}),
});
