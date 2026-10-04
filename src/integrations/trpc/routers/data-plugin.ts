/**
 * 值域插件路由 —— 「系统设置 ▸ 数据权限 ▸ 值域插件」。
 *
 * 表是 **`sys_data_plugin`**。插件干的事只有一件:**把一个主体翻译成一串值**,数据范围规则
 * 再拿这串值去 `<列> in (…)`。
 *
 * v2 (m20034)起:**用户只能建「指定清单」(fixed)类插件**。库里存的是一份
 * `output_values json`(`[{key, value}]`),由 `toPlugin()` 直接拼进 `resolve` 的返值 —
 * 所以**加 / 改插件不用重启**,也没有「编译不过 / 超时 / globalThis」这种"任意 JS"风险了。
 *
 * 函数体(`fn` 列 / `new Function`)已删;`PLUGIN_PARAMS_MAX` 也删了(规则不再带参数)。
 * 引擎按 `output_values` 拼 SQL 的 `in (...)`,再丢到规则的 `column` 列上去比。
 *
 * 内置四个插件写在代码里(`self` / `my_departments` / `my_dept_ancestors` / `my_street`),
 * **不落库、不可改删**;`fixed` 这个内建 key 现在是兜底,真正被引用的「清单」都在表里。
 * 想用同名标识会被 `BUILTIN_PLUGIN_KEYS` 挡掉(表里真出现同名行,装载时也只会被忽略)。
 *
 * 「新增 / 改 / 删」**谁都能**(m21097)—— 这页只要 `protectedProcedure`(登了就行),
 * 与「数据范围」页同一口径。真要守权限是菜单 / 角色层的事(把「值域插件」菜单授权给谁,
 * 谁就 `enforceAny` 过得了)。
 *
 * 每一个 mutation 尾部都要 `clearPluginCache()` —— 缓存是 30 秒的,不清就得等它过期。
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDataPlugin, sysDataPolicy, sysDept, sysUser } from "#/db/data-base-schema";
import { buildPolicyCtx } from "#/lib/data-scope";
import { BUILTIN_PLUGIN_KEYS, clearPluginCache, listPlugins, testPlugin } from "#/lib/data-scope-plugins";
import { PLUGIN_ITEM_KEY_MAX, PLUGIN_ITEM_VALUE_MAX, PLUGIN_ITEMS_MAX } from "#/lib/data-scope-spec";
import { newId } from "#/lib/ids";
import { alive, softDeleted, tombstone } from "#/lib/soft-delete";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../init";

const pluginKeySchema = z
	.string()
	.trim()
	.min(1, "插件标识不能为空")
	.max(64, "插件标识最长 64 个字符")
	.regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "插件标识只能用字母、数字、下划线,且不能以数字开头");

/**
 * 输出值一行:`{ key, value }` 都是文本框可编辑的字符串(空串也接受,但保留)。
 * k / 值各自有长度上限(`PLUGIN_ITEM_KEY_MAX` / `PLUGIN_ITEM_VALUE_MAX`),整表行数上限
 * `PLUGIN_ITEMS_MAX` —— 在 zod 层就拦。
 */
const ruleItemSchema = z.object({
	key: z.string().trim().min(1, "key 不能为空").max(PLUGIN_ITEM_KEY_MAX, `key 最长 ${PLUGIN_ITEM_KEY_MAX} 个字符`),
	value: z.string().min(0).max(PLUGIN_ITEM_VALUE_MAX, `value 最长 ${PLUGIN_ITEM_VALUE_MAX} 个字符`),
});

