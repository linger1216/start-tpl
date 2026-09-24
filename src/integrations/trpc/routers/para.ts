/**
 * 系统参数路由 —— 「系统设置 ▸ 参数管理」。
 *
 * 表是 **`sys_para`**(旧名 `sys_config`),主键是 `para_key`,`id` 只是普通列(nanoid,由本路由填)。
 * 四件事:列出参数(库里值 + 代码默认值合并)、读单个参数、改一个值、删一条覆盖值。
 * 类型是 **tinyint 码**(1 int / 2 bool / 3 string / 4 json),码 ↔ 名称 ↔ 校验都在 `lib/para-spec.ts`。
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysPara } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { isParaType, PARA_TYPES, PARA_VALUE_MAX, type ParaType, validateParaValue } from "#/lib/para-spec";
import { clearParaCache, PARA_DEFAULTS } from "#/lib/sys-para";
import { createTRPCRouter, publicProcedure } from "../init";

const paraTypeSchema = z
	.number()
	.int()
	.refine(isParaType, { message: `参数类型只能是 ${PARA_TYPES.join(" / ")}` })
	.transform((value) => value as ParaType);

/** 库行 → 接口出参(**只回表里真有的列** + 代码默认值的兜底) */
function toParaRow(key: string, row: typeof sysPara.$inferSelect | undefined) {
	const fallback = PARA_DEFAULTS[key];
	return {
		// 与 sys_para 的十列一一对应(界面要能看全字段);`id` 是库里的无意义短串,
		// 只在"这条参数已落库"时有值 —— 纯代码内置、还没写进库的参数是 null。
		id: row?.id ?? null,
		key,
		value: row?.para_value ?? fallback?.value ?? "",
		type: (row?.para_type ?? fallback?.type ?? 3) as ParaType,
		group: row?.para_group ?? fallback?.group ?? "其它",
		remark: row?.remark ?? fallback?.remark ?? "",
		editable: Number(row?.editable ?? 1) !== 0,
		status: Number(row?.status ?? 1),
		createdAt: row?.create_time ? row.create_time.toISOString() : null,
		updatedAt: row?.update_time ? row.update_time.toISOString() : null,
	};
}

export const paraRouter = createTRPCRouter({
	/** 参数清单:代码默认值 + 库里的覆盖值(库里没有的参数也列出来,否则人不知道能调什么) */
	list: publicProcedure.query(async () => {
		const rows = await db.select().from(sysPara);
		const stored = new Map(rows.map((row) => [row.para_key, row]));
		const keys = [...new Set([...Object.keys(PARA_DEFAULTS), ...rows.map((row) => row.para_key)])];
		return keys
			.map((key) => toParaRow(key, stored.get(key)))
			.sort((a, b) => (a.group === b.group ? a.key.localeCompare(b.key) : a.group.localeCompare(b.group)));
	}),

	/**
	 * 读**单个**参数的值(库里的覆盖值优先,没有就用代码默认值)。
	 *
	 * 给"页面需要一条界面偏好"的场景用:侧边栏只关心 `ui.sidebar.collapsed_mode`,
	 * 没必要为它拉全表。键不存在时回空串,由解析侧回落默认值。
	 */
	byKey: publicProcedure.input(z.object({ key: z.string().min(1).max(64) })).query(async ({ input }) => {
		const [row] = await db.select().from(sysPara).where(eq(sysPara.para_key, input.key)).limit(1);
		return { key: input.key, value: row?.para_value ?? PARA_DEFAULTS[input.key]?.value ?? "" };
	}),

	/** 改一个参数值(upsert);按声明类型校验,不接受乱七八糟的值 */
	update: publicProcedure
		.input(
			z.object({
				key: z.string().min(1).max(64),
				value: z.string().max(PARA_VALUE_MAX),
				/** 下面这几个都是「给了才改」—— 表单里填了别的字段,不能因为没传就把库里的值清掉 */
				group: z.string().max(32).optional(),
				remark: z.string().max(255).optional(),
				status: z.number().int().min(0).max(1).optional(),
				editable: z.number().int().min(0).max(1).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const fallback = PARA_DEFAULTS[input.key];
			const [row] = await db.select().from(sysPara).where(eq(sysPara.para_key, input.key)).limit(1);
			if (row && Number(row.editable ?? 1) === 0) {
				throw new TRPCError({ code: "FORBIDDEN", message: `参数 ${input.key} 是代码内置的,不允许在界面上修改` });
			}
			const type = (row?.para_type ?? fallback?.type ?? 3) as ParaType;
			const problem = validateParaValue(type, input.value);
			if (problem) throw new Error(`${input.key}:${problem}`);
			const value = input.value.trim();
			if (row) {
				await db
					.update(sysPara)
					.set({
						para_value: value,
						...(input.group !== undefined ? { para_group: input.group } : {}),
						...(input.remark !== undefined ? { remark: input.remark } : {}),
						...(input.status !== undefined ? { status: input.status } : {}),
						...(input.editable !== undefined ? { editable: input.editable } : {}),
						update_time: new Date(),
					})
					.where(eq(sysPara.para_key, input.key));
			} else {
				await db.insert(sysPara).values({
					// 主键是 para_key;id 是 not null 的普通列,没有默认值 —— 必须自己生成
					id: newId(),
					para_key: input.key,
					para_value: value,
					para_type: type,
					para_group: fallback?.group ?? "其它",
					remark: fallback?.remark ?? "",
					editable: 1,
				});
			}
			clearParaCache();
			return { key: input.key, value };
		}),

	/** 新增一个参数(库里没有的新键)。已存在则报错,避免和 `update` 抢活。 */
	create: publicProcedure
		.input(
			z.object({
				key: z.string().min(1, "参数名不能为空").max(64),
				value: z.string().max(PARA_VALUE_MAX),
				type: paraTypeSchema,
				/** 库里已存在的键沿用它的分组;新键可指定,缺省归到「其它」 */
				group: z.string().max(32).optional(),
				remark: z.string().max(255).optional(),
				status: z.number().int().min(0).max(1).optional(),
				editable: z.number().int().min(0).max(1).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const problem = validateParaValue(input.type, input.value);
			if (problem) throw new Error(`${input.key}:${problem}`);
			const [existing] = await db
				.select({ key: sysPara.para_key })
				.from(sysPara)
				.where(eq(sysPara.para_key, input.key))
				.limit(1);
			if (existing) throw new TRPCError({ code: "CONFLICT", message: `参数 ${input.key} 已存在,改值请走「修改」` });
			const fallback = PARA_DEFAULTS[input.key];
			await db.insert(sysPara).values({
				id: newId(),
				para_key: input.key,
				para_value: input.value.trim(),
				para_type: input.type,
				para_group: input.group ?? fallback?.group ?? "其它",
				remark: input.remark ?? fallback?.remark ?? "",
				editable: 1,
			});
			clearParaCache();
			return { key: input.key, value: input.value.trim() };
		}),

	/** 删除一个参数的库里覆盖值:代码内置的默认参数删完回到默认值,界面新建的参数删完即消失。 */
	delete: publicProcedure.input(z.object({ key: z.string().min(1).max(64) })).mutation(async ({ input }) => {
		await db.delete(sysPara).where(eq(sysPara.para_key, input.key));
		clearParaCache();
		return { key: input.key };
	}),
});
