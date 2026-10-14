/**
 * 系统参数路由 —— 「系统设置 ▸ 参数管理」。
 *
 * 表是 **`sys_para`**(旧名 `sys_config`),主键是 `para_key`,`id` 只是普通列(nanoid,由本路由填)。
 * 四件事:列出参数(库里值 + 代码默认值合并)、读单个参数、改一个值、删一条覆盖值。
 * 类型是 **tinyint 码**(1 int / 2 bool / 3 string / 4 json),码 ↔ 名称 ↔ 校验都在 `lib/para-spec.ts`。
 *
 * 另有 `import`:Excel 批量导入(upsert),列契约与摊平在
 * `src/components/modules/settings/settings-parameters-excel.ts` —— 导出与导入共用同一组表头,导出的文件能直接回导。
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysPara } from "#/db/data-base-schema";
import type { ImportResult } from "#/lib/excel";
import { newId } from "#/lib/ids";
import {
	asParaType,
	isParaType,
	PARA_TYPE,
	PARA_TYPE_META,
	PARA_TYPES,
	PARA_VALUE_MAX,
	type ParaType,
	validateParaValue,
} from "#/lib/para-spec";
import { alive, softDeleted, tombstone } from "#/lib/soft-delete";
import { clearParaCache, PARA_DEFAULTS } from "#/lib/sys-para";
import { createTRPCRouter, protectedProcedure } from "../init";

const paraTypeSchema = z
	.number()
	.int()
	.refine(isParaType, { message: `参数类型只能是 ${PARA_TYPES.join(" / ")}` })
	.transform((value) => value as ParaType);

/** 「类型」列的文本 → 类型码:导出写的是中文名(`PARA_TYPE_META.label`),这里两种写法都认;空串回 null = 沿用 */
function parseParaType(raw: string): ParaType | null {
	const text = raw.trim();
	if (text === "") return null;
	const byLabel = PARA_TYPES.find((type) => PARA_TYPE_META[type].label === text);
	if (byLabel) return byLabel;
	const code = Number(text);
	return isParaType(code) ? code : null;
}

const PARA_TYPE_HINT = PARA_TYPES.map((type) => PARA_TYPE_META[type].label).join(" / ");

/** 库行 → 接口出参(**只回表里真有的列** + 代码默认值的兜底) */
function toPara(key: string, row: typeof sysPara.$inferSelect | undefined) {
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
		createdAt: row?.created_at ? row.created_at.toISOString() : null,
		updatedAt: row?.updated_at ? row.updated_at.toISOString() : null,
	};
}

/**
 * 导入的回执 —— `ImportResult.duplicates` 是可选的,这里收窄成必填再往上赋值
 * (否则 `result.duplicates.push(...)` 报 `TS18048: 'result.duplicates' is possibly 'undefined'`)。
 */
type ImportOutcome = ImportResult & { duplicates: Array<{ index: number; message: string }> };

