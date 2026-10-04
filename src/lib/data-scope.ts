/**
 * 数据权限的**引擎** —— 把 `sys_data_policy` 里的规则编译成一个 Drizzle 的 where 片段。只在服务端跑。
 *
 * 一句话:功能权限管「能不能进这个页面 / 调这个接口」(`lib/casbin.ts`),这里管「进去之后**看得见哪些行**」。
 *
 * 一个读接口要做的只有两件:
 *  1. `DATA_SCOPE_BY_PATH` 里登记这条 procedure 管哪张资源表(`integrations/trpc/init.ts`);
 *  2. resolver 里把条件 and 进去:
 *
 *     `const scope = await ctx.scope("demo_grid");`
 *     `where(and(extraWhere, scope))`
 *
 * 编译出来的形状(规则形状见 `lib/data-scope-spec.ts` 的 `validatePolicyCombo()`):
 *
 *   `<列> in (一串值)`        -- 插件产出 `value`
 *   `<主键> in (一串行 id)`    -- 插件产出 `row`(逐行授权)
 *   (整条不过滤)               -- 规则命中且不填列(整类可见)
 *   `1 = 0`                   -- 有规则、但一条都没命中我(失败关闭)
 *
 * **四条纪律**(与 `lib/casbin.ts` 的四条纪律同一个精神):
 * 1. **求值路径绝不 fail-open**:认不到人就抛;命中但插件给不出值 ⇒ `1 = 0`;
 *    插件坏了 ⇒ 那条规则**忽略**(已留 warn),不是"不过滤"。唯一的"不过滤"是
 *    **这张资源表一条启用规则都没有**(= 能力还没开,与 v0 的"空表 = 没开"一致)。
 * 2. **主体不物化**:规则只存 `role:<id>` / `user:<id>` / `dept:<id>` / `*`,
 *    请求时拿 `ctx` 现场判 —— 于是改一个人的部门 / 角色**不用回刷任何规则行**。
 * 3. **只有这里是"数据权限"**:不许在 resolver 里手写过滤条件(守卫见
 *    `tests/auth.test.ts` 的分类检查)。要新口径就加插件,不改这里。
 * 4. **缓存 30 秒 + 写后即清**:规则缓存住;策略 / 插件增删改后调 `clearDataScopeCache()`
 *    (插件缓存另有一把 `clearPluginCache()`)。
 */
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";

import { db } from "#/db";
import { sysDataPolicy, sysDept, sysRole, sysUser, sysUserDept } from "#/db/data-base-schema";
import { roleIdsOf } from "#/lib/casbin";
import { resourceMetaOf, selectRows } from "#/lib/data-scope-meta";
import { type DeptNode, loadDeptNodes, resolvePluginValues } from "#/lib/data-scope-plugins";
import {
	ctxDeptIds,
	ctxRoleIds,
	ctxUserId,
	isIdent,
	POLICY_STATUS,
	type PolicyCtx,
	type PolicyDept,
	type PolicyRole,
	parseSubject,
	type Subject,
} from "#/lib/data-scope-spec";
import { logger } from "#/lib/logger";
import { alive } from "#/lib/soft-delete";
import { collectDescendantIds } from "#/lib/tree";

/**
 * **resolver 手里那个 `ctx.scope`** 的形状(由 `init.ts` 的 `dataScopeMiddleware` 挂上)。
 *
 * 返回 `undefined` = "这条请求不筛行"(没配规则 / 规则说了整类可见);返回一个 `SQL` = 把它塞进 `where`。
 * 两个要点:
 *  · 不带参数 ⇒ 用 `DATA_SCOPE_BY_PATH` 里为本接口登记的资源;**没登记就抛错**(而不是静默不筛);
 *  · 认不到用户的请求上下文 ⇒ 抛错(`onMissingContext: "throw"`),与功能权限的失败关闭同口径。
 */
export type DataScopeFn = (resource?: string) => Promise<SQL | undefined>;

// ── 上下文 ──────────────────────────────────────────────────────────────────

