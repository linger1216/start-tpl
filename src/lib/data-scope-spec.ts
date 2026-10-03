/**
 * 数据权限的**规格**:插件形态、主体写法、规则的形状判据。
 *
 * ⚠️ **这个文件里不允许出现 `db` / `drizzle` / 任何服务端依赖** —— 它是要进浏览器包的。
 *
 * 为什么和 `lib/data-scope-plugins.ts` / `lib/data-scope.ts` 拆开(和 `lib/para-spec.ts`
 * 踩的是同一个坑):规则表单与插件管理页只需要「中文名 + 可选值 + 校验」,而那两个文件都
 * `import { db }`(→ drizzle-orm → mysql2)—— 从客户端 import 它们会把数据库驱动打进
 * 路由 chunk,浏览器一执行初始化就崩。**客户端组件只许从这里 import。**
 *
 * 规则(一行 `sys_data_policy`)的形状是:
 *
 *   `<资源表>.<列> in 插件(我)`            -- 插件产出一组值,接规则的 column
 *   (不配插件)                              -- 整类可见
 *
 * 下面 `validatePolicyCombo()` 是这两条的唯一实现,页面与 procedure 都读它。
 *
 * v1.3 (m18228):user 明确「插件不需要域概念」 —— 「给值 / 给行」「user / dept / town / area
 * / text」整组字段砍掉。插件只管"返回一组 id 或字符串",这组东西接哪一列、按什么语义匹配,
 * 完全是规则的事(`sys_data_policy.column` 已经隐含「我接的是哪一列」)。域归属不再是插件
 * 自报的口径,lookup 改成按规则的 column / 上下文查 sys_user / sys_dept 或不查。
 */

/**
 * 规则的三个状态 —— **「启用」是配置层面的开关,「上线」才是真正生效**(m23000 之前这两个叫反了:
 * 新建出来的那条明明还没生效,标签却写着「上线」)。
 *
 * 生命周期:新建 / 改过形态 →「启用」(2) →点「上线」→「上线」(1) →点「停用」→「停用」(0)。
 *
 * 为什么**新建出来不直接生效**:数据权限改的是"别人能看见哪些行",配错的方向恰好是**多看见**
 * (值域是弱类型,配错了通常一行都匹配不上,但也可能一下匹配到一大片 —— 而且在真跑之前看不出来)。
 * 所以新规则先落「启用」(status=2):它**不进引擎**(`loadRules()` 只读 status=1),
 * 但在规则台账上点「预览」能拿真实数据算一遍 —— 算对了、点了「上线」才真的生效。
 * 「停用」(0)是给上线过的规则留的回头路:先摘下来,改完再启用、再上线。
 */
export const POLICY_STATUS = { disabled: 0, live: 1, enabled: 2 } as const;
export type PolicyStatus = (typeof POLICY_STATUS)[keyof typeof POLICY_STATUS];

const POLICY_STATUS_META: Record<PolicyStatus, { label: string; tone: string; hint: string }> = {
	[POLICY_STATUS.enabled]: {
		label: "启用",
		tone: "bg-hue-amber-soft text-hue-amber-fg",
		hint: "还没上线 —— 引擎不加载它;点「预览」算一遍,对了再点「上线」",
	},
	[POLICY_STATUS.live]: {
		label: "上线",
		tone: "bg-hue-teal-soft text-hue-teal-fg",
		hint: "引擎正在按它筛行",
	},
	[POLICY_STATUS.disabled]: {
		label: "停用",
		tone: "bg-muted text-muted-foreground",
		hint: "引擎不加载;点「启用」把它放回启用态",
	},
};

/** 状态 → 人话(认不出的脏值原样显示,别把 500 引到界面上) */
export function policyStatusMeta(status: number): { label: string; tone: string; hint: string } {
	return POLICY_STATUS_META[status as PolicyStatus] ?? { label: `未知(${status})`, tone: "", hint: "" };
}

/** 主体:所有人 */
export const SUBJECT_ALL = "*";

