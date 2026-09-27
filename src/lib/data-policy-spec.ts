/**
 * 数据权限策略行的**纯逻辑** —— 这里不许引任何服务端模块(`#/db`、`casbin`),客户端 / 脚本 / 测试都能引。
 *
 * 一行策略 = 「谁(主体)能访问哪个资源(obj)· 什么动作(act)· 允许还是拒绝(eft)」,存在 `sys_data_policy`:
 *
 *   `p, user:张三, demo_grid@org:<七宝镇网格组 id>, read, allow`   → 他看这个网格组及其以下的网格
 *   `p, role:局领导, *, *, allow`                                  → 全部资源都不限制
 *
 * 碰库的那一半在 `lib/data-policy.ts`(Casbin 模型 + 只读适配器 + 编译成 SQL 条件)。
 *
 * **为什么资源要写具体的组织节点,而不是"本部门及以下"这种档位词**:各街镇层级深浅不一,
 * 数层数迟早出错;直白写出节点,层级由 `sys_dept` 现算。
 */

/** 已登记的资源类型(名字必须与 `lib/data-policy.ts` 的物理列注册表一致,有测试守) */
export const POLICY_RESOURCES: Record<string, { label: string }> = {
	demo_grid: { label: "网格履职" },
	sys_user: { label: "用户" },
};

/** 动作:`*` = 读写都算 */
export const POLICY_ACTIONS = ["read", "write", "*"] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

/** 效果:`deny` 从可见集合里做减法(整类的 `deny` 是一票否决,见 `WHOLE_TYPE_DENY_FN`) */
export const POLICY_EFFECTS = ["allow", "deny"] as const;
export type PolicyEffect = (typeof POLICY_EFFECTS)[number];

/**
 * 主体种类 —— 与 `sys_data_policy.v0` 的写法一一对应。
 *
 * 这一份是**唯一真源**:表单的下拉选项、接口的 zod 枚举、台账的排序口径都从它派生 ——
 * 少一处抄写,就少一处"加了新种类但某个入口忘了认"。
 */
export const POLICY_SUBJECT_KINDS = ["all", "user", "role", "dept"] as const;
export type PolicySubjectKind = (typeof POLICY_SUBJECT_KINDS)[number];

/** 资源范围种类:`type` 整类型 / `org` 该组织及以下 / `row` 具体一行(`resourceType = null` 才是"全部资源") */
export const POLICY_SCOPE_KINDS = ["type", "org", "row"] as const;
export type PolicyScopeKind = (typeof POLICY_SCOPE_KINDS)[number];

/** 一次最多生成的规则数(主体 × 范围):接口拦、表单提示共用这一个数 */
export const POLICY_MAX_RULES = 200;
/** 一次最多选的范围对象数(`scopeIds`) */
export const POLICY_MAX_SCOPES = 50;

/** Casbin matcher 里注册的自定义函数名(模型串与 `addFunction` 共用,避免写错一个字母就静默失效) */
export const RESOURCE_UNDER_FN = "resourceUnder";

/**
 * Casbin matcher 里第二个自定义函数:这条 `deny` 是不是盖住了**整个类型**(`*` / 裸类型)。
 *
 * 为什么 matcher 需要它:`[policy_effect]` 的 `!some(deny)` 是在**按 matcher 筛出来的 p 集合**上算的,
 * 而 matcher 的 `resourceUnder` 是"相交"语义 —— `@org:` / `@<行>` 的 deny 与"这一类能不能读"这种请求
 * 也算命中。不加这一句,给某个人的**行级** deny 会把他自己的整类 allow 一起否决掉(实测踩到:
 * 「允许某组织 + 拒绝其中一行」当场变成一条也看不见)。**整类**的 deny 才是一票否决,
 * 行级 / 组织级的 deny 交给 SQL 做减法。
 */
export const WHOLE_TYPE_DENY_FN = "wholeTypeDeny";

