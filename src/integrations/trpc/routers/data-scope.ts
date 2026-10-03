/**
 * 数据范围规则路由 —— 「系统设置 ▸ 数据权限 ▸ 数据范围」。
 *
 * 表是 **`sys_data_policy`**。一条规则回答的是:"**谁**(subject)能看 **哪张表的哪些行**"。
 * 三种合法形态(判据在 `lib/data-scope-spec.ts` 的 `validatePolicyCombo()`,照它填就不会配错):
 *
 *  · 什么插件都不填         → **整类可见**(这张表的全部行);
 *  · `column` + 值插件      → `<column> in 插件(我)[value_key]` —— 值在「值域插件」里,
 *    m23422 起 `value_key` 指定"从插件输出的每行里取哪个 key"(留空 = 老规则按 `column` 推断);
 *  · 只填 `row` 插件        → `<资源表主键> in 插件(我, 资源)` —— 逐行授权那一档。
 *
 * 主体 `subject` 只存 `*` / `user:<id>` / `role:<id>` / `dept:<id>`(写法见 `parseSubject()`),
 * **不物化成员** —— 规则里没有一行是"某个人的 id 列表",请求时拿 `ctx` 现场判,
 * 所以调一个人换部门 / 换角色**不用回刷任何规则行**。
 *
 * v2 (m20034)起:这条规则**不再带输出值**。每个插件的"清单"装在 `sys_data_plugin.output_values`
 * 里;规则只引用插件 key,引擎按当前登录人算值。这样改插件的清单不会让规则"先退到草稿"。
 *
 * 四个写接口走权限点(`sys:scope:add` / `edit` / `remove`),不强制超管 —— 数据权限本身就是授给
 * "管权限的人"的活;真正只给超管的是**值域插件**(那里能写服务端代码,见 `data-plugin.ts`)。
 *
 * 每一个 mutation 尾部都要 `clearDataScopeCache()` —— 缓存 30 秒,不清就得等它过期。
 */
import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDataPolicy, sysDept, sysRole, sysUser } from "#/db/data-base-schema";
import { buildPolicyCtx, clearDataScopeCache, previewScope } from "#/lib/data-scope";
import { loadResourceMeta } from "#/lib/data-scope-meta";
import { listPlugins, loadPlugins } from "#/lib/data-scope-plugins";
import {
	DATA_SCOPE_REMARK_MAX,
	isIdent,
	POLICY_STATUS,
	parseSubject,
	SUBJECT_ALL,
	SUBJECT_KIND_META,
	SUBJECT_KINDS,
	type SubjectKind,
	validatePolicyCombo,
} from "#/lib/data-scope-spec";
import { newId } from "#/lib/ids";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../init";

/** 资源 / 列下拉用的字段清单(元数据读不到时是空的,表单允许手输 —— 达梦上没有 `database()`) */
function describeColumns(columns: { column: string; label: string; dataType: string }[] | undefined) {
	return (columns ?? []).map((item) => ({ column: item.column, label: item.label, dataType: item.dataType }));
}

