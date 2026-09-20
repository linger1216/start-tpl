/**
 * 系统参数路由 —— 「系统设置 ▸ 参数管理」。
 *
 * 只有两件事:列出参数(库里值 + 代码默认值合并)、改一个值(按类型校验)。
 * 参数影响的是**保留策略**与**定时同步开关**,所以改完要清缓存,并且明确告诉调用方"下次任务生效"。
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysConfig } from "#/db/data-base-schema";
import {
	CONFIG_DEFAULTS,
	CONFIG_VALUE_MAX,
	type ConfigType,
	clearConfigCache,
	validateConfigValue,
} from "#/lib/sys-config";
import { createTRPCRouter, publicProcedure } from "../init";

export const configRouter = createTRPCRouter({
	/** 参数清单:代码默认值 + 库里的覆盖值(库里没有的参数也列出来,否则人不知道能调什么) */
	list: publicProcedure.query(async () => {
		const rows = await db.select().from(sysConfig);
		const stored = new Map(rows.map((row) => [row.cfg_key, row]));
		const keys = [...new Set([...Object.keys(CONFIG_DEFAULTS), ...rows.map((row) => row.cfg_key)])];
		return keys
			.map((key) => {
				const fallback = CONFIG_DEFAULTS[key];
				const row = stored.get(key);
				return {
					key,
					value: row?.cfg_value ?? fallback?.value ?? "",
					defaultValue: fallback?.value ?? "",
					type: (row?.value_type ?? fallback?.type ?? "string") as ConfigType,
					group: row?.cfg_group ?? fallback?.group ?? "其它",
					remark: row?.remark ?? fallback?.remark ?? "",
					editable: Number(row?.editable ?? 1) !== 0,
					/** 库里有没有覆盖过(界面用来区分"默认值"和"已改") */
					overridden: Boolean(row),
					updatedAt: row?.update_time ? row.update_time.toISOString() : null,
				};
			})
			.sort((a, b) => (a.group === b.group ? a.key.localeCompare(b.key) : a.group.localeCompare(b.group)));
	}),

	/** 改一个参数值(upsert);按声明类型校验,不接受乱七八糟的值 */
	update: publicProcedure
		.input(z.object({ key: z.string().min(1).max(64), value: z.string().max(CONFIG_VALUE_MAX) }))
		.mutation(async ({ input }) => {
			const fallback = CONFIG_DEFAULTS[input.key];
			const [row] = await db.select().from(sysConfig).where(eq(sysConfig.cfg_key, input.key)).limit(1);
			if (row && Number(row.editable ?? 1) === 0) {
				throw new Error(`参数 ${input.key} 是代码内置的,不允许在界面上修改`);
			}
			const type = (row?.value_type ?? fallback?.type ?? "string") as ConfigType;
			const problem = validateConfigValue(type, input.value);
			if (problem) throw new Error(`${input.key}:${problem}`);
			const value = input.value.trim();
			if (row) {
				await db.update(sysConfig).set({ cfg_value: value }).where(eq(sysConfig.cfg_key, input.key));
			} else {
				await db.insert(sysConfig).values({
					cfg_key: input.key,
					cfg_value: value,
					value_type: type,
					cfg_group: fallback?.group ?? "其它",
					remark: fallback?.remark ?? "",
					editable: 1,
				});
			}
			clearConfigCache();
			return { key: input.key, value };
		}),
});
