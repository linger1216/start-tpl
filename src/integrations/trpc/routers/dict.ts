/**
 * 系统字典路由 —— 读 `sys_dict`(全系统共用的一张字典表)。
 *
 * 一个字典一行:`id` 是字典编码(如 `entity_category`),`items` 是 `[{label,value}]`。
 * 前端统一用 `#/hooks/use-dict` 读;字典没有对应编码就回空数组(不编造候选)。
 */

import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDict } from "#/db/data-base-schema";
import { createTRPCRouter, publicProcedure } from "../init";

/** 字典项:[{label, value}];label 与 value 都必填,value 在同字典内唯一 */
const dictItems = z
	.array(
		z.object({
			label: z.string().min(1, "字典项名称不能为空").max(120),
			value: z.string().min(1, "字典项取值不能为空").max(120),
		}),
	)
	.max(200, "一个字典最多 200 项")
	.refine((items) => new Set(items.map((item) => item.value)).size === items.length, {
		message: "字典项取值(value)有重复",
	});

export const dictRouter = createTRPCRouter({
	/** 全部启用中的字典(前端按需取用;字典表很小,直接全给) */
	list: publicProcedure.query(async () => {
		// 字段管理页要能看到停用的字典(便于重新启用),所以不过滤 status —— 消费侧(useDict)自己只看启用的那些
		const rows = await db.select().from(sysDict).orderBy(asc(sysDict.id));
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			items: row.items ?? [],
			remark: row.remark ?? null,
			status: Number(row.status ?? 1),
		}));
	}),

	byId: publicProcedure.input(z.object({ id: z.string().min(1).max(64) })).query(async ({ input }) => {
		const [row] = await db.select().from(sysDict).where(eq(sysDict.id, input.id)).limit(1);
		if (!row) return null;
		return {
			id: row.id,
			name: row.name,
			items: row.items ?? [],
			remark: row.remark ?? null,
			status: Number(row.status ?? 1),
		};
	}),

	create: publicProcedure
		.input(
			z.object({
				id: z
					.string()
					.min(1, "请填写字典编码")
					.max(64)
					.regex(/^[a-z][a-z0-9_]*$/, "字典编码用小写字母/数字/下划线,且以字母开头"),
				name: z.string().min(1, "请填写字典名称").max(128),
				remark: z.string().max(255),
				items: dictItems,
			}),
		)
		.mutation(async ({ input }) => {
			const [existing] = await db.select({ id: sysDict.id }).from(sysDict).where(eq(sysDict.id, input.id)).limit(1);
			if (existing) throw new TRPCError({ code: "CONFLICT", message: `字典编码「${input.id}」已存在` });
			await db.insert(sysDict).values({
				id: input.id,
				name: input.name.trim(),
				remark: input.remark || null,
				items: input.items,
				status: 1,
			});
			return { id: input.id };
		}),

	update: publicProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1, "请填写字典名称").max(128),
				remark: z.string().max(255),
				items: dictItems,
				status: z.boolean(),
			}),
		)
		.mutation(async ({ input }) => {
			const [existing] = await db.select({ id: sysDict.id }).from(sysDict).where(eq(sysDict.id, input.id)).limit(1);
			if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "这个字典不存在(可能已被删除)" });
			await db
				.update(sysDict)
				.set({
					name: input.name.trim(),
					remark: input.remark || null,
					items: input.items,
					status: input.status ? 1 : 0,
				})
				.where(eq(sysDict.id, input.id));
			return { id: input.id };
		}),

	/**
	 * 删除字典 —— 模板未接到「谁在用这个字典」的登记处,所以**不做引用计数校验**:
	 * 真业务接回后,在这里补检查(常见引用方是治理规则的 `spec.category` 与档案写入路径)。
	 */
	delete: publicProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		const [row] = await db.select().from(sysDict).where(eq(sysDict.id, input.id)).limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这个字典不存在(可能已被删除)" });
		await db.delete(sysDict).where(eq(sysDict.id, input.id));
		return { success: true };
	}),
});
