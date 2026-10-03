import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDemoGrid } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { createTRPCRouter, protectedProcedure } from "../init";

/**
 * Demo:综合网格履职 —— 一张普通业务表(列表 / 新建 / 编辑 / 删除 / 批量指派负责人)。
 *
 * 这里是**行级数据权限(数据范围)的样板落点**:`list` 里一句 `ctx.scope()` 就把"我该看到哪些行"
 * 交给了 `sys_data_policy`(资源 / 插件登记见 `lib/rbac.ts` 的 `DATA_SCOPE_BY_PATH` 与
 * `lib/data-scope.ts`)。`town_id`(街镇)是**可以被规则引用的列** —— 规则没配时不筛,
 * 配了才按它筛;`owner_id` 只表达"这条归谁办"。
 */

const toGrid = (row: typeof sysDemoGrid.$inferSelect) => ({
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

/** 取一条网格;不存在就报 `NOT_FOUND` */
async function getRow(id: string) {
	const [row] = await db.select().from(sysDemoGrid).where(eq(sysDemoGrid.id, id)).limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这条网格不存在" });
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
	/** 列表 —— 行级数据权限的第一个(也是当前唯一一个)落点:资源 / 插件登记见 `lib/rbac.ts` */
	list: protectedProcedure.query(async ({ ctx }) => {
		/**
		 * `ctx.scope()` 的条件来自 `sys_data_policy`(按 `DATA_SCOPE_BY_PATH["demoGrid.list"]` 找到资源
		 * `demo_grid`):没配规则时是 `undefined` —— `and()` 会把 `undefined` 参数丢掉,所以"没配 = 不筛",
		 * 而不是"筛成空"。条件本身永远是参数化的 `in (…)`,不会拼字符串。
		 */
		const scope = await ctx.scope();
		const rows = await db
			.select()
			.from(sysDemoGrid)
			.where(and(scope))
			.orderBy(asc(sysDemoGrid.town_name), asc(sysDemoGrid.name));
		return rows.map(toGrid);
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

	/** 编辑 —— 需要 `sys:grid:edit` */
	update: protectedProcedure.input(writeInput.extend({ id: z.string().min(1) })).mutation(async ({ input }) => {
		await getRow(input.id);
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

	/** 删除 —— 需要 `sys:grid:remove` */
	remove: protectedProcedure.input(z.object({ ids: z.array(z.string().min(1)).min(1) })).mutation(async ({ input }) => {
		await db.delete(sysDemoGrid).where(inArray(sysDemoGrid.id, input.ids));
		return { removed: input.ids.length };
	}),

	/**
	 * **批量指派负责人** —— 需要 `sys:grid:assign`。
	 * 按街镇筛出若干条,一次指给同一个人。`owner_id` 只表达"这条归谁办",不再同步写任何授权。
	 */
	assign: protectedProcedure
		.input(z.object({ ids: z.array(z.string().min(1)).min(1), ownerId: z.string().max(32).nullable() }))
		.mutation(async ({ input }) => {
			await db
				.update(sysDemoGrid)
				.set({ owner_id: input.ownerId, update_time: new Date() })
				.where(inArray(sysDemoGrid.id, input.ids));
			return { assigned: input.ids.length };
		}),
});
