import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDemoGrid } from "#/db/data-base-schema";
import { deptCondition, scopeOf } from "#/lib/data-scope";
import { newId } from "#/lib/ids";
import { createTRPCRouter, currentUserOf, protectedProcedure } from "../init";

/**
 * Demo:综合网格履职(行级数据权限的**第二个真实落点**)。
 *
 * 三档语义(见 `doc/rbac-权限模型.md` 与 `doc/测试数据/README.md`):
 *  · **队员**(`self`)  ⇒ `owner_id = 我` —— 「只能看自己管辖的网格」
 *  · **队长**(`up:2`)  ⇒ `town_id IN (本街镇及其下级)` —— 「看整个街镇」
 *  · **区**(`all`)     ⇒ 不过滤 —— 「看全部街镇」
 *
 * ⚠️ **四处共用同一个范围条件**(list / update / remove / assign):
 * 只在 `list` 上套范围 = 队员拿到别人的 id 照样能改能删(IDOR),那是行级权限最经典的漏洞。
 */
const gridOut = (row: typeof sysDemoGrid.$inferSelect) => ({
	id: row.id,
	name: row.name,
	townName: row.town_name,
	townId: row.town_id,
	ownerName: row.owner_name,
	ownerId: row.owner_id,
	duty: row.duty,
	remark: row.remark,
	createTime: row.create_time ? row.create_time.toISOString() : null,
	updateTime: row.update_time ? row.update_time.toISOString() : null,
});

/** 当前用户在这个表上的行级范围;`undefined` = 不过滤(全部数据) */
async function scopeWhere(userId: string): Promise<SQL | undefined> {
	const { scope, departmentIds } = await scopeOf(userId);
	if (scope === "all") return undefined;
	// self 档按负责人过滤;其余档(本部门 / 及以下 / 往上到某层)都归约成"一批部门 id"
	if (scope === "self") return eq(sysDemoGrid.owner_id, userId);
	return deptCondition(sysDemoGrid.town_id, departmentIds);
}

/** 取一条**我可见的**网格;不可见与不存在**一律当成"看不到"**(不泄漏"存在但无权") */
async function visibleRow(id: string, userId: string) {
	const scope = await scopeWhere(userId);
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
	ownerName: z.string().max(32).nullable().default(null),
	ownerId: z.string().max(32).nullable().default(null),
	duty: z.string().max(64).nullable().default(null),
	remark: z.string().max(255).nullable().default(null),
});

export const demoGridRouter = createTRPCRouter({
	/** 列表(带行级范围) */
	list: protectedProcedure.query(async ({ ctx }) => {
		const me = currentUserOf(ctx);
		const scope = await scopeWhere(me.id);
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
			owner_name: input.ownerName?.trim() || null,
			owner_id: input.ownerId || null,
			duty: input.duty?.trim() || null,
			remark: input.remark?.trim() || null,
			create_time: new Date(),
			update_time: new Date(),
		});
		return { id };
	}),

	/** 编辑 —— 需要 `sys:grid:edit`;**先校验可见性**(不可见 ⇒ 看不到也改不了) */
	update: protectedProcedure.input(writeInput.extend({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		const me = currentUserOf(ctx);
		await visibleRow(input.id, me.id);
		await db
			.update(sysDemoGrid)
			.set({
				name: input.name.trim(),
				town_name: input.townName?.trim() || null,
				town_id: input.townId || null,
				owner_name: input.ownerName?.trim() || null,
				owner_id: input.ownerId || null,
				duty: input.duty?.trim() || null,
				remark: input.remark?.trim() || null,
				update_time: new Date(),
			})
			.where(eq(sysDemoGrid.id, input.id));
		return { ok: true };
	}),

	/** 删除 —— 需要 `sys:grid:remove`;同样**先校验可见性** */
	remove: protectedProcedure
		.input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
		.mutation(async ({ ctx, input }) => {
			const me = currentUserOf(ctx);
			for (const id of input.ids) await visibleRow(id, me.id);
			await db.delete(sysDemoGrid).where(inArray(sysDemoGrid.id, input.ids));
			return { removed: input.ids.length };
		}),

	/**
	 * **批量指派负责人** —— 需要 `sys:grid:assign`。
	 * 按街镇筛出若干条,一次指给同一个人(测试「队员只看自己的」时最省事的入口)。
	 * 同样只允许操作**自己范围内**的行。
	 */
	assign: protectedProcedure
		.input(z.object({ ids: z.array(z.string().min(1)).min(1), ownerId: z.string().max(32).nullable() }))
		.mutation(async ({ ctx, input }) => {
			const me = currentUserOf(ctx);
			for (const id of input.ids) await visibleRow(id, me.id);
			await db
				.update(sysDemoGrid)
				.set({ owner_id: input.ownerId, update_time: new Date() })
				.where(inArray(sysDemoGrid.id, input.ids));
			return { assigned: input.ids.length };
		}),
});