/** 角色 id → `{id,name}`(casbin 里认不出的 id 就没有 —— 脏行不该让接口 500) */
async function rolesOf(ids: string[]): Promise<PolicyRole[]> {
	if (ids.length === 0) return [];
	return db
		.select({ id: sysRole.id, name: sysRole.name })
		.from(sysRole)
		.where(and(inArray(sysRole.id, ids), alive(sysRole)))
		.orderBy(asc(sysRole.sort), asc(sysRole.name));
}

/** 往上爬多少层就放弃 —— 脏数据成环时兜底(正常组织树 3~4 层) */
const DEPT_WALK_MAX = 64;

/**
 * 我所属的部门 + 祖先链(根 → 我,去重)。
 *
 * 为什么一个数组就够:祖先链是"上级也能看到这份数据"那类插件要判的东西
 * (`ctx.depts.some((d) => d.name === "七宝镇")`),而"我所属的部门"靠 `mine` 分得出来 ——
 * 于是插件不必自己爬树,引擎也不必维护两种形状。
 */
function deptTreeOf(nodes: DeptNode[], mineIds: string[]): PolicyDept[] {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const mine = new Set(mineIds);
	const out = new Map<string, PolicyDept>();

	for (const id of mineIds) {
		let cursor = byId.get(id);
		let guard = 0;
		while (cursor && guard < DEPT_WALK_MAX) {
			out.set(cursor.id, {
				id: cursor.id,
				name: cursor.name,
				parentId: cursor.parentId,
				mine: mine.has(cursor.id),
			});
			cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
			guard += 1;
		}
	}

	// 根在前 —— 顺序只影响人看(预览弹窗把 `depts` 摊成一行),不影响判定
	const depthOf = (id: string): number => {
		let depth = 0;
		let cursor = byId.get(id);
		while (cursor?.parentId && depth < DEPT_WALK_MAX) {
			cursor = byId.get(cursor.parentId);
			depth += 1;
		}
		return depth;
	};
	return [...out.values()].sort((a, b) => depthOf(b.id) - depthOf(a.id));
}

/**
 * 装配"我是谁"。由数据权限中间件在认证之后调用一次,之后整个请求共用。
 *
 * `depts` 里放的是**原始归属 + 它的祖先链**(子树**不在**里面)—— 子树走另一个字段
 * `ctx.descendants`,这样规则语义才写得下:「我的部门及以下」是一个**可配的选择**
 * (插件 `my_departments` / `my_dept_only` / `my_street_tree` 各取所需),
 * 而不是写死在装配层的一个开关。
 *
 * 同时把**「我的部门及以下」的扁平 id 列表**(我 + 子孙,去重)存进 `ctx.descendants` —— UI 拿来
 * 显示「我的部门及以下」这一段,跟「我的部门及以上」一一对照;插件作者读同一个字段也是这一份值。
 */
export async function buildPolicyCtx(userId: string): Promise<PolicyCtx> {
	const [[user], roleIds, deptRows] = await Promise.all([
		db
			.select({ id: sysUser.id, name: sysUser.name })
			.from(sysUser)
			.where(and(eq(sysUser.id, userId), alive(sysUser)))
			.limit(1),
		roleIdsOf(userId),
		db.select({ departmentId: sysUserDept.department_id }).from(sysUserDept).where(eq(sysUserDept.user_id, userId)),
	]);
	const mineIds = [...new Set(deptRows.map((row) => row.departmentId))];
	const [roles, nodes] = await Promise.all([rolesOf(roleIds), loadDeptNodes()]);
	// 名字只是显示用的:`sys_user` 里查不到这个人(会话还在、账号已删)也照样认得出**谁**在问 ——
	// `compileScope()` 的"没有用户上下文"要拦的是**压根认不出人**(中间件漏装配),不是"这人没名字"。
	const depts = deptTreeOf(nodes, mineIds);
	const descendants = collectDescendantIds(nodes, mineIds);
	return { user: userId ? { id: userId, name: user?.name ?? userId } : null, roles, depts, descendants };
}

// ── 规则装载 + 缓存 ─────────────────────────────────────────────────────────