export const paraRouter = createTRPCRouter({
	/** 参数清单:代码默认值 + 库里的覆盖值(库里没有的参数也列出来,否则人不知道能调什么) */
	list: protectedProcedure.query(async () => {
		// 只合并**活着**的覆盖值:软删行留着是审计留痕,不能让它盖住代码默认值
		const rows = await db.select().from(sysPara).where(alive(sysPara));
		const stored = new Map(rows.map((row) => [row.para_key, row]));
		const keys = [...new Set([...Object.keys(PARA_DEFAULTS), ...rows.map((row) => row.para_key)])];
		return keys
			.map((key) => toPara(key, stored.get(key)))
			.sort((a, b) => (a.group === b.group ? a.key.localeCompare(b.key) : a.group.localeCompare(b.group)));
	}),

	/**
	 * 读**单个**参数的值(库里的覆盖值优先,没有就用代码默认值)。
	 *
	 * 给"页面需要一条界面偏好"的场景用:侧边栏只关心 `ui.sidebar.collapsed_mode`,
	 * 没必要为它拉全表。键不存在时回空串,由解析侧回落默认值。
	 */
	byKey: protectedProcedure.input(z.object({ key: z.string().min(1).max(64) })).query(async ({ input }) => {
		// 已软删的覆盖值不算数 —— 删掉覆盖值就等于回到代码默认值
		const [row] = await db
			.select()
			.from(sysPara)
			.where(and(eq(sysPara.para_key, input.key), alive(sysPara)))
			.limit(1);
		return { key: input.key, value: row?.para_value ?? PARA_DEFAULTS[input.key]?.value ?? "" };
	}),

	/** 改一个参数值(upsert);按声明类型校验,不接受乱七八糟的值 */
	update: protectedProcedure
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
			// upsert 的先查只看活着的行:已软删的 key 已被 `tombstone()` 让位(见下面 delete),这里会走插入
			const [row] = await db
				.select()
				.from(sysPara)
				.where(and(eq(sysPara.para_key, input.key), alive(sysPara)))
				.limit(1);
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
						updated_at: new Date(),
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
	create: protectedProcedure
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
				.where(and(eq(sysPara.para_key, input.key), alive(sysPara)))
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

	/**
	 * Excel 导入(一行 = 一条参数,列契约见 `settings-parameters-excel.ts`)。
	 *
	 * 语义是 **upsert**:库里没有的键按「新增」建(类型取「类型」列,空则按 `PARA_DEFAULTS` 兜底);
	 * 已有的键改值 / 分组 / 说明 / 类型(**只覆盖表里填了的字段**,空单元格不把库里的值清掉)。三条规矩:
	 *  - 代码内置(`editable = 0`)的参数一律跳过报错 —— 与「修改」同一口径,否则界面改不了、导入却能改;
	 *  - 值一律过 `validateParaValue`,类型对不上就逐行报错;
	 *  - 和库里完全一样的行进 `duplicates`(重复导入不会假装"改了一堆")。
	 */
	import: protectedProcedure
		.input(
			z.object({
				rows: z.array(z.record(z.string(), z.string())).min(1, "没有可导入的行").max(2000, "一次最多导入 2000 行"),
			}),
		)
		.mutation(async ({ input }) => {
			const result: ImportOutcome = { total: input.rows.length, created: 0, errors: [], duplicates: [] };

			// ① 逐行校验 + 去重(不碰库):同一批里同一个 key 只认第一条,后面的报错,免得"谁覆盖谁"看不出来
			const seen = new Set<string>();
			const parsed: Array<{
				key: string;
				value: string;
				type: ParaType | null;
				group: string;
				remark: string;
				index: number;
			}> = [];
			input.rows.forEach((row, index) => {
				const key = (row.key ?? "").trim();
				if (!key) {
					result.errors.push({ index, message: "缺少「参数名」" });
					return;
				}
				if (key.length > 64) {
					result.errors.push({ index, message: "「参数名」最长 64 字符" });
					return;
				}
				if (seen.has(key)) {
					result.errors.push({ index, message: `同一批里「${key}」出现了多次,只导入第一条` });
					return;
				}
				seen.add(key);
				const type = parseParaType(row.type ?? "");
				if ((row.type ?? "").trim() !== "" && type === null) {
					result.errors.push({ index, message: `「类型」只能是 ${PARA_TYPE_HINT}` });
					return;
				}
				parsed.push({
					key,
					value: row.value ?? "",
					type,
					group: (row.group ?? "").trim(),
					remark: (row.remark ?? "").trim(),
					index,
				});
			});

			// ② 一次读全已存在的行(不逐行查库)
			const stored = new Map<string, typeof sysPara.$inferSelect>();
			if (parsed.length > 0) {
				const found = await db
					.select()
					.from(sysPara)
					.where(
						and(
							inArray(
								sysPara.para_key,
								parsed.map((row) => row.key),
							),
							alive(sysPara),
						),
					);
				for (const row of found) stored.set(row.para_key, row);
			}

			// ③ 逐行落库
			let written = false;
			for (const row of parsed) {
				const existing = stored.get(row.key);
				const fallback = PARA_DEFAULTS[row.key];
				if (existing && Number(existing.editable ?? 1) === 0) {
					result.errors.push({ index: row.index, message: `参数 ${row.key} 是代码内置的,不允许在界面上修改` });
					continue;
				}
				const type = row.type ?? (existing ? asParaType(existing.para_type) : (fallback?.type ?? PARA_TYPE.STRING));
				const problem = validateParaValue(type, row.value);
				if (problem) {
					result.errors.push({ index: row.index, message: `${row.key}:${problem}` });
					continue;
				}
				const value = row.value.trim();
				if (existing) {
					const group = row.group || existing.para_group || "";
					const remark = row.remark || existing.remark || "";
					if (
						existing.para_value === value &&
						(existing.para_group ?? "") === group &&
						(existing.remark ?? "") === remark &&
						asParaType(existing.para_type) === type
					) {
						result.duplicates.push({ index: row.index, message: "和库里一样,没有改动" });
						continue;
					}
					await db
						.update(sysPara)
						.set({ para_value: value, para_type: type, para_group: group, remark, updated_at: new Date() })
						.where(eq(sysPara.para_key, row.key));
				} else {
					await db.insert(sysPara).values({
						// 主键是 para_key;id 是 not null 的普通列,没有默认值 —— 必须自己生成
						id: newId(),
						para_key: row.key,
						para_value: value,
						para_type: type,
						para_group: row.group || fallback?.group || "其它",
						remark: row.remark || fallback?.remark || "",
						editable: 1,
					});
				}
				written = true;
				result.created += 1;
			}

			// 校验分两趟跑(先整批校验、再逐行落库),回执按行号排一下 —— 对话框是按「第 N 行」逐条列的
			result.errors.sort((a, b) => a.index - b.index);
			result.duplicates.sort((a, b) => a.index - b.index);

			if (written) clearParaCache();
			return result;
		}),

	/**
	 * 删除一个参数的库里覆盖值 —— **软删**(`deleted_at` 打时间戳),不是真删。
	 *
	 * 为什么软删:删覆盖值本身是审计事件(谁把哪个开关关了),硬删之后库里什么都不剩,查不回来。
	 * 语义上「删除 = 恢复默认」:`PARA_DEFAULTS` 里的内置参数删完,`list` / `byKey` 又只剩代码默认值;
	 * `scripts/seed-paras.ts` 是「只补不覆盖」,这个 key 让位之后也能被重新插回来。
	 *
	 * `para_key` 是**主键**,软删时必须用 `tombstone()` 把它改掉(靠 UPDATE 主键让位)——
	 * 否则新行插不进同一个 key,`create` / `import` 想重建这条参数会直接撞主键。
	 * 读路径(list / byKey / 查重 / 导入先查)一律要带 `alive()`,漏一处就把删除的行又当成了覆盖值。
	 */
	remove: protectedProcedure
		.input(
			z.object({ keys: z.array(z.string().min(1).max(64)).min(1, "至少选一条参数").max(100, "一次最多删 100 条") }),
		)
		.mutation(async ({ input }) => {
			// 先按 key 查出这些行 —— 软删要拿它的 `para_key` 写墓碑(主键让位)。查询带 `alive()`:
			// 已经软删过的行不该再删一次(list 里也看不见它),所以查不到就是 NOT_FOUND。
			// **先全量校验、再写**:批量删除不允许"删了一半"(前端也不许逐条循环,见 doc/后端接口约定.md §三)
			const rows = await db
				.select()
				.from(sysPara)
				.where(and(inArray(sysPara.para_key, input.keys), alive(sysPara)));
			if (rows.length !== new Set(input.keys).size) {
				throw new TRPCError({ code: "NOT_FOUND", message: "有参数不存在(可能已被删除)" });
			}
			for (const row of rows) {
				await db
					.update(sysPara)
					.set({ ...softDeleted(), para_key: tombstone(row.para_key, row.id, 64) })
					.where(eq(sysPara.para_key, row.para_key));
			}
			clearParaCache();
			return { keys: rows.map((row) => row.para_key), removed: rows.length };
		}),
});