export const dataScopeRouter = createTRPCRouter({
	/**
	 * 资源 + 字段下拉(**零登记表**)—— 直接读 `information_schema` 的表/列注释(`lib/data-scope-meta.ts`)。
	 *
	 * 只回**业务表**:`sys_` 开头的系统表不进下拉(m24215 后,数据范围只挂在普通业务表上;
	 * `sys_*` 是规则表的「目标」却不是它的「展示物」—— 历史规则仍可按 tag 路径解析)。
	 *
	 * 读不到元数据(达梦 / 没权限)时回空数组,表单此时允许**手输**表名 / 列名,不报错 ——
	 * 反正保存时还有 `select … limit 0` 的试跑兜底。
	 */
	resources: protectedProcedure.query(async () => {
		const meta = await loadResourceMeta();
		return [...meta.values()]
			.filter((item) => !item.table.startsWith("sys_"))
			.map((item) => ({
				table: item.table,
				label: item.label,
				pk: item.pk,
				columns: describeColumns(item.columns),
			}))
			.sort((a, b) => a.label.localeCompare(b.label, "zh"));
	}),

	/**
	 * 可选插件清单(**不带 `resolve`**,可以安全回给客户端)。
	 *
	 * 规则表单要它,而 `/settings/data-plugins` 是超管的页面 —— 所以这里重开一个查询,
	 * 走数据范围页自己的页面权限点,别让"配规则"非得多一个超管身份。
	 */
	plugins: protectedProcedure.query(async () => listPlugins()),

	/** 规则台账:库里全部规则(含停用的)+ 把主体 / 资源 / 插件翻译成人能看的名字 */
	list: protectedProcedure.query(async () => {
		const rows = await db.select().from(sysDataPolicy).orderBy(asc(sysDataPolicy.resource), asc(sysDataPolicy.subject));

		const roleIds = rows.map((row) => subjectIdOf(row.subject, "role")).filter((id): id is string => Boolean(id));
		const deptIds = rows.map((row) => subjectIdOf(row.subject, "dept")).filter((id): id is string => Boolean(id));
		const userIds = rows.map((row) => subjectIdOf(row.subject, "user")).filter((id): id is string => Boolean(id));
		const meta = await loadResourceMeta();
		const plugins = await loadPlugins();

		const roleNames = await namesById(sysRole, roleIds);
		const deptNames = await namesById(sysDept, deptIds);
		const userNames = await namesById(sysUser, userIds);

		return rows.map((row) => {
			const resource = meta.get(row.resource);
			const plugin = row.plugin_key ? plugins.get(row.plugin_key) : undefined;
			return {
				id: row.id,
				status: Number(row.status),
				subject: row.subject,
				subjectLabel: subjectLabel(row.subject, { roleNames, deptNames, userNames }),
				resource: row.resource,
				resourceLabel: resource?.label ?? row.resource,
				column: row.column ?? null,
				columnLabel: resource?.columns.find((item) => item.column === row.column)?.label ?? row.column ?? null,
				valueKey: row.value_key ?? null,
				pluginKey: row.plugin_key ?? null,
				pluginLabel: plugin?.label ?? row.plugin_key ?? null,
				remark: row.remark ?? "",
				createdAt: row.create_time ? row.create_time.toISOString() : null,
				updatedAt: row.update_time ? row.update_time.toISOString() : null,
			};
		});
	}),

	/**
	 * 规则台账行内「预览」用的**唯一**试算口。
	 *
	 * 三件事一起做,少一件就只能给一个数、回答不了"为什么是这几行":
	 *  · 换人 —— 指定账号算(不传 = 我自己);
	 *  · 按**已上线**的规则算 —— 逐条规则的命中账(`rules`)说明谁命中、谁没命中;
	 *  · `ruleId` 传了就把**库里那一条**(不限状态:还没上线的正是要预览的)当成已上线规则一起算,
	 *    得到"**假如这条上线**,TA 能看到什么";
	 *  · `withRows` 再带回真实样张行。
	 *
	 * 能读这张表的人本来就有这个页面的权限点(和配规则是同一个页面),所以不算越权。
	 */
	trial: protectedProcedure
		.input(
			z.object({
				userId: z.string().min(1).max(64).optional(),
				resource: z.string().trim().min(1, "先选一张资源表").max(64),
				ruleId: z.string().min(1).max(64).optional(),
				sampleLimit: z.number().int().min(1).max(20).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const targetId = input.userId ?? me.id;
			const policyCtx = await buildPolicyCtx(targetId);

			// 被预览的规则按 id 直读、**不过滤 status** —— 要看的常常正是那条还没上线的
			let trialRow: typeof sysDataPolicy.$inferSelect | undefined;
			if (input.ruleId) {
				[trialRow] = await db.select().from(sysDataPolicy).where(eq(sysDataPolicy.id, input.ruleId)).limit(1);
				if (!trialRow) throw new TRPCError({ code: "NOT_FOUND", message: "没有这条数据范围规则" });
				if (trialRow.resource !== input.resource) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "这条规则不是这张资源表上的" });
				}
			}

			const preview = await previewScope({
				resource: input.resource,
				ctx: policyCtx,
				sampleLimit: input.sampleLimit,
				withRows: true,
				trial: trialRow
					? {
							id: trialRow.id,
							subject: trialRow.subject,
							column: trialRow.column ?? null,
							valueKey: trialRow.value_key ?? null,
							pluginKey: trialRow.plugin_key ?? null,
						}
					: undefined,
			});

			// 角色只回名字(`ctx.roles[i].name`);部门回 `{name, mine}` —— `mine=true` 那段是
			// "我**所属的**部门",链上其它节点是它的祖先(`my_dept_ancestors` 的语义)。
			// 预览弹窗要靠 `mine` 把"我自己"在链上标出来,不然后端算出了根→叶的链路,
			// 页面只能看到一长串名字,看不出"哪一段是我的"。
			// `descendants` 是「我的部门及以下」的扁平列表(我 + 子孙,去重),跟 `depts`(祖先链)对偶 —
			// 同样解名字 + 标 mine,两个预览弹窗共用一份形态。
			const mineIds = new Set(policyCtx.depts.filter((d) => d.mine).map((d) => d.id));
			const [meta, userNames, descendantRows] = await Promise.all([
				loadResourceMeta(),
				namesById(sysUser, [targetId]),
				policyCtx.descendants.length === 0
					? Promise.resolve([] as Array<{ id: string; name: string }>)
					: db
							.select({ id: sysDept.id, name: sysDept.name })
							.from(sysDept)
							.where(inArray(sysDept.id, policyCtx.descendants)),
			]);
			return {
				...preview,
				userId: targetId,
				userName: userNames.get(targetId) ?? targetId,
				isMe: targetId === me.id,
				resourceLabel: meta.get(input.resource)?.label ?? input.resource,
				roles: policyCtx.roles.map((role) => role.name),
				ancestors: policyCtx.depts.map((dept) => ({ name: dept.name, mine: dept.mine })),
				children: descendantRows.map((d) => ({ name: d.name, mine: mineIds.has(d.id) })),
				trialRule: trialRow
					? {
							id: trialRow.id,
							status: Number(trialRow.status),
							subject: trialRow.subject,
							subjectLabel: await subjectNameOf(trialRow.subject),
						}
					: null,
			};
		}),

	/**
	 * 新增规则 —— **落下来的是「启用」(status=2),不是「上线」**。
	 *
	 * 理由见 `POLICY_STATUS` 的注释:一条没预览过的规则直接生效,方向恰好是"多看见"。
	 * 落「启用」之后它还是**不进引擎**,在台账上点「预览」算一遍、确认了再点「上线」才真的生效。
	 */
	create: protectedProcedure
		.input(
			z.object({
				subject: z.string().trim().min(1, "主体不能为空").max(48),
				resource: z.string().trim().min(1, "资源不能为空").max(64),
				column: z.string().trim().max(64).nullable().optional(),
				valueKey: z.string().trim().max(64).nullable().optional(),
				pluginKey: z.string().trim().max(64).nullable().optional(),
				remark: z.string().max(DATA_SCOPE_REMARK_MAX, `备注最长 ${DATA_SCOPE_REMARK_MAX} 个字符`).optional(),
				status: z.number().int().min(0).max(2).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const shape = await checkRule(input);
			const now = new Date();
			const status = input.status ?? POLICY_STATUS.enabled;
			await db.insert(sysDataPolicy).values({
				id: shape.id,
				status,
				subject: input.subject,
				resource: input.resource,
				column: shape.column,
				value_key: shape.valueKey,
				plugin_key: shape.pluginKey,
				remark: input.remark ?? null,
				create_time: now,
				update_time: now,
			});
			clearDataScopeCache();
			return { id: shape.id };
		}),

	/**
	 * 修改规则 —— 两种调用方式,区别只在**给不给形态字段**:
	 *  · 表单保存(带 subject / resource / column / valueKey / pluginKey)⇒ 形态**真变了**的话
	 *    状态**自动退回「启用」**:改完的规则和预览过的那条已经不是一回事了,不能继续生效,
	 *    得再点「预览」算一次、再点「上线」(这就是"预览过才上线"的落点);
	 *  · 台账上的「启用 / 上线 / 停用」只传 `status`,形态不动 ⇒ **不触发**退回。
	 *
	 * 值一样就不算改(表单会把形态字段原样回发,只改一句备注不该把已上线的规则摘下来);
	 * 显式传 `status` 的优先级最高 —— 它就是"我就是要这个状态"。
	 */
	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				subject: z.string().trim().min(1).max(48).optional(),
				resource: z.string().trim().min(1).max(64).optional(),
				column: z.string().trim().max(64).nullable().optional(),
				valueKey: z.string().trim().max(64).nullable().optional(),
				pluginKey: z.string().trim().max(64).nullable().optional(),
				remark: z.string().max(DATA_SCOPE_REMARK_MAX).nullable().optional(),
				status: z.number().int().min(0).max(2).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const [row] = await db.select().from(sysDataPolicy).where(eq(sysDataPolicy.id, input.id)).limit(1);
			if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "没有这条数据范围规则" });

			// 没给的沿用旧值 —— 组合校验必须按"合并之后的形态"判,不然单独改备注会被判成缺列
			const shape = await checkRule({
				subject: input.subject ?? row.subject,
				resource: input.resource ?? row.resource,
				column: input.column === undefined ? (row.column ?? null) : input.column,
				valueKey: input.valueKey === undefined ? (row.value_key ?? null) : input.valueKey,
				pluginKey: input.pluginKey === undefined ? (row.plugin_key ?? null) : input.pluginKey,
			});

			const shapeTouched =
				(input.subject !== undefined && input.subject !== row.subject) ||
				(input.resource !== undefined && input.resource !== row.resource) ||
				(input.column !== undefined && (input.column ?? null) !== (row.column ?? null)) ||
				(input.valueKey !== undefined && (input.valueKey ?? null) !== (row.value_key ?? null)) ||
				(input.pluginKey !== undefined && (input.pluginKey ?? null) !== (row.plugin_key ?? null));

			const demoted = input.status === undefined && Number(row.status) === POLICY_STATUS.live && shapeTouched;
			const status = input.status ?? (demoted ? POLICY_STATUS.enabled : Number(row.status));

			await db
				.update(sysDataPolicy)
				.set({
					...(input.subject !== undefined ? { subject: input.subject } : {}),
					...(input.resource !== undefined ? { resource: input.resource } : {}),
					column: shape.column,
					value_key: shape.valueKey,
					plugin_key: shape.pluginKey,
					...(input.remark !== undefined ? { remark: input.remark } : {}),
					status,
					update_time: new Date(),
				})
				.where(eq(sysDataPolicy.id, input.id));
			clearDataScopeCache();
			return { id: input.id, status, demoted };
		}),

	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		const [row] = await db
			.select({ id: sysDataPolicy.id })
			.from(sysDataPolicy)
			.where(eq(sysDataPolicy.id, input.id))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "没有这条数据范围规则" });
		await db.delete(sysDataPolicy).where(eq(sysDataPolicy.id, input.id));
		clearDataScopeCache();
		return { id: input.id, removed: true };
	}),
});