/** 编译用的一条规则(库里那行长这样,只是把 `subject` / `params` 解析好了) */
type LoadedRule = {
	id: string;
	/** 原始写法(`role:<id>` / `*` …)—— 台账页与预览的人话要用它 */
	rawSubject: string;
	subject: Subject;
	column: string | null;
	/**
	 * 从插件输出的每行里取哪个 key 的值(m23422)—— `<column> in 插件行[valueKey]`。
	 *
	 * **留空 = 老规则**:按 `column` 当 key 推断(v1.4 之前的老口径)。
	 */
	valueKey: string | null;
	pluginKey: string | null;
};

const RULE_CACHE_TTL_MS = 30_000;
let ruleCache: { at: number; byResource: Map<string, LoadedRule[]> } | null = null;

/**
 * 策略变了之后清缓存 —— **规则路由的每个 mutation 尾部都要调**。
 *
 * (插件变了不必调这里:`loadPlugins()` 自己 30 秒 TTL,插件路由清它自己那把缓存。)
 */
export function clearDataScopeCache(): void {
	ruleCache = null;
}

/**
 * 按资源表分组装载**全部启用规则**(一次查全,不是每张表一次)—— 这张表注定很小(个位数),
 * 一次查全省得每个读接口都发一条 SQL。
 *
 * 解析不出主体的行(脏数据)、以及**填了列却没填插件**这种形状非法的行,在这里丢掉并留一条 warn:
 * 一条配错的行不该让别人的权限跟着变。
 */
async function loadRules(): Promise<Map<string, LoadedRule[]>> {
	if (ruleCache && Date.now() - ruleCache.at < RULE_CACHE_TTL_MS) return ruleCache.byResource;

	const byResource = new Map<string, LoadedRule[]>();
	const rows = await db
		.select()
		.from(sysDataPolicy)
		.where(and(eq(sysDataPolicy.status, POLICY_STATUS.live), alive(sysDataPolicy)));

	for (const row of rows) {
		const subject = parseSubject(row.subject);
		if (!subject) {
			logger.warn("data_scope.rule_broken", { ruleId: row.id, reason: "subject 解析不出来", subject: row.subject });
			continue;
		}
		if (row.column && !row.plugin_key) {
			logger.warn("data_scope.rule_broken", { ruleId: row.id, reason: "填了列却没填插件" });
			continue;
		}
		const rule: LoadedRule = {
			id: row.id,
			rawSubject: row.subject,
			subject,
			column: row.column || null,
			valueKey: row.value_key || null,
			pluginKey: row.plugin_key || null,
		};
		const list = byResource.get(row.resource);
		if (list) list.push(rule);
		else byResource.set(row.resource, [rule]);
	}

	ruleCache = { at: Date.now(), byResource };
	return byResource;
}

/** 这张资源表有哪些启用中的规则 */
async function rulesOf(resource: string): Promise<LoadedRule[]> {
	return (await loadRules()).get(resource) ?? [];
}

// ── 编译 ────────────────────────────────────────────────────────────────────

/** `1 = 0` —— "有规则但一条都没命中我"的编译结果 */
function never(): SQL {
	return sql`1 = 0`;
}

/**
 * 一条规则编译后的四种结局。
 *
 * `empty` 与 `cond` 都是"一个条件",分开只为让预览弹窗能讲清"为什么一行也看不到":
 * `empty` = 这个人一个值都没取到(失败关闭),`cond` = 取到了值,只是不一定命中行。
 */
type CompiledRule =
	| { kind: "all" }
	| { kind: "skip" }
	| { kind: "empty"; where: SQL; text: string; values: string[] }
	| { kind: "cond"; where: SQL; text: string; values: string[] };

/** `in` 的值列表(值走参数,转义由 `sql` 模板负责) */
function valueList(values: string[]): SQL {
	return sql`(${sql.join(
		values.map((value) => sql`${value}`),
		sql`, `,
	)})`;
}

/**
 * 主体是否命中我 —— 数据权限与功能权限的关键区别就在这:这里判的是"这条规则**跟我有关吗**"。
 *
 * `dept:<id>` 取"**这个部门的人**":判 `ctx.depts` 里带 `mine` 的那些有没有它。
 * 要「这个部门**这个范围**」(拿它去比资源表的列)是另一回事 —— 那用插件从"我"出发去算
 * (如 `my_departments`),不该混进主体判定。
 */
