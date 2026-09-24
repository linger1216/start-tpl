/**
 * 系统字典路由 —— 读 `sys_dict`(全系统共用的一张字典表)。
 *
 * 一个字典一行:**`code` 是业务键**(如 `entity_category`,人填、对外引用),
 * `id` 是 nanoid 主键(只用来定位行)。所以本路由的入参一律用 `code`:
 *  - `byCode` / `update` / `delete` 都收 `code`;
 *  - `create` 由调用方给 `code`,主键在服务端生成(`newId()`)。
 * 前端统一用 `#/hooks/use-dict` 读;字典没有对应编码就回空数组(不编造候选)。
 */

import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDict } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { createTRPCRouter, publicProcedure } from "../init";

/** 字典编码规则:小写字母/数字/下划线,字母开头 —— 与建表的唯一键口径一致 */
const dictCode = z
	.string()
	.min(1, "请填写字典编码")
	.max(64)
	.regex(/^[a-z][a-z0-9_]*$/, "字典编码用小写字母/数字/下划线,且以字母开头");

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

/** 库行 → 接口出参(nanoid 主键也回,前端列表拿它当稳定 key) */
function toDictRow(row: typeof sysDict.$inferSelect) {
	return {
		id: row.id,
		code: row.code,
		name: row.name,
		items: row.items ?? [],
		remark: row.remark ?? null,
		status: Number(row.status ?? 1),
		createTime: row.create_time ? row.create_time.toISOString() : null,
		updateTime: row.update_time ? row.update_time.toISOString() : null,
	};
}

async function getByCode(code: string) {
	const [row] = await db.select().from(sysDict).where(eq(sysDict.code, code)).limit(1);
	return row ?? null;
}

export const dictRouter = createTRPCRouter({
	/** 全部字典(前端按需取用;字典表很小,直接全给) */
	list: publicProcedure.query(async () => {
		// 字段管理页要能看到停用的字典(便于重新启用),所以不过滤 status —— 消费侧(useDict)自己只看启用的那些
		const rows = await db.select().from(sysDict).orderBy(asc(sysDict.code));
		return rows.map(toDictRow);
	}),

	/** 按**字典编码**读一个(不是按主键 —— 业务侧只认识编码) */
	byCode: publicProcedure.input(z.object({ code: dictCode })).query(async ({ input }) => {
		const row = await getByCode(input.code);
		return row ? toDictRow(row) : null;
	}),

	create: publicProcedure
		.input(
			z.object({
				code: dictCode,
				name: z.string().min(1, "请填写字典名称").max(128),
				remark: z.string().max(255),
				items: dictItems,
			}),
		)
		.mutation(async ({ input }) => {
			if (await getByCode(input.code)) {
				throw new TRPCError({ code: "CONFLICT", message: `字典编码「${input.code}」已存在` });
			}
			const id = newId(); // 主键由服务端生成,调用方只给业务键
			await db.insert(sysDict).values({
				id,
				code: input.code,
				name: input.name.trim(),
				remark: input.remark || null,
				items: input.items,
				status: 1,
			});
			return { id, code: input.code };
		}),

	update: publicProcedure
		.input(
			z.object({
				code: dictCode,
				name: z.string().min(1, "请填写字典名称").max(128),
				remark: z.string().max(255),
				items: dictItems,
				status: z.boolean(),
			}),
		)
		.mutation(async ({ input }) => {
			const existing = await getByCode(input.code);
			if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "这个字典不存在(可能已被删除)" });
			// 编码不可改:它是别人引用你的方式。要换编码 = 新建一个 + 迁调用方。
			await db
				.update(sysDict)
				.set({
					name: input.name.trim(),
					remark: input.remark || null,
					items: input.items,
					status: input.status ? 1 : 0,
					// 显式写 update_time:达梦没有 DDL 的 ON UPDATE CURRENT_TIMESTAMP
					update_time: new Date(),
				})
				.where(eq(sysDict.code, input.code));
			return { id: existing.id, code: input.code };
		}),

	/**
	 * 删除字典 —— 模板未接到「谁在用这个字典」的登记处,所以**不做引用计数校验**:
	 * 真业务接回后,在这里补检查(常见引用方是治理规则的 `spec.category` 与档案写入路径)。
	 */
	delete: publicProcedure.input(z.object({ code: dictCode })).mutation(async ({ input }) => {
		const existing = await getByCode(input.code);
		if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "这个字典不存在(可能已被删除)" });
		await db.delete(sysDict).where(eq(sysDict.code, input.code));
		return { id: existing.id, code: input.code };
	}),
});