/** `subject` 里那个 id(写法不对 / 不是这个 kind 就回 null) */
function subjectIdOf(raw: string, kind: SubjectKind): string | null {
	const subject = parseSubject(raw);
	return subject?.kind === kind ? subject.id : null;
}

/** 主体的人话:角色 / 部门 / 用户名字;`*` 是「所有人」 */
function subjectLabel(
	raw: string,
	names: { roleNames: Map<string, string>; deptNames: Map<string, string>; userNames: Map<string, string> },
): string {
	const subject = parseSubject(raw);
	if (!subject) return `${raw}(写法不对)`;
	if (subject.kind === "all") return "所有人";
	const table = subject.kind === "role" ? names.roleNames : subject.kind === "dept" ? names.deptNames : names.userNames;
	return `${SUBJECT_KIND_META[subject.kind]}:${table.get(subject.id) ?? subject.id}`;
}

/** 一条规则的主体名字(预览弹窗要显示"这条规则管的是谁",而它管的人常常不是当下这个人) */
async function subjectNameOf(raw: string): Promise<string> {
	const subject = parseSubject(raw);
	if (!subject) return `${raw}(写法不对)`;
	if (subject.kind === "all") return "所有人";
	const table = subject.kind === "role" ? sysRole : subject.kind === "dept" ? sysDept : sysUser;
	const names = await namesById(table, [subject.id]);
	const kind = SUBJECT_KIND_META[subject.kind];
	return `${kind}:${names.get(subject.id) ?? subject.id}`;
}