function subjectMatches(subject: Subject, ctx: PolicyCtx): boolean {
	if (subject.kind === "all") return true;
	if (subject.kind === "user") return ctxUserId(ctx) === subject.id;
	if (subject.kind === "role") return ctxRoleIds(ctx).includes(subject.id);
	return ctxDeptIds(ctx).includes(subject.id);
}

/** 人话里最多列几个值(清单可能有几百个,预览里列全了没法看) */
const DESCRIBE_VALUES_MAX = 6;

function describeValues(values: string[]): string {
	const shown = values.slice(0, DESCRIBE_VALUES_MAX).map((value) => `'${value}'`);
	if (values.length > shown.length) shown.push(`…共 ${values.length} 个`);
	return shown.join(", ");
}

/**
 * 编译一条规则。
 *
 * `skip` 的四种情况都**不是**"放行":插件不存在 / 插件坏了(已留 warn)/ 主键取不到 /
 * 列名不合法 —— 这条规则当不存在(若它是唯一命中的规则,结果就是 `1 = 0`,失败关闭)。
 * 插件返回**空数组**不算 skip:那是"这个人什么都没有",编译成 `1 = 0`。
 */
async function compileRule(rule: LoadedRule, ctx: PolicyCtx): Promise<CompiledRule> {
	// 不配插件 = 整类可见(这条规则命中了我,我就能看这张表的全部行)
	if (!rule.pluginKey) return { kind: "all" };

	const rows = await resolvePluginValues(rule.pluginKey, {
		ctx,
		// v2 (m20034):「输出值」是插件的属性,不是规则的属性 —— 引擎不传 items,插件自己拿:
		// 内置插件(self / my_departments / my_dept_ancestors / my_street …)按 ctx 现算,
		// 用户自建的「清单」插件由 `toPlugin()` 读它自己的 `output_values`。
	});
	// `null` = 插件不可用(不存在 / 编译不过 / 抛异常 / 超时)—— 忽略,绝不当"放行"
	if (rows === null) return { kind: "skip" };

	// v1.3 (m18228):插件不再区分「给值 / 给行」 —— 一律是「给值」,接 `rule.column`
	// (列名要拼进 SQL,先校验形状)。
	const column = rule.column ?? "";
	if (!isIdent(column)) {
		logger.warn("data_scope.rule_broken", { ruleId: rule.id, reason: "列名不合法", column });
		return { kind: "skip" };
	}

	// m23422:取哪个 key 由规则的 `value_key` 说了算 —— 同一个清单可以放多类值(如 `town_id`
	// 与 `risk_level`),各配一条规则互不干扰;**留空 = 老规则**,沿用 v1.4 的推断(按 `column` 取)。
	// 取到的都是插件当时给的值,**没有 join / lookup —— 显示什么就是什么**(m18546)。
	//
	// 兜底:若 row 没有这个 key 但有 `value`(单列值,自建「清单」插件建行时 key 栏就是
	// `value` 时命中)→ 用 `value` 兜底。
	// 缺失两者(插件返了对象但这两个字段都没有)→ warn + skip(规则当无效),
	// 不报"行也看不到"因为这是配置错而不是"这个人没有",管理员需要看见。
	const valueKey = rule.valueKey?.trim() || column;
	const values: string[] = [];
	let missingCount = 0;
	for (const row of rows) {
		const v = row[valueKey] ?? row.value;
		if (typeof v === "string" && v) values.push(v);
		else missingCount++;
	}
	if (missingCount > 0) {
		logger.warn("data_scope.plugin_column_missing", {
			ruleId: rule.id,
			pluginKey: rule.pluginKey,
			column,
			valueKey,
			missingRows: missingCount,
			rowKeys: rows[0] ? Object.keys(rows[0]) : [],
		});
	}
	if (rows.length > 0 && values.length === 0) {
		// 插件返了对象但没一个对得上 column —— 配置错(规则选了 column 但插件没返这个 key)
		return { kind: "skip" };
	}
	if (values.length === 0) {
		// 插件返了空数组 = 这个人没有符合条件的东西 ⇒ 失败关闭
		return { kind: "empty", where: never(), text: `[${rule.rawSubject}] 没有可用的值 → 一行也看不到`, values };
	}

	const list = valueList(values);
	const shown = describeValues(values);
	return {
		kind: "cond",
		where: sql`${sql.identifier(column)} in ${list}`,
		text: `[${rule.rawSubject}] ${column} ∈ {${shown}}`,
		values,
	};
}

