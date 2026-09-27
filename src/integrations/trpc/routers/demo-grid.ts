import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDemoGrid } from "#/db/data-base-schema";
import { dataScopeWhere, grantRow, revokeRow, revokeRows } from "#/lib/data-policy";
import { newId } from "#/lib/ids";
import { createTRPCRouter, currentUserOf, protectedProcedure } from "../init";

/**
 * Demo:综合网格履职(行级数据权限的**真实落点**)。
 *
 * 「谁能看哪些网格」不再由角色的档位词决定,而是 `sys_data_policy` 里的**直白授权**,例如:
 *  · 区部门领导   `role:局领导 → *, *, allow`                          ⇒ 看全部 71 条
 *  · 街镇队长     `user:<队长> → demo_grid@org:<××网格组>, *, allow`   ⇒ 看本街镇一片
 *  · 街镇队员     `user:<队员> → demo_grid@<某条 id>, *, allow`(每行一条)⇒ 只看自己那几条
 *
 * ⚠️ 行级过滤认的是 **`group_id`(管理单元)**,不是 `town_id`:人挂的节点是「××网格组」,
 * 数据的归属组织也要指向同一个节点,`@org:` 才能一次对上所有街镇。
 * `town_id` / `town_name` 只用于展示、筛选、统计。
 *
 * ⚠️ **五处共用同一个范围条件**(list / update / remove / assign,以及下面的可见性校验):
 * 只在 `list` 上套范围 = 队员拿到别人的 id 照样能改能删(IDOR),那是行级权限最经典的漏洞。
 *
 * ⚠️ **指派负责人会同步写授权**(`grantRow` / `revokeRow`):`owner_id` 表达"这条归谁办",
 * 而"谁能看这一条"由策略表说了算 —— 只改前者,负责人自己就看不见自己那条了。
 */
const RESOURCE = "demo_grid";

const gridOut = (row: typeof sysDemoGrid.$inferSelect) => ({
	id: row.id,
	name: row.name,
	townName: row.town_name,
	townId: row.town_id,
	groupId: row.group_id,
	ownerName: row.owner_name,
	ownerId: row.owner_id,
	duty: row.duty,
	remark: row.remark,
	createTime: row.create_time ? row.create_time.toISOString() : null,
	updateTime: row.update_time ? row.update_time.toISOString() : null,
});

/** 取一条**我可见的**网格;不可见与不存在**一律当成"看不到"**(不泄漏"存在但无权") */
async function visibleRow(id: string, userId: string, action: "read" | "write") {
	const scope = await dataScopeWhere(userId, RESOURCE, action);
	const [row] = await db
		.select()
		.from(sysDemoGrid)
		.where(scope ? and(eq(sysDemoGrid.id, id), scope) : eq(sysDemoGrid.id, id))
		.limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这条网格不存在,或不在你的数据范围内" });
	return row;
}

const writeInput = z.object({
	name: z.string().min(1, "网格名称不能为空").max(64),
	townName: z.string().max(32).nullable().default(null),
	townId: z.string().max(32).nullable().default(null),
	groupId: z.string().max(32).nullable().default(null),
	ownerName: z.string().max(32).nullable().default(null),
	ownerId: z.string().max(32).nullable().default(null),
	duty: z.string().max(64).nullable().default(null),
	remark: z.string().max(255).nullable().default(null),
});

export const demoGridRouter = createTRPCRouter({
	/** 列表(带行级范围) */
	list: protectedProcedure.query(async ({ ctx }) => {
		const me = currentUserOf(ctx);
		const scope = await dataScopeWhere(me.id, RESOURCE, "read");
		const rows = await db
			.select()
			.from(sysDemoGrid)
			.where(scope)
			.orderBy(asc(sysDemoGrid.town_name), asc(sysDemoGrid.name));
		return rows.map(gridOut);
	}),

	/** 新建 —— 需要 `sys:grid:add`(见 `lib/rbac.ts` 的 `PERM_BY_PATH`) */
	create: protectedProcedure.input(writeInput).mutation(async ({ input }) => {
		const id = newId();
		await db.insert(sysDemoGrid).values({
			id,
			name: input.name.trim(),
			town_name: input.townName?.trim() || null,
			town_id: input.townId || null,
			group_id: input.groupId || null,
			owner_name: input.ownerName?.trim() || null,
			owner_id: input.ownerId || null,
			duty: input.duty?.trim() || null,
			remark: input.remark?.trim() || null,
			create_time: new Date(),
			update_time: new Date(),
		});
		if (input.ownerId) await grantRow(input.ownerId, RESOURCE, id);
		return { id };
	}),

	/** 编辑 —— 需要 `sys:grid:edit`;**先校验可见性**(不可见 ⇒ 看不到也改不了) */
	update: protectedProcedure.input(writeInput.extend({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		const me = currentUserOf(ctx);
		const before = await visibleRow(input.id, me.id, "write");
		await db
			.update(sysDemoGrid)
			.set({
				name: input.name.trim(),
				town_name: input.townName?.trim() || null,
				town_id: input.townId || null,
				group_id: input.groupId || null,
				owner_name: input.ownerName?.trim() || null,
				owner_id: input.ownerId || null,
				duty: input.duty?.trim() || null,
				remark: input.remark?.trim() || null,
				update_time: new Date(),
			})
			.where(eq(sysDemoGrid.id, input.id));
		// 换了负责人就得把授权一起搬过去,否则新负责人看不见、旧负责人还看得见
		if (before.owner_id !== input.ownerId) {
			if (before.owner_id) await revokeRow(before.owner_id, RESOURCE, input.id);
			if (input.ownerId) await grantRow(input.ownerId, RESOURCE, input.id);
		}
		return { ok: true };
	}),

	/** 删除 —— 需要 `sys:grid:remove`;同样**先校验可见性** */
	remove: protectedProcedure
		.input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
		.mutation(async ({ ctx, input }) => {
			const me = currentUserOf(ctx);
			for (const id of input.ids) await visibleRow(id, me.id, "write");
			await db.delete(sysDemoGrid).where(inArray(sysDemoGrid.id, input.ids));
			// 行没了,指着它的授权也一并清掉,别在策略表里留一堆指向不存在行的规则
			await revokeRows(RESOURCE, input.ids);
			return { removed: input.ids.length };
		}),

	/**
	 * **批量指派负责人** —— 需要 `sys:grid:assign`。
	 * 按街镇筛出若干条,一次指给同一个人(测试「队员只看自己的」时最省事的入口)。
	 * 同样只允许操作**自己范围内**的行;指派同时写 / 撤授权(见文件头注释)。
	 */
	assign: protectedProcedure
		.input(z.object({ ids: z.array(z.string().min(1)).min(1), ownerId: z.string().max(32).nullable() }))
		.mutation(async ({ ctx, input }) => {
			const me = currentUserOf(ctx);
			const rows: { id: string; ownerId: string | null }[] = [];
			for (const id of input.ids) {
				const row = await visibleRow(id, me.id, "write");
				rows.push({ id: row.id, ownerId: row.owner_id });
			}
			await db
				.update(sysDemoGrid)
				.set({ owner_id: input.ownerId, update_time: new Date() })
				.where(inArray(sysDemoGrid.id, input.ids));
			for (const row of rows) {
				if (row.ownerId === input.ownerId) continue;
				if (row.ownerId) await revokeRow(row.ownerId, RESOURCE, row.id);
				if (input.ownerId) await grantRow(input.ownerId, RESOURCE, row.id);
			}
			return { assigned: input.ids.length };
		}),
});