/** 库行 → 接口出参(界面要能看到「输出值」原样,不然没法改) */
function toPluginRow(row: typeof sysDataPlugin.$inferSelect) {
	return {
		id: row.id,
		pluginKey: row.plugin_key,
		label: row.label,
		/** 表里的行**只有**这一种实现(自定义);内置那批 `impl` 为 `"builtin"` */
		impl: "fn" as const,
		/** v2 起:清单内容,引擎按 `value` 拼 SQL 的 `in (...)`,`key` 是分类标签 */
		outputValues: parseOutputValues(row.output_values),
		status: Number(row.status),
		remark: row.remark ?? "",
		createdAt: row.create_time ? row.create_time.toISOString() : null,
		updatedAt: row.update_time ? row.update_time.toISOString() : null,
	};
}

/**
 * 把库里读出来的 `output_values` 归一成 `[{key, value}]`(空 / null / 字符串 / 老形态 全部兼容)。
 * 与 `data-scope-spec.ts` 的 `parseItems()` 同款 —— 这一层只在 router 出参处走,
 * 引擎侧(`toPlugin` 已经直接读 `row.output_values`)也走 `parseItems`,结果一致。
 */
function parseOutputValues(raw: unknown): Array<{ key: string; value: string }> {
	if (raw === null || raw === undefined) return [];
	if (typeof raw === "string") {
		try {
			raw = JSON.parse(raw) as unknown;
		} catch {
			return [];
		}
	}
	if (!Array.isArray(raw)) return [];
	const out: Array<{ key: string; value: string }> = [];
	for (const item of raw) {
		if (item && typeof item === "object" && "key" in item && "value" in item) {
			const k = String((item as Record<string, unknown>).key ?? "").trim();
			const v = String((item as Record<string, unknown>).value ?? "");
			if (k && v) out.push({ key: k, value: v });
		}
	}
	return out;
}

/** 还有几条启用中的规则在用这个插件(删之前要提醒,否则那些规则会静默变成"一行也看不到") */
async function rulesUsing(pluginKey: string): Promise<number> {
	// 只数**活着**的规则:已软删的规则不参与求值,不该再拦着插件删除
	const rows = await db
		.select({ id: sysDataPolicy.id })
		.from(sysDataPolicy)
		.where(and(eq(sysDataPolicy.plugin_key, pluginKey), eq(sysDataPolicy.status, 1), alive(sysDataPolicy)));
	return rows.length;
}