/** 逐条规则的命中情况 —— 预览弹窗靠它回答"为什么是这几行",`previewScope()` 也一并回出去 */
export type RuleBreakdown = {
	/** 规则 id(`(草稿)` = 表单里那条还没保存的) */
	id: string;
	/** 主体原文 */
	subject: string;
	/** 主体命中试算的人了吗 */
	matched: boolean;
	/** 这条规则实际起的作用 */
	effect: "all" | "filter" | "empty" | "skipped" | "not-matched";
	/** 人话 */
	detail: string;
	/** 插件取到的值(`not-matched` / `all` / `skipped` 时是 `null`) */
	values: string[] | null;
};

/** 编译整张资源表的可见范围:条件 + 一段人话 + 逐条规则的账(都只给预览用) */
async function compileScope(
	resource: string,
	ctx: PolicyCtx,
	/**
	 * 预览某条还没上线的规则时用:`rules` 拿这组规则**顶替**库里那组。
	 *
	 * 主体**照常判定** —— 以前这里有个 `ignoreSubject`(不判主体、给"假如这条规则对我生效"的估算),
	 * 预览的场景变了:现在要回答的是"**TA** 会不会因为这条规则多看/少看几行",主体判错就是答案错,
	 * 所以那个开关连同它的"假如"语义一起删掉了。
	 */
	options?: { rules?: LoadedRule[] },
): Promise<{ where?: SQL; description: string; breakdown: RuleBreakdown[] }> {
	// 认不到人 ⇒ 抛(照 `drizzle-policy` 的 `onMissingContext: "throw"`)。
	// 走到这里说明有个读接口没经过认证 / 中间件漏了装配 —— 宁可 500,也不许"看不见就是全看见"。
	if (!ctxUserId(ctx)) {
		throw new Error(`数据权限:没有用户上下文却要算 ${resource} 的可见范围`);
	}

	const rules = options?.rules ?? (await rulesOf(resource));
	// 这张资源表一条启用规则都没有 = 数据权限对这个资源还没开(与 v0「空表 = 没开」一致)
	if (rules.length === 0) {
		return { description: "没有启用中的规则 → 不筛选(所有人都看全部)", breakdown: [] };
	}

	const parts: SQL[] = [];
	const texts: string[] = [];
	const breakdown: RuleBreakdown[] = [];
	for (const rule of rules) {
		if (!subjectMatches(rule.subject, ctx)) {
			breakdown.push({
				id: rule.id,
				subject: rule.rawSubject,
				matched: false,
				effect: "not-matched",
				detail: "这条规则不是给我这类人的 → 与我无关",
				values: null,
			});
			continue;
		}
		const compiled = await compileRule(rule, ctx);
		// 一条命中的"整类可见"就够:整张表都看得见,不必再算别的规则
		if (compiled.kind === "all") {
			breakdown.push({
				id: rule.id,
				subject: rule.rawSubject,
				matched: true,
				effect: "all",
				detail: "整类可见 → 这张表不再筛",
				values: null,
			});
			return { description: `命中「整类可见」([${rule.rawSubject}])→ 不筛选`, breakdown };
		}
		if (compiled.kind === "skip") {
			breakdown.push({
				id: rule.id,
				subject: rule.rawSubject,
				matched: true,
				effect: "skipped",
				detail: "插件不可用 / 主键或列名取不到 → 这条当不存在(**不是放行**)",
				values: null,
			});
			continue;
		}
		breakdown.push({
			id: rule.id,
			subject: rule.rawSubject,
			matched: true,
			effect: compiled.kind === "empty" ? "empty" : "filter",
			detail: compiled.text,
			values: compiled.values,
		});
		parts.push(compiled.where);
		texts.push(compiled.text);
	}

	// 有规则、但一条都没命中我 ⇒ 一行都看不见(**失败关闭**)
	if (parts.length === 0) {
		return { where: never(), description: "有规则,但没有一条命中我 → 一行也看不到(失败关闭)", breakdown };
	}
	if (parts.length === 1) return { where: parts[0], description: texts[0], breakdown };
	return {
		where: sql`(${sql.join(parts, sql` or `)})`,
		description: texts.map((text) => `(${text})`).join(" 或 "),
		breakdown,
	};
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 算出「这张资源表我只看得到哪些行」。
 *
 * 返回值:
 *  - `undefined` = **不过滤**(这张表一条启用规则都没有 ⇒ 能力还没开;或者命中了"整类可见"的规则);
 *  - `SQL` = 条件,resolver 必须 `and` 进自己的 where。
 *
 * ⚠️ `undefined` 是**正常的**返回值,不是"出错" —— 所以**不许**写成
 * `if (scope) where(scope)` 这种"取不到就不过滤"的形状(那正是 fail-open)。
 * 守卫见 `tests/auth.test.ts`:每个 query 要么在 `DATA_SCOPE_BY_PATH` 里登记过,要么在
 * `UNSCOPED_QUERIES` 里显式声明"这张表不受数据权限管"。
 */
export async function scopeWhere(resource: string, ctx: PolicyCtx): Promise<SQL | undefined> {
	return (await compileScope(resource, ctx)).where;
}

// ── 预览(规则表单底部那个「可看到 47 / 71 行」) ────────────────────────────

/** 一行样张的取值 —— 已归一成能过 RPC 的形状(`Date` → ISO 字符串,二进制 → 占位) */
type ScopeRow = Record<string, string | number | boolean | null>;

function normalizeRows(rows: Record<string, unknown>[]): ScopeRow[] {
	return rows.map((row) => {
		const out: ScopeRow = {};
		for (const [key, value] of Object.entries(row)) {
			if (value === null || value === undefined) out[key] = null;
			else if (value instanceof Date) out[key] = value.toISOString();
			else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
			// `Buffer` 是 `Uint8Array` 的子类,这一句把两者都兜住
			else if (value instanceof Uint8Array) out[key] = "<二进制>";
			else out[key] = String(value);
		}
		return out;
	});
}

type ScopePreview = {
	/** 这张表一共多少行 */
	total: number;
	/** 换成我这个人,看得到多少行 */
	visible: number;
	/** 等效条件(给管理员看的"系统到底判了什么") */
	condition: string;
	/** 抽样:只取主键,**不 `select *`**(资源表可能含口令散列这类列) */
	sample: string[];
	/** 逐条规则的命中账 —— 回答"为什么是这几行" */
	rules?: RuleBreakdown[];
	/** 真实样张行 —— **只有预览弹窗要**(表单里的小预览不取,免得把业务数据带到不需要的地方) */
	rows?: ScopeRow[];
	/** 要提醒的事(表名不对 / 读不到元数据 / 表没配规则 …) */
	warning?: string;
	/** 这次真跑的两条 SQL(计数 + 抽样)—— 拿不到就没有这一块,试算照常 */
	sql?: { count: ScopeSql; rows: ScopeSql };
};

/** 计数语句 —— 单独抽出来,是为了让贴给管理员看的 SQL 与**真执行的那条**是同一个语句对象 */
function countQueryOf(resource: string, where?: SQL): SQL {
	return where
		? sql`select count(*) as n from ${sql.identifier(resource)} where ${where}`
		: sql`select count(*) as n from ${sql.identifier(resource)}`;
}

/**
 * id → 名字(用户 / 角色 / 部门同款),**只认活着的行** —— 软删掉的人不该再被解出名字。
 *
 * 数据范围列表页、试算预览、插件试跑三处都要"把 ctx 里的 id 翻成人话",此前是各抄一份。
 */
export async function namesById(
	table: typeof sysUser | typeof sysRole | typeof sysDept,
	ids: string[],
): Promise<Map<string, string>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: table.id, name: table.name })
		.from(table)
		.where(and(inArray(table.id, ids), alive(table)));
	return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * 试算 / 预览弹窗共用的「上下文人话」:角色名 + 我的部门祖先链(`mine` 标出"哪一段是我")+
 * 我的部门及以下(同样标 `mine`)。
 *
 * 后端 `buildPolicyCtx` 只给 id 数组,前端显示需要 name + mine —— 两个弹窗
 * (插件试算 `dataPlugin.test`、规则预览 `dataScope.trial`)此前各抄一份,
 * 每改一次部门语义就要改两处。出参形状就是预览弹窗的契约,别在这个函数里改字段名。
 */