/** 主体:整表 `*`,或 `user:<用户 id>` / `role:<角色 code>` / `dept:<部门 id>` */
type PolicySubject = { kind: "all" } | { kind: "user" | "role" | "dept"; id: string };

/** 资源:`*` / 某类型全部 / 该类型下某个组织(含子树)/ 该类型下某一行 */
type PolicyResourceRef =
	| { kind: "all" }
	| { kind: "type"; type: string }
	| { kind: "org"; type: string; id: string }
	| { kind: "row"; type: string; id: string };

/** 策略行(与 `sys_data_policy` 的 `v0..v3` 一一对应) */
export type PolicyRule = { sub: string; obj: string; act: string; eft: string };

/**
 * id 部分:不许出现空白与两个分隔符(`:` 拆主体、`@` 拆资源),长度也限住 —— 其余字符**一律放行**。
 *
 * 特意允许中文:角色 code 是用户自己填的(`z.string().min(1).max(64)`,不限制字符集),
 * 真有人把 code 填成「局领导」也不该让这条策略**静默失效**。
 */
const ID_PART = /^[^\s:@]{1,64}$/;

function isResourceType(value: string): boolean {
	return Object.hasOwn(POLICY_RESOURCES, value);
}

export function parseSubject(raw: string): PolicySubject | null {
	const value = raw.trim();
	if (value === "*") return { kind: "all" };
	const at = value.indexOf(":");
	if (at < 0) return null;
	const kind = value.slice(0, at);
	if (kind !== "user" && kind !== "role" && kind !== "dept") return null;
	const id = value.slice(at + 1);
	return ID_PART.test(id) ? { kind, id } : null;
}

export function parseResource(raw: string): PolicyResourceRef | null {
	const value = raw.trim();
	if (value === "*") return { kind: "all" };
	const at = value.indexOf("@");
	if (at < 0) return isResourceType(value) ? { kind: "type", type: value } : null;
	const type = value.slice(0, at);
	if (!isResourceType(type)) return null;
	const tail = value.slice(at + 1);
	if (tail.startsWith("org:")) {
		const id = tail.slice("org:".length);
		return ID_PART.test(id) ? { kind: "org", type, id } : null;
	}
	return ID_PART.test(tail) ? { kind: "row", type, id: tail } : null;
}

export function parseAction(raw: string): PolicyAction | null {
	const value = raw.trim();
	return (POLICY_ACTIONS as readonly string[]).includes(value) ? (value as PolicyAction) : null;
}

/**
 * 校验一行策略,返回中文原因(`null` = 合法)。装载 / 迁移 / 测试共用;
 * **不合法的行一律被忽略**(不给任何授权),同时在控制台告警 —— 见 `lib/data-policy.ts`。
 */
export function policyRuleProblem(rule: PolicyRule): string | null {
	if (!parseSubject(rule.sub)) return `主体不合法:${rule.sub || "(空)"}`;
	if (!parseResource(rule.obj)) return `资源不合法:${rule.obj || "(空)"}`;
	if (!parseAction(rule.act)) return `动作不合法:${rule.act || "(空)"}`;
	if (rule.eft !== "allow" && rule.eft !== "deny") return `效果不合法:${rule.eft || "(空)"}`;
	return null;
}

/** 策略行的动作是否覆盖调用方要求的动作 */
/** 动作是否命中(`*` 对任何动作都算命中)—— 引擎的 matcher 与草稿预览共用这一份 */
function matchesAction(policyAct: string, action: string): boolean {
	const value = policyAct.trim();
	return value === "*" || value === action;
}