export const dataPluginRouter = createTRPCRouter({
	/** 清单:内置四个(代码里,`impl: "builtin"` 那批)+ 表里的自定义行(含停用的) */
	list: protectedProcedure.query(async () => {
		// 过 `alive()`:软删的插件行留着只是审计留痕,不能再出现在「自定义插件」清单里
		const rows = await db
			.select()
			.from(sysDataPlugin)
			.where(alive(sysDataPlugin))
			.orderBy(asc(sysDataPlugin.plugin_key));
		const builtin = (await listPlugins()).filter((plugin) => plugin.impl === "builtin");
		return { builtin, custom: rows.map(toPluginRow) };
	}),

	/**
	 * 预览值域:按**当前登录人**真算一次,把取到的值原样列出来。
	 *
	 * 想换人请走系统的"切换身份",这里不另开通道 —— 预览值域的"按谁的算"始终是当前人。
	 * 一并把"按什么上下文算的"(我 / 我的角色 / 我的部门链)回出去 —— 取不到值时,管理员
	 * 得能一眼看出是"配置错了"还是"这个人恰好没有",否则只能猜。部门链里 `mine=true` 标
	 * 出"我所属的"那段(根在前),前端靠这个把上下文里"哪一段是我"渲染出来。
	 *
	 * v2 (m20034):`params` 入参去掉 —— 「输出值」是插件的属性,在 `dataPlugin.list`
	 * 返回的 `outputValues` 里;`test` 不再传任何东西,只按当前插件现状跑。
	 */
	test: protectedProcedure.input(z.object({ pluginKey: z.string().min(1) })).query(async ({ ctx, input }) => {
		// `dataPlugin.test` 不写任何东西 —— 任何登录人都能试算当前身份下的取值
		// (想换人就用系统的"切换身份",这里不另开通道)
		const me = requireCurrentUser(ctx);
		const [policyCtx, userNames] = await Promise.all([buildPolicyCtx(me.id), namesById(sysUser, [me.id])]);
		const result = await testPlugin(input.pluginKey, { ctx: policyCtx });
		// 「我的部门及以下」解名字 + 标 mine —— 跟试用页 trial 同款(见 `data-scope.ts`)。
		// 后端 `buildPolicyCtx` 只给 id 数组,前端显示需要 name + mine。
		const mineIds = new Set(policyCtx.depts.filter((d) => d.mine).map((d) => d.id));
		const descendantRows =
			policyCtx.descendants.length === 0
				? []
				: await db
						.select({ id: sysDept.id, name: sysDept.name })
						.from(sysDept)
						.where(and(inArray(sysDept.id, policyCtx.descendants), alive(sysDept)));
		return {
			pluginKey: input.pluginKey,
			userName: userNames.get(me.id) ?? me.id,
			isMe: true,
			roles: policyCtx.roles.map((role) => role.name),
			ancestors: policyCtx.depts.map((dept) => ({ name: dept.name, mine: dept.mine })),
			children: descendantRows.map((d) => ({ name: d.name, mine: mineIds.has(d.id) })),
			...result,
		};
	}),

	create: protectedProcedure
		.input(
			z.object({
				pluginKey: pluginKeySchema,
				label: z.string().trim().min(1, "名字不能为空").max(64, "名字最长 64 个字符"),
				/**
				 * 「输出值」清单(每行 `{key, value}`);v2 起新建插件**必须**给一份,
				 * zod 在 `PLUGIN_ITEMS_MAX` / `PLUGIN_ITEM_KEY_MAX` / `PLUGIN_ITEM_VALUE_MAX`
				 * 三处限住,免得用户贴一整份文件进来把 `json` 列拒死。
				 */
				outputValues: z
					.array(ruleItemSchema)
					.min(1, "「指定清单」至少要填一行")
					.max(PLUGIN_ITEMS_MAX, `输出值最多 ${PLUGIN_ITEMS_MAX} 行`),
				remark: z.string().max(255, "备注最长 255 个字符").optional(),
			}),
		)
		.mutation(async ({ input }) => {
			if (BUILTIN_PLUGIN_KEYS.includes(input.pluginKey)) {
				throw new TRPCError({ code: "CONFLICT", message: `「${input.pluginKey}」是内置插件,不能占用同名标识` });
			}
			const exists = await db
				.select({ id: sysDataPlugin.id })
				.from(sysDataPlugin)
				.where(and(eq(sysDataPlugin.plugin_key, input.pluginKey), alive(sysDataPlugin)))
				.limit(1);
			if (exists.length > 0) throw new TRPCError({ code: "CONFLICT", message: `插件标识已被占用:${input.pluginKey}` });

			const now = new Date();
			await db.insert(sysDataPlugin).values({
				id: newId(),
				plugin_key: input.pluginKey,
				label: input.label,
				output_values: input.outputValues as unknown,
				status: 1,
				remark: input.remark ?? null,
				create_time: now,
				update_time: now,
			});
			clearPluginCache();
			return { pluginKey: input.pluginKey };
		}),

	/**
	 * 改插件。**`plugin_key` 不可改** —— 规则行是拿标识引用插件的,改标识会让已有规则静默失效;
	 * 真要换标识就删了重建。
	 *
	 * v2 起 `outputValues` 是可改字段;不传 `outputValues` 表示清单不变。
	 */
	update: protectedProcedure
		.input(
			z.object({
				pluginKey: z.string().min(1),
				label: z.string().trim().min(1, "名字不能为空").max(64).optional(),
				outputValues: z
					.array(ruleItemSchema)
					.min(1, "「指定清单」至少要填一行")
					.max(PLUGIN_ITEMS_MAX, `输出值最多 ${PLUGIN_ITEMS_MAX} 行`)
					.optional(),
				status: z.number().int().min(0).max(1).optional(),
				remark: z.string().max(255).nullable().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			// 取行只看活着的:已软删的插件已经不是"这个插件"了,改不了
			const [row] = await db
				.select()
				.from(sysDataPlugin)
				.where(and(eq(sysDataPlugin.plugin_key, input.pluginKey), alive(sysDataPlugin)))
				.limit(1);
			if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `没有这个插件:${input.pluginKey}` });

			await db
				.update(sysDataPlugin)
				.set({
					...(input.label !== undefined ? { label: input.label } : {}),
					...(input.outputValues !== undefined ? { output_values: input.outputValues as unknown } : {}),
					...(input.status !== undefined ? { status: input.status } : {}),
					...(input.remark !== undefined ? { remark: input.remark } : {}),
					update_time: new Date(),
				})
				.where(eq(sysDataPlugin.plugin_key, input.pluginKey));
			clearPluginCache();
			return { pluginKey: input.pluginKey };
		}),

	/**
	 * 删插件。还有启用中的规则在用它时**默认拒绝** —— 删掉之后那些规则会静默变成"一行也看不到"
	 * (这是设计好的失败关闭,但对管理员来说很难查)。确实要删就带上 `force`。
	 *
	 * 删除是**软删**(审计留痕);`plugin_key` 上有唯一索引,用 `tombstone()` 改成墓碑值让位,
	 * 否则删掉的标识被死行永久占住,同一个 key 再也建不回来。
	 * 读路径(清单 / 改 / 查重 / `rulesUsing` 的规则统计)必须处处带 `alive()`。
	 */
	remove: protectedProcedure
		.input(z.object({ pluginKey: z.string().min(1), force: z.boolean().optional() }))
		.mutation(async ({ input }) => {
			if (BUILTIN_PLUGIN_KEYS.includes(input.pluginKey)) {
				throw new TRPCError({ code: "FORBIDDEN", message: `「${input.pluginKey}」是内置插件,不能删` });
			}
			// 这一行就是删除过程要操作的目标:`id` 与 `plugin_key` 都要拿来写墓碑(只查活着的行 —— 已经删过的不该再删)
			const [row] = await db
				.select({ id: sysDataPlugin.id, plugin_key: sysDataPlugin.plugin_key })
				.from(sysDataPlugin)
				.where(and(eq(sysDataPlugin.plugin_key, input.pluginKey), alive(sysDataPlugin)))
				.limit(1);
			if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `没有这个插件:${input.pluginKey}` });

			if (!input.force) {
				const used = await rulesUsing(input.pluginKey);
				if (used > 0) {
					throw new TRPCError({
						code: "CONFLICT",
						message: `还有 ${used} 条启用中的规则在用这个插件;删掉后它们会变成「一行也看不到」。确认要删请勾选强制删除`,
					});
				}
			}

			// 行**软删** + `plugin_key` 墓碑:唯一键让出来,同一个标识才能重新建
			await db
				.update(sysDataPlugin)
				.set({ ...softDeleted(), plugin_key: tombstone(row.plugin_key, row.id, 64) })
				.where(eq(sysDataPlugin.plugin_key, input.pluginKey));
			clearPluginCache();
			return { pluginKey: input.pluginKey, removed: true };
		}),
});

/** 一批 id → 名字(空数组直接回空表,不白跑一次 SQL) —— 与 `data-scope.ts` 同款 */
async function namesById(table: typeof sysUser, ids: string[]): Promise<Map<string, string>> {
	if (ids.length === 0) return new Map();
	// 过 `alive()`:软删的人不该再被解出名字(与 `list` / `test` 的读口径一致)
	const rows = await db
		.select({ id: table.id, name: table.name })
		.from(table)
		.where(and(inArray(table.id, ids), alive(table)));
	return new Map(rows.map((row) => [row.id, row.name]));
}