export async function policyContextOut(ctx: PolicyCtx): Promise<{
	roles: string[];
	ancestors: Array<{ name: string; mine: boolean }>;
	children: Array<{ name: string; mine: boolean }>;
}> {
	const mineIds = new Set(ctx.depts.filter((dept) => dept.mine).map((dept) => dept.id));
	const descendantRows =
		ctx.descendants.length === 0
			? []
			: await db
					.select({ id: sysDept.id, name: sysDept.name })
					.from(sysDept)
					.where(and(inArray(sysDept.id, ctx.descendants), alive(sysDept)));
	return {
		roles: ctx.roles.map((role) => role.name),
		ancestors: ctx.depts.map((dept) => ({ name: dept.name, mine: dept.mine })),
		children: descendantRows.map((row) => ({ name: row.name, mine: mineIds.has(row.id) })),
	};
}

async function countRows(query: SQL): Promise<number> {
	return Number((await selectRows(query))[0]?.n ?? 0);
}

/** 贴出来给人看的参数值(`null` / 数字 / 布尔原样,别的一律转字符串) */
export type ScopeSqlParam = string | number | boolean | null;

/** 一条真跑过的语句:文本 + 参数分开给,前端自己决定怎么排 */
export type ScopeSql = { text: string; params: ScopeSqlParam[] };