/**
 * 「`requested` 与 `policyObj` 这两个范围**相交**吗」—— 它同时是 Casbin matcher 里的 `resourceUnder`。
 *
 * 实际调用时 `requested` 总是裸资源类型(`dataScopeWhere` 问的是"这个人能不能读这一类资源"),
 * 所以"策略写得更具体也算命中";两端都做成相交语义,是因为两边都得自洽:
 *
 *   requested 裸类型 + 策略 `*` / 裸类型 / `@org:` / `@<行>`  ⇒ 命中(这条策略授的是这一类的**一部分**)
 *   requested `@<行>` + 策略 `*` / 裸类型 / **同一条行**     ⇒ 命中
 *   两条不同的行 / 两个不同的组织 / 不同类型的行              ⇒ 不命中
 *   一边组织一边行(包含关系要去查 `sys_dept`)              ⇒ **不命中**(不猜)
 *
 * **解析不出来一律不算**(否则写错一个字的策略行会被 Casbin 判成 allow,而编译出来的可见集合是空的 —— 两处口径就打架了)。
 */
export function resourceUnder(requested: string, policyObj: string): boolean {
	const want = parseResource(requested);
	const got = parseResource(policyObj);
	if (!want || !got) return false;
	if (got.kind === "all") return true;
	if (want.kind === "all") return false;
	// 有一边是"整类型" ⇒ 同类型就算相交(got 更具体 = 命中;want 更具体 = 这条策略覆盖得到它)
	if (want.kind === "type" || got.kind === "type") return want.type === got.type;
	if (want.type !== got.type) return false;
	if (want.kind !== got.kind) return false; // 组织 vs 行:包含关系要查库,不猜
	return want.id === got.id;
}

/** 这条 `deny` 盖住的是不是**整个类型**(见 `WHOLE_TYPE_DENY_FN` 的说明) */
export function wholeTypeDeny(policyObj: string): boolean {
	const ref = parseResource(policyObj);
	return !!ref && (ref.kind === "all" || ref.kind === "type");
}

/** 编译结果:服务端据此拼 SQL(或直接放行) */
export type ScopePlan = {
	/** 命中了「不限制」的规则(`*` 或同类型的裸资源)⇒ 这次查询不加任何条件 */
	unrestricted: boolean;
	/** 整个请求范围都被 `deny` 盖住(`*` / 裸类型)⇒ 恒假 */
	denied: boolean;
	/** 被授权到的组织节点(子树由服务端展开) */
	orgs: string[];
	/** 被授权到的具体行 */
	rows: string[];
	/** 被 `deny` 减掉的组织节点(子树一起减) */
	denyOrgs: string[];
	/** 被 `deny` 减掉的具体行 */
	denyRows: string[];
};

function deniedPlan(): ScopePlan {
	return { unrestricted: false, denied: true, orgs: [], rows: [], denyOrgs: [], denyRows: [] };
}

/**
 * 把「某主体在 `requested` 上、做 `action` 的全部策略行」编译成可见集合计划。
 *
 * 规则:① `deny` 盖住整个请求(`*` / 裸类型)⇒ 恒假;`deny` 只盖住一部分(某组织 / 某行)⇒ 从可见集合里
 * **减掉**那一部分(`deny` 比 `allow` 强,但不牵连别的行);② 命中的 `allow` 里有 `*` / 裸类型 ⇒ 不限制;
 * ③ 否则组织节点与具体行**取并集** —— 同一个人的多条授权天然是并集(借调就是多一条),
 * 这也正是"跨轴"不需要额外设计的原因。
 */
export function compileScopePlan(rules: readonly PolicyRule[], requested: string, action: string): ScopePlan {
	const orgs = new Set<string>();
	const rows = new Set<string>();
	const denyOrgs = new Set<string>();
	const denyRows = new Set<string>();
	let unrestricted = false;
	for (const rule of rules) {
		if (!matchesAction(rule.act, action)) continue;
		if (!resourceUnder(requested, rule.obj)) continue;
		const ref = parseResource(rule.obj);
		if (!ref) continue;
		if (rule.eft === "deny") {
			if (ref.kind === "all" || ref.kind === "type") return deniedPlan();
			if (ref.kind === "org") denyOrgs.add(ref.id);
			else denyRows.add(ref.id);
			continue;
		}
		if (rule.eft !== "allow") continue;
		if (ref.kind === "all" || ref.kind === "type") unrestricted = true;
		else if (ref.kind === "org") orgs.add(ref.id);
		else rows.add(ref.id);
	}
	return {
		unrestricted,
		denied: false,
		orgs: [...orgs].sort(),
		rows: [...rows].sort(),
		denyOrgs: [...denyOrgs].sort(),
		denyRows: [...denyRows].sort(),
	};
}