/** 主体的种类(策略行里写成 `<kind>:<id>`,或者 `*`) */
export const SUBJECT_KINDS = ["user", "role", "dept"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const SUBJECT_KIND_META: Record<SubjectKind | "all", string> = {
	all: "所有人",
	user: "用户",
	role: "角色",
	dept: "部门",
};

export type Subject = { kind: SubjectKind; id: string } | { kind: "all" };

/** 把 `user:<id>` 拆开;认不出来回 `null`(脏数据不该让求值崩,当"这条规则无效"处理) */
export function parseSubject(raw: string): Subject | null {
	if (raw === SUBJECT_ALL) return { kind: "all" };
	const at = raw.indexOf(":");
	if (at <= 0) return null;
	const kind = raw.slice(0, at);
	const id = raw.slice(at + 1);
	if (!id || !(SUBJECT_KINDS as readonly string[]).includes(kind)) return null;
	return { kind: kind as SubjectKind, id };
}

export function formatSubject(kind: SubjectKind, id: string): string {
	return `${kind}:${id}`;
}

/**
 * 标识符(表名 / 列名 / 插件标识)的合法形状。
 *
 * 插件声明的资源表名、规则里的判据列名**会拼进 SQL**(它们没法当参数传)——
 * 界面上从 `information_schema` 里选,保存与运行时各校验一次这个正则。
 * 请求方输入永远只落进 `in (参数)`,不参与标识符。
 */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function isIdent(value: string): boolean {
	return IDENT_RE.test(value);
}

/** 当前登录人 */
type PolicyUser = { id: string; name: string };

/** 我的一个角色 */
export type PolicyRole = { id: string; name: string };

/**
 * 我的一个部门节点。
 *
 * `mine` 分得开"我所属的部门"与"它的上级":同一个数组既当归属,又当部门树。
 */
export type PolicyDept = { id: string; name: string; parentId: string | null; mine: boolean };

/**
 * 求值上下文:一次请求里"我是谁"。由数据权限中间件装配(见 `integrations/trpc/init.ts`)。
 *
 * 刻意**只放对象、不放 id 数组**:`user` / `roles` / `depts` 三个东西够用,id 自己从对象里拿
 * (`ctx.user?.id`、`ctx.roles.map((r) => r.id)`、`ctx.depts.filter((d) => d.mine).map((d) => d.id)`)——
 * 少三个字段,写插件的人就少三个问题("这两个到底有什么区别")。
 */
export type PolicyCtx = {
	/** 登录人;认不到人是 `null`(那时插件必须回空数组) */
	user: PolicyUser | null;
	/** 我的角色(带名字 —— 插件常要判"是不是队长") */
	roles: PolicyRole[];
	/**
	 * 我所属的部门 + 它们的祖先(根 → 我,去重)。
	 *
	 * 一个数组干两件事:`d.mine === true` 的是我所属的部门,其余是上级 ——
	 * 所以"我的祖先里有七宝镇吗"就是 `ctx.depts.some((d) => d.name === "七宝镇")`。
	 * **子树**(我的部门及以下)不在这里,走 `ctx.descendants`。
	 */
	depts: PolicyDept[];
	/**
	 * 「我的部门及以下」的扁平 id 列表(我 + 子孙,去重)。
	 *
	 * 跟 `depts`(祖先链)对偶:depts 是「向上走」,descendants 是「向下走 + 自己」。
	 * 引擎和插件读的是**同一份值**;这里明文存下来,页面才能在「当前上下文」里
	 * 同时展示「以上」和「以下」两段,插件也不必自己再爬一遍树。
	 */
	descendants: string[];
};

/**
 * 从 `ctx` 里取 id。
 *
 * 上下文刻意不放 id 数组(见 `PolicyCtx`),但引擎判主体、算插件入参时又到处要 id ——
 * 于是这三个小函数就是"从对象里拿 id"的唯一定义处(服务端与插件侧共用,它不依赖 `db`)。
 */
export function ctxUserId(ctx: PolicyCtx): string | null {
	return ctx.user?.id ?? null;
}

export function ctxRoleIds(ctx: PolicyCtx): string[] {
	return ctx.roles.map((role) => role.id);
}

/** 我**所属**的部门(不含祖先、不含子树)—— `depts` 里带 `mine` 的那些 */
export function ctxDeptIds(ctx: PolicyCtx): string[] {
	return ctx.depts.filter((dept) => dept.mine).map((dept) => dept.id);
}

/**
 * 规则的形状判据 —— 返回出错原因,`null` 表示合法。
 *
 * v1.3 (m18228):砍掉 `produces` 判据 —— 插件不再区分「给值 / 给行」,规则侧
 * 不再区分 `column` 必填场景。剩下两个组合:
 *  - 配了插件却没选列 ⇒ 插件产出一组 id / 字符串,但规则没指定接哪一列,引擎不知道
 *    编译成 `column in 值[]`;
 *  - 没配插件却填了列 ⇒ 同一条规则拆不出「约束列」语义,只配列没意义。
 *  - 没配插件也没列 ⇒ 整类可见,合法。
 *  - 配了插件也选了列 ⇒ 合法(规则形如 `<资源表>.<列> in 插件(我)`)。
 */
export function validatePolicyCombo(args: { column: string | null; pluginKey: string | null }): string | null {
	const { column, pluginKey } = args;
	if (!pluginKey) {
		return column ? "没选插件就不该填列;整类可见 = 什么也不填" : null;
	}
	return column ? null : "配了插件就必须选一个列来配(`<资源表>.<列> in 插件(我)`)";
}

/** 备注长度上限(与 `sys_data_policy.remark` / `sys_data_plugin.remark` 的列宽一致) */
export const DATA_SCOPE_REMARK_MAX = 255;

/** 一个插件最多带多少行「输出值」(`sys_data_plugin.output_values` 的行数上限) */
export const PLUGIN_ITEMS_MAX = 200;

/** 输出值单行 key 最长(同 `sys_data_policy.column` 列宽) */
export const PLUGIN_ITEM_KEY_MAX = 64;
/** 输出值单行 value 最长(避免有人塞整张表) */
export const PLUGIN_ITEM_VALUE_MAX = 256;

/**
 * m18825 「指定清单」专用:**输出值** 的一行 —— 直接给「`column in (...)`」用的字面值。
 *
 * 与 `params: string[]` 不同:这里每行是 `{ key, value }`,`key` 是输出对象的字段名
 * (引擎按规则 column 取 `row[column]`,缺了走 `row.value` 兜底),`value` 是字面字符串。
 *
 * key 自由编辑:不限于 `"value"`,可以填 `"town_id"` / `"id"` / `"name"` 等。
 */
export type RuleItem = { key: string; value: string };

/**
 * 读**值域插件**的输出值行列表(`sys_data_plugin.output_values` → `{key,value}[]`)。
 *
 * v1.5 时这份数据挂在**策略行**上,所以旧注释叫它"策略行的 `items`";v2 起规则侧不再有
 * 输出值,唯一真源是插件行,引擎只在 `toPlugin()` 里读它。
 *
 * 入参形态:
 *  - `Array<{ key: string, value: string }>` 直接认
 *  - `string` 是 JSON 字符串 → 解出
 *  - 数组里混有 `string`(更早的 `string[]` 存法) → 当 `{ value: str }` 兜底
 *    (每个 string 自带 `{ value }`,没有 key;与 v1.4 引擎 `row.value` 兜底兼容)
 *  - 其它一律回空数组
 *
 * **key 自由编辑**:不限制 `isIdent`,允许用户填任意非空字符串作为字段名 —— 引擎
 * 取值时按 column 找,缺 key 时走 `row.value` 兜底,与 v1.4 行为一致。
 */
export function parseItems(raw: unknown): RuleItem[] {
	const coerce = (item: unknown): RuleItem | null => {
		if (typeof item === "string") {
			const v = item.trim();
			return v ? { key: "value", value: v.slice(0, PLUGIN_ITEM_VALUE_MAX) } : null;
		}
		if (item && typeof item === "object") {
			const obj = item as Record<string, unknown>;
			const k = typeof obj.key === "string" ? obj.key.trim() : "";
			const v = typeof obj.value === "string" ? obj.value.trim() : "";
			if (!v) return null;
			return {
				key: k ? k.slice(0, PLUGIN_ITEM_KEY_MAX) : "value",
				value: v.slice(0, PLUGIN_ITEM_VALUE_MAX),
			};
		}
		return null;
	};

	if (Array.isArray(raw)) {
		return raw
			.map(coerce)
			.filter((item): item is RuleItem => Boolean(item))
			.slice(0, PLUGIN_ITEMS_MAX);
	}
	if (typeof raw === "string") {
		try {
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed)
				? parsed
						.map(coerce)
						.filter((item): item is RuleItem => Boolean(item))
						.slice(0, PLUGIN_ITEMS_MAX)
				: [];
		} catch {
			return [];
		}
	}
	return [];
}

/** 入参校验:用户提交到 router 的 `items[]` 是否合法 */
export function checkRuleItems(items: RuleItem[]): string | null {
	if (items.length > PLUGIN_ITEMS_MAX) return `输出值最多 ${PLUGIN_ITEMS_MAX} 行`;
	for (const item of items) {
		if (!item.value) return "输出值每行 value 不能为空";
		if (item.value.length > PLUGIN_ITEM_VALUE_MAX) return `输出值 value 最长 ${PLUGIN_ITEM_VALUE_MAX} 个字符`;
		if (item.key.length > PLUGIN_ITEM_KEY_MAX) return `输出值 key 最长 ${PLUGIN_ITEM_KEY_MAX} 个字符`;
	}
	return null;
}