/**
 * 把准备好的语句渲染成"真 SQL + 参数"(`?` 占位)。
 *
 * 为什么要伸手进 `db.dialect`:`selectRows()` 只把结果还给我,而预览弹窗要回答的是"引擎到底发了哪条 SQL" ——
 * 用**同一个** dialect 渲染**同一个**语句对象,贴出来的就是它真跑的那条(而不是另写一份人话描述,
 * 那种描述迟早跟真 SQL 漂移)。达梦那条线上万一渲染不出来:拿不到就 `undefined`,弹窗少一块,不影响试算。
 */
function describeSql(query: SQL): ScopeSql | undefined {
	try {
		const dialect = (db as unknown as { dialect: { sqlToQuery(q: SQL): { sql: string; params: unknown[] } } }).dialect;
		const compiled = dialect.sqlToQuery(query);
		return {
			text: compiled.sql,
			params: compiled.params.map((value) =>
				value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
					? value
					: String(value),
			),
		};
	} catch {
		return undefined;
	}
}

/**
 * 表单里那条**还没保存**的规则(预览用)—— 字段与 `LoadedRule` 同构,只是没有 id。
 *
 * 不传 `trial` 就是"按库里现在启用着的规则,换成我这个人算一遍"。
 */
type TrialRule = {
	/** 试算的是库里哪条规则(拿它的 id 去 `previewScope`);规则表单里那条还没保存的草稿没有 id,给 `(草稿)` */
	id?: string;
	subject: string;
	column?: string | null;
	/** 从插件输出的每行里取哪个 key(m23422);留空 = 按 `column` 推断 */
	valueKey?: string | null;
	pluginKey?: string | null;
};

function toTrialRule(trial: TrialRule): LoadedRule | null {
	const subject = parseSubject(trial.subject);
	if (!subject) return null;
	return {
		id: trial.id ?? "(草稿)",
		rawSubject: trial.subject,
		subject,
		column: trial.column ?? null,
		valueKey: trial.valueKey ?? null,
		pluginKey: trial.pluginKey ?? null,
	};
}

/**
 * 试跑:换成**当前这个人**算一次,交出「总共多少行 / 我就看得见多少行 / 等效条件 / 真跑的 SQL / 抽样」。
 *
 * 为什么这是值域配错的唯一真护栏:值域是弱类型(拿文本列 `town_name` 去配部门域插件照样跑得起来,
 * 只是命中 0 行),硬拦没用 —— 真跑一次,配错当场看得见「命中 0 / 71」。
 */