/** 一批 id → 名字(空数组直接回空表,不白跑一次 SQL) */
async function namesById(
	table: typeof sysRole | typeof sysDept | typeof sysUser,
	ids: string[],
): Promise<Map<string, string>> {
	if (ids.length === 0) return new Map();
	const rows = await db.select({ id: table.id, name: table.name }).from(table).where(inArray(table.id, ids));
	return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * 校验一条规则的形状并归一(创建 / 更新共用)。
 *
 * 四道:主体写得出来吗、资源表存在吗(元数据读得到时才查)、列与插件的组合合法吗
 * (`validatePolicyCombo()`)—— 第三道是最容易配错的那个("选了值插件却不选列");
 * 第四道(m23422)是 `valueKey` 必须在插件**声明的** `valueKeys` 里,不然取不到值。
 *
 * v2 (m20034)起:不接收也不存 `params`/`items` —— 输出值装在插件自己的 `output_values` 里。
 */
async function checkRule(input: {
	subject: string;
	resource: string;
	column?: string | null;
	valueKey?: string | null;
	pluginKey?: string | null;
}): Promise<{ id: string; column: string | null; valueKey: string | null; pluginKey: string | null }> {
	const subject = parseSubject(input.subject);
	if (!subject) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `主体写法不对:${input.subject}。可用:${SUBJECT_ALL} / ${SUBJECT_KINDS.map((kind) => `${kind}:<id>`).join(" / ")}`,
		});
	}
	if (!isIdent(input.resource)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: `资源表名不合法:${input.resource}` });
	}

	// 元数据读得到的时候顺手确认表真的在(达梦 / 读不到时放行,交给 `preview` 的试跑兜底)
	const meta = await loadResourceMeta();
	if (meta.size > 0 && !meta.has(input.resource)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: `没有这张表:${input.resource}` });
	}

	const pluginKey = input.pluginKey?.trim() || null;
	const column = input.column?.trim() || null;
	const valueKey = input.valueKey?.trim() || null;
	if (pluginKey) {
		const plugin = (await loadPlugins()).get(pluginKey);
		if (!plugin) throw new TRPCError({ code: "BAD_REQUEST", message: `没有这个插件:${pluginKey}` });
		// 插件自己声明会给哪些 key(`valueKeys`,内置的写死在代码里、自建清单按 output_values 取);
		// 声明的清单非空时,填了 `valueKey` 就必须在里面 —— 否则这条规则注定取不到值(失败关闭)。
		// `valueKeys` 为空(如保留用的 `fixed`)不拦:那种插件本来就不该被规则引用,拦了反而挡住老数据。
		if (valueKey && plugin.valueKeys.length > 0 && !plugin.valueKeys.includes(valueKey)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `插件「${plugin.label}」不给这个 key:${valueKey}。它现在能给:${plugin.valueKeys.join(" / ")}`,
			});
		}
	}

	const reason = validatePolicyCombo({ column, pluginKey });
	if (reason) throw new TRPCError({ code: "BAD_REQUEST", message: reason });

	return { id: newId(), column, valueKey, pluginKey };
}
