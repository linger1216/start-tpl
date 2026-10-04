/**
 * 系统字典路由 —— 读 `sys_dict`(全系统共用的一张字典表)。
 *
 * 一个字典一行:**`code` 是业务键**(如 `entity_category`,人填、对外引用),
 * `id` 是 nanoid 主键(只用来定位行)。所以本路由的入参一律用 `code`:
 *  - `byCode` / `update` / `delete` 都收 `code`;
 *  - `create` 由调用方给 `code`,主键在服务端生成(`newId()`)。
 * 前端统一用 `#/hooks/use-dict` 读;字典没有对应编码就回空数组(不编造候选)。
 *
 * Excel 的列契约(导出表头 / 导入字段 / 摊平)在
 * `src/components/modules/settings/settings-dictionary-excel.ts` —— **一行 = 一个字典项**,
 * 导出与导入共用同一组表头,所以导出的文件能直接回导;`import` 的语义见那个过程的注释(并入、幂等)。
 */

import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDict } from "#/db/data-base-schema";
import type { ImportOutcome } from "#/lib/excel";
import { newId } from "#/lib/ids";
import { alive, softDeleted, tombstone } from "#/lib/soft-delete";
import { createTRPCRouter, protectedProcedure } from "../init";

/** 字典编码规则:小写字母/数字/下划线,字母开头 —— 与建表的唯一键口径一致 */
const DICT_CODE_RE = /^[a-z][a-z0-9_]*$/;
const dictCode = z
	.string()
	.min(1, "请填写字典编码")
	.max(64)
	.regex(DICT_CODE_RE, "字典编码用小写字母/数字/下划线,且以字母开头");

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
function toDict(row: typeof sysDict.$inferSelect) {
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

/**
 * 按编码取一行**活着**的字典(byCode / create 查重 / update 取行 / delete 都用它)。
 *
 * 为什么一律带 `alive()`:软删会把编码改写成墓碑值 `tombstone(code, id)`,`eq(code, 原值)`
 * 因此永远匹配不到已删除的行 —— 连删除过程自己也是这样(重复删除 = 查不到 = NOT_FOUND),
 * 所以不需要「带不带已删除」这种开关。
 */
async function getByCode(code: string) {
	const [row] = await db
		.select()
		.from(sysDict)
		.where(and(eq(sysDict.code, code), alive(sysDict)))
		.limit(1);
	return row ?? null;
}

export const dictRouter = createTRPCRouter({
	/** 全部字典(前端按需取用;字典表很小,直接全给) */
	list: protectedProcedure.query(async () => {
		// 字段管理页要能看到停用的字典(便于重新启用),所以不过滤 status —— 消费侧(useDict)自己只看启用的那些。
		// 但**软删**的行要过滤:它留着只是审计留痕,不该出现在「库里有这些字典」里
		const rows = await db.select().from(sysDict).where(alive(sysDict)).orderBy(asc(sysDict.code));
		return rows.map(toDict);
	}),

	/** 按**字典编码**读一个(不是按主键 —— 业务侧只认识编码) */
	byCode: protectedProcedure.input(z.object({ code: dictCode })).query(async ({ input }) => {
		const row = await getByCode(input.code);
		return row ? toDict(row) : null;
	}),

	create: protectedProcedure
		.input(
			z.object({
				code: dictCode,
				name: z.string().min(1, "请填写字典名称").max(128),
				remark: z.string().max(255),
				items: dictItems,
			}),
		)
		.mutation(async ({ input }) => {
			// 查重只看活着的行:软删字典的 `code` 已被 `tombstone()` 让位(= 有效字典只剩 `#d#…` 的墓碑),
			// 所以同一个编码删掉之后能重新建,不会给一个无解的死胡同
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

	update: protectedProcedure
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
	 *
	 * 删除是**软删**(审计留痕:谁什么时候删了哪个编码);`code` 上有唯一索引,
	 * 用 `tombstone()` 把编码改成墓碑值让位 —— 否则删掉的编码被死行永久占住,再也建不回来。
	 * 读路径(列表 / byCode / 查重 / 导入先查)必须处处带 `alive()`,漏一处就把已删除的字典又暴露出去。
	 */
	delete: protectedProcedure.input(z.object({ code: dictCode })).mutation(async ({ input }) => {
		// 查不到就 NOT_FOUND:墓碑已经把 `code` 让出去了,重复删除走的也是这条路
		const existing = await getByCode(input.code);
		if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "这个字典不存在(可能已被删除)" });
		await db
			.update(sysDict)
			.set({ ...softDeleted(), code: tombstone(existing.code, existing.id, 64) })
			.where(eq(sysDict.code, input.code));
		return { id: existing.id, code: input.code };
	}),

	/**
	 * **Excel 导入** —— 一行 = 一个字典项(`code / name / label / value / remark`),按字典编码聚合后落库。
	 *
	 * 语义是**并入**(幂等):字典已存在就补字典项、顺带更新名称与备注,**不删**任何已有的项 ——
	 * 同一份文件导两次不会把字典改小,本来就有的取值进 `duplicates` 而不是报错。
	 * 逐行错误一律回 `{ index, message }`,`index` 是**文件里的行序**(与对话框「第 N 行」对齐)。
	 */
	import: protectedProcedure
		.input(
			z.object({
				rows: z.array(z.record(z.string(), z.string())).min(1, "没有可导入的行").max(2000, "一次最多导入 2000 行"),
			}),
		)
		.mutation(async ({ input }) => {
			type Group = {
				name: string;
				remark: string;
				items: Array<{ label: string; value: string; index: number }>;
				/** 这个编码下通过校验的行号 —— 新建字典时它们都算「已导入」 */
				rows: number[];
			};
			const result: ImportOutcome = { total: input.rows.length, created: 0, errors: [], duplicates: [] };
			const groups = new Map<string, Group>();

			// 1) 先按行校验 + 按编码聚合(不碰数据库,一次把错误报全)
			input.rows.forEach((row, index) => {
				const code = (row.code ?? "").trim();
				const name = (row.name ?? "").trim();
				const label = (row.label ?? "").trim();
				const value = (row.value ?? "").trim();
				const remark = (row.remark ?? "").trim();
				if (!code) {
					result.errors.push({ index, message: "缺少「字典编码」" });
					return;
				}
				if (!DICT_CODE_RE.test(code)) {
					result.errors.push({ index, message: "「字典编码」只能用小写字母/数字/下划线,且以字母开头" });
					return;
				}
				if (!label !== !value) {
					result.errors.push({ index, message: "「字典项名称」与「字典项取值」要么都填,要么都空" });
					return;
				}
				const group = groups.get(code) ?? { name: "", remark: "", items: [], rows: [] };
				if (!group.name && name) group.name = name;
				if (!group.remark && remark) group.remark = remark;
				group.rows.push(index);
				if (label && value) {
					if (group.items.some((item) => item.value === value)) {
						// 同一个字典里取值重复:留第一行、后面的报错(与表单那侧 refine 的口径一致)
						result.errors.push({ index, message: `同一个字典里「${value}」重复` });
					} else {
						group.items.push({ label, value, index });
					}
				}
				groups.set(code, group);
			});
			if (groups.size === 0) return result;

			// 2) 一次读出涉及的字典,避免每个编码一次查询 —— 只认活着的行,已软删的编码按「没有」处理,走新建分支
			const existing = await db
				.select()
				.from(sysDict)
				.where(and(inArray(sysDict.code, [...groups.keys()]), alive(sysDict)));
			const byCode = new Map(existing.map((row) => [row.code, row]));

			// 3) 逐个落库
			for (const [code, group] of groups) {
				const current = byCode.get(code);
				if (!current) {
					if (!group.name) {
						for (const index of group.rows) {
							result.errors.push({ index, message: "新建字典必须填「字典名称」" });
						}
						continue;
					}
					await db.insert(sysDict).values({
						id: newId(),
						code,
						name: group.name,
						remark: group.remark || null,
						items: group.items.map(({ label, value }) => ({ label, value })),
						status: 1,
					});
					result.created += group.rows.length;
					continue;
				}

				const items = [...(current.items ?? [])];
				for (const item of group.items) {
					if (items.some((existingItem) => existingItem.value === item.value)) {
						result.duplicates.push({ index: item.index, message: `「${item.value}」这个取值已经有了,已跳过` });
						continue;
					}
					items.push({ label: item.label, value: item.value });
					result.created += 1;
				}
				for (const index of group.rows) {
					if (!group.items.some((item) => item.index === index)) {
						result.duplicates.push({ index, message: "字典已存在,该行没有新增字典项" });
					}
				}
				const nextName = group.name || current.name;
				const nextRemark = group.remark || current.remark;
				if (
					nextName !== current.name ||
					nextRemark !== current.remark ||
					items.length !== (current.items ?? []).length
				) {
					await db
						.update(sysDict)
						.set({ name: nextName, remark: nextRemark, items, update_time: new Date() })
						.where(eq(sysDict.code, code));
				}
			}

			// 回执按行号排一下 —— 上面是按「字典编码」分组处理的,与 Excel 的行序不一致,
			// 而对话框是按「第 N 行」逐条列的
			result.errors.sort((a, b) => a.index - b.index);
			result.duplicates.sort((a, b) => a.index - b.index);
			return result;
		}),
});