export async function previewScope(args: {
	resource: string;
	ctx: PolicyCtx;
	sampleLimit?: number;
	/** 预览弹窗用:连真实样张一起取(破例 `select *`);表单里的小预览不传,免得把业务数据带到不需要的地方 */
	withRows?: boolean;
	/** 传了就把它**当成已上线的规则一起算**(预览"假如这一条上线了");不传就只按库里现在上线的算 */
	trial?: TrialRule;
}): Promise<ScopePreview> {
	const { resource, ctx } = args;
	if (!isIdent(resource)) {
		return { total: 0, visible: 0, condition: "(表名不合法)", sample: [], warning: "表名只能是字母 / 数字 / 下划线" };
	}

	let trialRule: LoadedRule | undefined;
	if (args.trial) {
		const built = toTrialRule(args.trial);
		if (!built) {
			return {
				total: 0,
				visible: 0,
				condition: "(主体写法不对)",
				sample: [],
				warning: `主体写法不对:${args.trial.subject}`,
			};
		}
		trialRule = built;
	}

	let total = 0;
	try {
		total = await countRows(countQueryOf(resource));
	} catch (error) {
		return {
			total: 0,
			visible: 0,
			condition: "(算不出来)",
			sample: [],
			warning: `读不到这张表:${error instanceof Error ? error.message : String(error)}`,
		};
	}

	// 预览一条规则 = "**假如把这条也加上**,这个人能看到什么" ⇒ 追加到启用中的规则之上,不顶替。
	// 主体照常判:它配给的正是屏幕上那个人时才算命中 —— 不判的话页面给不出可信的答案。
	const rules = trialRule
		? [...(await rulesOf(resource)).filter((item) => item.id !== trialRule.id), trialRule]
		: undefined;
	const { where, description, breakdown } = await compileScope(resource, ctx, rules ? { rules } : undefined);
	const visibleQuery = countQueryOf(resource, where);
	const visible = await countRows(visibleQuery);
	const limit = Math.min(Math.max(args.sampleLimit ?? 3, 1), 20);

	// 抽样只取主键(没有主键就什么也不取)
	const meta = await resourceMetaOf(resource);
	const sample: string[] = [];
	if (meta?.pk) {
		const query = where
			? sql`select ${sql.identifier(meta.pk)} as pk from ${sql.identifier(resource)} where ${where} limit ${limit}`
			: sql`select ${sql.identifier(meta.pk)} as pk from ${sql.identifier(resource)} limit ${limit}`;
		sample.push(...(await selectRows(query)).map((row) => String(row.pk ?? "")));
	}

	// 预览弹窗要的是"长什么样",所以这里破例 `select *` —— 表名刚过了 `isIdent`、条件走参数;
	// 取不到就退化成"只有数、没有样张",不让它把整页拖成 500
	let rows: ScopeRow[] | undefined;
	let sqlInfo: { count: ScopeSql; rows: ScopeSql } | undefined;
	let rowError: string | undefined;
	if (args.withRows) {
		const rowsQuery = where
			? sql`select * from ${sql.identifier(resource)} where ${where} limit ${limit}`
			: sql`select * from ${sql.identifier(resource)} limit ${limit}`;
		// 先把两条语句渲染出来(用的就是上面真跑的那两个对象),再执行抽样那一句
		const countSql = describeSql(visibleQuery);
		const rowsSql = describeSql(rowsQuery);
		if (countSql && rowsSql) sqlInfo = { count: countSql, rows: rowsSql };
		try {
			rows = normalizeRows(await selectRows(rowsQuery));
		} catch (error) {
			rowError = `样张取不到:${error instanceof Error ? error.message : String(error)}`;
		}
	}

	const warnings: string[] = [];
	if (trialRule && !subjectMatches(trialRule.subject, ctx)) {
		warnings.push(`主体「${trialRule.rawSubject}」不含这个人 → 这条规则对 TA 不起作用,加了也不多看见行`);
	}
	if (rowError) warnings.push(rowError);
	return {
		total,
		visible,
		condition: description,
		sample,
		rules: breakdown,
		...(rows ? { rows } : {}),
		...(sqlInfo ? { sql: sqlInfo } : {}),
		...(warnings.length > 0 ? { warning: warnings.join(";") } : {}),
	};
}
