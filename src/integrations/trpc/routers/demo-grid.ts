import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDemoGrid } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { createTRPCRouter, protectedProcedure } from "../init";

/**
 * Demo:综合网格履职 —— 一张普通业务表(列表 / 新建 / 编辑 / 删除 / 批量指派负责人)。
 *
 * 历史上这里是**行级数据权限**的演示落点:按人 / 按组织往 `sys_data_policy` 写直白授权,
 * 五处查询共用同一个范围条件。那套机制已整体删除(见 doc/已知陷阱.md),本文件回归普通 CRUD:
 * `group_id`(管理单元)/ `town_id`(街镇)现在只参与展示、筛选、统计,**不再参与任何过滤**。
 */

const toGrid = (row: typeof sysDemoGrid.$inferSelect) => ({
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
	groupId: z.string().max(32).nullable().default(null),
	ownerName: z.string().max(32).nullable().default(null),
	ownerId: z.string().max(32).nullable().default(null),
	duty: z.string().max(64).nullable().default(null),
	remark: z.string().max(255).nullable().default(null),
});

export const demoGridRouter = createTRPCRouter({
	/** 列表 */
	list: protectedProcedure.query(async () => {
		const rows = await db.select().from(sysDemoGrid).orderBy(asc(sysDemoGrid.town_name), asc(sysDemoGrid.name));
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
			group_id: input.groupId || null,
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
				group_id: input.groupId || null,
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