// ===========================================================================
// 视图类型 —— 服务端算完、界面只负责画。
//
// 放这里的唯一理由:**界面要引**。`lib/data-policy.ts` 会 import `#/db` 与 casbin,
// 客户端组件一旦(哪怕是无意地)把它拖进浏览器包,`typecheck` / `build` 全绿、只有页面白屏
// (`doc/已知陷阱.md` 记过这条)。所以凡是客户端要看的数据形状,一律落在 `-spec.ts`。
// ===========================================================================

/** 资源范围种类:全部 / 整类型 / 组织及以下 / 具体行(主体种类见文件开头的 `POLICY_SUBJECT_KINDS`) */
type PolicyResourceKind = "all" | PolicyScopeKind;

/** 台账页一行(= 一条规则),id 与串都已经翻译成人话 */
export type PolicyRowView = {
	id: string;
	subjectKind: PolicySubjectKind;
	subjectId: string | null;
	subjectRaw: string;
	subjectLabel: string;
	resourceKind: PolicyResourceKind;
	resourceType: string | null;
	resourceId: string | null;
	resourceRaw: string;
	/** 资源类型名(`全部资源` / `网格履职` / `用户`) */
	resourceTypeLabel: string;
	/** 范围补充(`七宝镇网格组` / `××网格(七宝镇)`;整类型 / 全部资源时为空串) */
	resourceDetail: string;
	action: string;
	effect: PolicyEffect;
	status: number;
	remark: string;
	createdAt: string | null;
	updatedAt: string | null;
};

/** 「谁能看到什么」解释器的出参 */
export type PolicyExplain = {
	user: { id: string; name: string } | null;
	/** 策略表里有没有启用中的规则(没有 = 数据权限未启用,一律不过滤) */
	configured: boolean;
	/** 这个人的主体集合 + 每个主体的来由 */
	subjects: { raw: string; kind: PolicySubjectKind; id: string | null; label: string; why: string }[];
	/** 命中主体的**全部**规则(判定只认 Casbin,备注只是配给人看的) */
	rules: { sub: string; obj: string; act: string; eft: string; remark: string }[];
	/** 每个已登记资源类型编译出来的范围 + **实测**条数 */
	resources: {
		resourceType: string;
		label: string;
		/** 判定链结论:有没有任何主体被允许读这个类型 */
		allowed: boolean;
		unrestricted: boolean;
		denied: boolean;
		orgs: { id: string; label: string }[];
		rows: { id: string; label: string }[];
		denyOrgs: { id: string; label: string }[];
		denyRows: { id: string; label: string }[];
		visibleCount: number;
		totalCount: number;
	}[];
};

/** 主体系列的人话(与 `parseSubject` 的分支一一对应) */
export const SUBJECT_KIND_LABEL: Record<PolicySubjectKind, string> = {
	all: "所有人",
	user: "用户",
	role: "角色",
	dept: "部门",
};

/** 资源范围系列的人话(与 `parseResource` 的分支一一对应) */
export const RESOURCE_KIND_LABEL: Record<PolicyResourceKind, string> = {
	all: "全部资源",
	type: "整类资源",
	org: "该组织及以下",
	row: "具体某行",
};

/** 动作的人话 */
export const ACTION_LABEL: Record<string, string> = {
	read: "只读",
	write: "可写",
	"*": "读写",
};

/** 效果的人话 */
export const EFFECT_LABEL: Record<PolicyEffect, string> = {
	allow: "允许",
	deny: "拒绝",
};
