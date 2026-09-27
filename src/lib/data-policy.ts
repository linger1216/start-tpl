/**
 * 行级数据权限的**引擎** —— Casbin 判决策 + 把命中的规则编译成能塞进 `where(...)` 的 SQL 条件。只在服务端跑。
 *
 * 分工:`data-policy-spec.ts` 是纯逻辑(主体 / 资源怎么写、合不合法、规则编译成可见集合),客户端也能引;
 * 本文件碰库 —— 读 `sys_data_policy` 灌进 Casbin、把可见集合落成 SQL。
 *
 * 三条纪律(改这里之前先读):
 * 1. **判决策只有 Casbin**。`enforce()` 说不放行就是不放行,不许在旁边另写一套 `if` 判断;
 * 2. **判决策与编译同源**:matcher 里的 `resourceUnder` 与编译时的 `parseResource` 是同一个函数,
 *    不会出现"Casbin 放行、SQL 却筛成空集"这种两处打架;
 * 3. **失败关闭**:认不出人 / 有策略但一条都没命中 ⇒ `1 = 0`,绝不是"不过滤"。
 *
 * 唯一的例外是**策略表一条启用规则都没有**:那时整套数据权限视为未启用,一律不过滤 ——
 * 与「`sys_role_menu` 空 = 菜单不启用」同一个口径(空表 = 这项能力没开)。
 */

import { type Adapter, Enforcer, type Model, newModelFromString } from "casbin";
import { type AnyColumn, and, eq, inArray, notInArray, type SQL, sql } from "drizzle-orm";

import { db } from "#/db";
import { sysDataPolicy, sysDemoGrid, sysDept, sysRole, sysUser, sysUserDept } from "#/db/data-base-schema";
import {
	compileScopePlan,
	POLICY_RESOURCES,
	POLICY_SCOPE_KINDS,
	POLICY_SUBJECT_KINDS,
	type PolicyAction,
	type PolicyExplain,
	type PolicyRowView,
	type PolicyRule,
	type PolicySubjectKind,
	parseResource,
	parseSubject,
	policyRuleProblem,
	RESOURCE_UNDER_FN,
	resourceUnder,
	type ScopePlan,
	WHOLE_TYPE_DENY_FN,
	wholeTypeDeny,
} from "#/lib/data-policy-spec";
import { newId } from "#/lib/ids";
import { logger } from "#/lib/logger";
import { enabledRolesOf } from "#/lib/rbac";
import { collectAncestorIds, collectDescendantIds } from "#/lib/tree";

/**
 * Casbin 模型。`p` 的四段就是 `sys_data_policy` 的 `v0..v3`。
 *
 * 为什么 matcher 里不写 `eft`:"允许"与"拒绝"怎么裁决统一交给 `[policy_effect]`
 * (`some allow && !some deny`),这样「`deny` 一票否决」全站只有一处定义。
 */
const MODEL = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act, eft

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = (r.sub == p.sub || p.sub == "*") && ${RESOURCE_UNDER_FN}(r.obj, p.obj) && (r.act == p.act || p.act == "*") && (p.eft != "deny" || ${WHOLE_TYPE_DENY_FN}(p.obj))
`;

/**
 * 资源类型 → **物理落点 + 数条数**。
 *
 * 新增一个资源类型只需要动这一处(名字还要在 `lib/data-policy-spec.ts` 的 `POLICY_RESOURCES` 里登记,
 * `tests/data-policy.test.ts` 守着两边一一对应)。
 *
 * 「组织归属」在库里有两种形态,必须分开表达:
 * - 行上有组织列(网格的 `group_id`)⇒ 直接 `列 in (组织子树)`;
 * - 组织归属是多对多(用户 ↔ `sys_user_dept`)⇒ 走子查询。
 * 没有 `orgColumn` 就是后者 —— 不要把用户表凑一个假列出来。
 */
const RESOURCE_TABLES: Record<
	string,
	{
		rowId: AnyColumn;
		orgColumn?: AnyColumn;
		/** 按一条 where 数「能看到几条」—— 解释器要报「实测可见 / 一共几条」 */
		count: (where: SQL | undefined) => Promise<number>;
	}
> = {
	demo_grid: {
		rowId: sysDemoGrid.id,
		orgColumn: sysDemoGrid.group_id,
		count: async (where) => {
			const [row] = await db.select({ n: sql<number>`count(*)` }).from(sysDemoGrid).where(where);
			return Number(row?.n ?? 0);
		},
	},
	sys_user: {
		rowId: sysUser.id,
		count: async (where) => {
			const [row] = await db.select({ n: sql<number>`count(*)` }).from(sysUser).where(where);
			return Number(row?.n ?? 0);
		},
	},
};

/**
 * 已登记资源类型的名字 —— 必须与 `lib/data-policy-spec.ts` 的 `POLICY_RESOURCES` 一一对应
 * (测试守:少一边,策略行就会被当成非法静默忽略)。
 */
export const REGISTERED_RESOURCE_TYPES: readonly string[] = Object.keys(RESOURCE_TABLES);

const READONLY_ERROR = "sys_data_policy 是只读的:策略只由脚本 / 迁移 / 指派流程维护";

/**
 * **只读适配器**:`loadPolicy` 把启用中的策略行灌进模型,四个写方法一律抛错。
 *
 * 为什么写方法要抛错而不是空实现:Casbin 自己从不调它们(我们不接它的自动持久化),
 * 但哪天有人调了,抛错立刻炸出来;空实现只会让"以为写进去了"的改动静默失效。
 * 策略真正的写入口就三个,都是显式的:迁移脚本 / 维护脚本 / 指派负责人(`grantRow`、`revokeRow`)。
 */
class PolicyTableAdapter implements Adapter {
	/** 装进来的启用行数 —— 同时是「数据权限是否启用」的判据(空表 = 没启用) */
	loaded = 0;

	async loadPolicy(model: Model): Promise<void> {
		const rows = await db
			.select({
				ptype: sysDataPolicy.ptype,
				sub: sysDataPolicy.v0,
				obj: sysDataPolicy.v1,
				act: sysDataPolicy.v2,
				eft: sysDataPolicy.v3,
			})
			.from(sysDataPolicy)
			.where(eq(sysDataPolicy.status, 1));
		this.loaded = rows.length;
		let skipped = 0;
		for (const row of rows) {
			const rule: PolicyRule = { sub: row.sub, obj: row.obj, act: row.act, eft: row.eft };
			const problem = policyRuleProblem(rule);
			if (problem) {
				// 脏数据一律当"不存在":告警但不装载 —— 宁可少授权,不可多授权
				skipped += 1;
				logger.warn("policy.rule_invalid", { sub: rule.sub, obj: rule.obj, act: rule.act, eft: rule.eft, problem });
				continue;
			}
			model.addPolicy("p", row.ptype, [rule.sub, rule.obj, rule.act, rule.eft]);
		}
		// 「我明明配了却看不到」的第一个排查点:装载了这一行吗、有没有被当成非法跳过
		logger.debug("policy.load", { enabled: rows.length, loaded: rows.length - skipped, skipped });
	}

	async savePolicy(): Promise<boolean> {
		throw new Error(READONLY_ERROR);
	}

	async addPolicy(): Promise<void> {
		throw new Error(READONLY_ERROR);
	}

	async removePolicy(): Promise<void> {
		throw new Error(READONLY_ERROR);
	}

	async removeFilteredPolicy(): Promise<void> {
		throw new Error(READONLY_ERROR);
	}
}

/** 策略很少动,缓存 30 秒(与 `lib/sys-para.ts` 的 `getParaMap` 同一手法) */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; enforcer: Enforcer; configured: boolean } | null = null;

async function engineOf(force = false): Promise<{ enforcer: Enforcer; configured: boolean }> {
	if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
	const adapter = new PolicyTableAdapter();
	const enforcer = new Enforcer();
	// 传了 adapter 且非 lazy ⇒ `initWithModelAndAdapter` 内部就会 `loadPolicy()`,不用自己再调
	await enforcer.initWithModelAndAdapter(newModelFromString(MODEL), adapter);
	await enforcer.addFunction(RESOURCE_UNDER_FN, (requested: string, policyObj: string) =>
		resourceUnder(requested, policyObj),
	);
	await enforcer.addFunction(WHOLE_TYPE_DENY_FN, (policyObj: string) => wholeTypeDeny(policyObj));
	cache = { at: Date.now(), enforcer, configured: adapter.loaded > 0 };
	return cache;
}

/** 策略写完(迁移 / 指派 / 维护脚本)立刻生效,不必干等 30 秒 */
export function clearDataPolicyCache(): void {
	cache = null;
}

/** 主体 + 「为什么这个人算这个主体」—— 判定与台账页的解释器共用同一份计算,免得两处口径打架 */
type PolicySubjectDetail = {
	/** 策略里写的原样串(`*` / `user:<id>` / `role:<code>` / `dept:<id>`) */
	raw: string;
	kind: PolicySubjectKind;
	id: string | null;
	/** 界面用的一句话解释(不查库,只按来源说) */
	why: string;
};

/**
 * 这个用户**可能命中**的主体串:授给每个人的、授给他角色(`role:<code>`)的、
 * 授给他所在部门(`dept:<节点>`)的,外加 `*`。
 *
 * 部门为什么要把**祖先**也算上:策略里写的是「七宝镇」,而人挂在更深的「七宝镇网格组」上,
 * `dept:<节点>` 的语义是**该节点及其以下的人**,所以祖先节点的规则必须能被这个人命中。
 */
async function subjectDetailsOf(userId: string): Promise<PolicySubjectDetail[]> {
	const [roles, mine] = await Promise.all([
		enabledRolesOf(userId),
		db.select({ id: sysUserDept.department_id }).from(sysUserDept).where(eq(sysUserDept.user_id, userId)),
	]);
	const ownIds = mine.map((row) => row.id);
	const details: PolicySubjectDetail[] = [
		{ raw: "*", kind: "all", id: null, why: "通配:写 `*` 的规则对所有人成立" },
		{ raw: `user:${userId}`, kind: "user", id: userId, why: "本人:直接授给这个账号的规则" },
	];
	for (const role of roles) {
		details.push({ raw: `role:${role.code}`, kind: "role", id: role.code, why: `启用中的角色「${role.code}」` });
	}
	for (const id of ownIds) {
		details.push({ raw: `dept:${id}`, kind: "dept", id, why: "编制部门:这个部门的人(含以下)都适用" });
	}
	if (ownIds.length > 0) {
		const rows = await db.select({ id: sysDept.id, parentId: sysDept.parent_id }).from(sysDept);
		for (const id of collectAncestorIds(rows, ownIds)) {
			details.push({ raw: `dept:${id}`, kind: "dept", id, why: "编制部门的上级:部门规则对本部门及以下的人生效" });
		}
	}
	// 一个人挂多个部门时,某个部门可能是另一个的祖先 ⇒ 按主体串去重(顺序按来源保留)
	return [...new Map(details.map((item) => [item.raw, item])).values()];
}

/** Casbin 问一遍:这些主体里有任何一个被放行吗(主体之间是**并集**,一个放行就够) */
async function someSubjectAllowed(
	enforcer: Enforcer,
	subjects: readonly string[],
	resourceType: string,
	action: PolicyAction,
): Promise<boolean> {
	const verdicts = await Promise.all(subjects.map((sub) => enforcer.enforce(sub, resourceType, action)));
	return verdicts.some(Boolean);
}

/** 取命中的**全部**规则 —— 一个队员可能有多条按行授权,少取一条他就少看一条 */
async function rulesOf(enforcer: Enforcer, subjects: readonly string[]): Promise<PolicyRule[]> {
	const groups = await Promise.all(subjects.map((sub) => enforcer.getFilteredPolicy(0, sub)));
	return groups
		.flat()
		.map((rule) => ({ sub: rule[0] ?? "", obj: rule[1] ?? "", act: rule[2] ?? "", eft: rule[3] ?? "" }));
}

/**
 * 行级数据权限的**唯一入口**:给出一条能直接塞进 `where(...)` 的条件。
 *
 * 返回 `undefined` = **不加条件**,只有三种情形:① 没有用户上下文(脚本 / 后台任务);
 * ② 这个资源类型没登记;③ 策略表一条启用规则都没有(数据权限未启用)。
 * 其余一律失败关闭:认不出人 / 有策略但一条没命中 ⇒ `1 = 0`。
 */
export async function dataScopeWhere(
	userId: string | null,
	resourceType: string,
	action: PolicyAction,
): Promise<SQL | undefined> {
	if (!userId) return undefined;
	if (!Object.hasOwn(RESOURCE_TABLES, resourceType)) return undefined;
	const { enforcer, configured } = await engineOf();
	if (!configured) {
		// 空表 = 这项能力没开 —— 排查"为什么没过滤"时先看这一条
		logger.debug("policy.disabled", { userId, resourceType, action });
		return undefined;
	}

	const subjects = (await subjectDetailsOf(userId)).map((item) => item.raw);
	if (!(await someSubjectAllowed(enforcer, subjects, resourceType, action))) {
		// 失败关闭:认不出人 / 有策略但一条都没命中 —— 这是"明明有权限却什么都看不到"的元凶
		logger.debug("policy.denied", { userId, resourceType, action, subjects });
		return sql`1 = 0`;
	}
	const plan = compileScopePlan(await rulesOf(enforcer, subjects), resourceType, action);
	logger.debug("policy.scope", {
		userId,
		resourceType,
		action,
		unrestricted: plan.unrestricted,
		orgs: plan.orgs,
		rows: plan.rows,
		denyOrgs: plan.denyOrgs,
		denyRows: plan.denyRows,
	});
	return scopeSql(resourceType, plan);
}

/** 把编译出来的可见集合落成 SQL:组织节点现展开成子树,与具体行**取并集**;`deny` 的部分用排除法减掉 */
async function scopeSql(resourceType: string, plan: ScopePlan): Promise<SQL | undefined> {
	if (plan.denied) return sql`1 = 0`;
	const target = RESOURCE_TABLES[resourceType];
	if (!target) return undefined;

	/** 「属于这些组织」:有组织列就直接比,没有的(用户)走 `sys_user_dept` 子查询 */
	const inOrgs = (ids: string[]): SQL =>
		target.orgColumn
			? inArray(target.orgColumn, ids)
			: inArray(
					target.rowId,
					db.select({ id: sysUserDept.user_id }).from(sysUserDept).where(inArray(sysUserDept.department_id, ids)),
				);

	const positive: SQL[] = [];
	if (!plan.unrestricted) {
		if (plan.rows.length > 0) positive.push(inArray(target.rowId, [...plan.rows]));
		if (plan.orgs.length > 0) {
			const rows = await db.select({ id: sysDept.id, parentId: sysDept.parent_id }).from(sysDept);
			const ids = collectDescendantIds(rows, plan.orgs);
			if (ids.length > 0) positive.push(inOrgs(ids));
		}
	}
	// 一条 allow 都没有 ⇒ 恒假(不受限的走 `plan.unrestricted`,不会落到这里)
	if (!plan.unrestricted && positive.length === 0) return sql`1 = 0`;

	const negative: SQL[] = [];
	if (plan.denyRows.length > 0) negative.push(notInArray(target.rowId, [...plan.denyRows]));
	if (plan.denyOrgs.length > 0) {
		const rows = await db.select({ id: sysDept.id, parentId: sysDept.parent_id }).from(sysDept);
		const ids = collectDescendantIds(rows, plan.denyOrgs);
		if (ids.length > 0) {
			if (target.orgColumn) {
				// NULL 的组织列("还没归属"的行)不在任何被 deny 的子树里,而 `not in` 遇上 NULL 走三值逻辑
				// 会把这些行一起排掉 —— 显式放它们过去
				const list = sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `,
				);
				negative.push(sql`(${target.orgColumn} is null or ${target.orgColumn} not in (${list}))`);
			} else {
				negative.push(
					notInArray(
						target.rowId,
						db.select({ id: sysUserDept.user_id }).from(sysUserDept).where(inArray(sysUserDept.department_id, ids)),
					),
				);
			}
		}
	}

	if (negative.length === 0) {
		if (positive.length === 0) return undefined; // 不受限、也没有否定 ⇒ 这次查询不加条件
		return positive.length === 1 ? positive[0] : sql`(${sql.join(positive, sql` or `)})`;
	}
	const negativeSql = negative.length === 1 ? negative[0] : sql`(${sql.join(negative, sql` and `)})`;
	if (positive.length === 0) return negativeSql;
	// 用 `sql.join` 而不是 `or(...)`:后者返回 `SQL | undefined`,会逼出非空断言(新增 lint warning)
	const positiveSql = positive.length === 1 ? positive[0] : sql`(${sql.join(positive, sql` or `)})`;
	return sql`(${positiveSql}) and ${negativeSql}`;
}

/**
 * 写 / 复启一行策略(幂等:唯一键就是 `v0 + v1 + v2`)。
 *
 * 先查再插 / 再改,而不是 `on duplicate key update` —— 那是 MySQL 方言,达梦不认。
 */
async function upsertPolicy(v0: string, v1: string, v2: string, v3: string, remark: string): Promise<void> {
	const [existing] = await db
		.select({ id: sysDataPolicy.id })
		.from(sysDataPolicy)
		.where(and(eq(sysDataPolicy.v0, v0), eq(sysDataPolicy.v1, v1), eq(sysDataPolicy.v2, v2)))
		.limit(1);
	const now = new Date();
	if (existing) {
		// 复启时连效果 / 备注一起改回来(被 deny 过的那行,重新授权要能变回 allow)
		await db
			.update(sysDataPolicy)
			.set({ status: 1, v3, remark, update_time: now })
			.where(eq(sysDataPolicy.id, existing.id));
	} else {
		await db
			.insert(sysDataPolicy)
			.values({ id: newId(), ptype: "p", v0, v1, v2, v3, status: 1, remark, create_time: now, update_time: now });
	}
	clearDataPolicyCache();
}

/**
 * 授权一条规则 —— `grantRow` / `grantOrg` 与迁移脚本的公共底座。
 *
 * **写之前按同一套解析规则校验一遍**(`policyRuleProblem`):写进去的行要是引擎认不出来的,
 * 那份授权会**静默失效**(装载时按"不合法"跳过),到时候"明明配了却看不到"最难查。
 */
export async function grantRule(sub: string, obj: string, act = "*", remark = "手工授权"): Promise<void> {
	const problem = policyRuleProblem({ sub, obj, act, eft: "allow" });
	if (problem) throw new Error(`策略不合法(${problem}):${sub} → ${obj}`);
	await upsertPolicy(sub, obj, act, "allow", remark);
	logger.info("policy.grant", { sub, obj, act, remark });
}

/**
 * **只补不覆盖**地登记一条规则 —— 基线种子脚本与「系统设置 ▸ 数据权限」页的"新增"都走它。
 *
 * 与 `grantRule` 的区别:已经存在的行原样留着(备注、乃至被手工改成 `deny` 的效果都不动),
 * 所以重复跑种子不会把「迁移:…」这类出处备注冲掉。返回是否真的插了新行,好让调用方报数。
 *
 * `eft` 默认 `allow`(种子 / 迁移都只发 allow);`deny` 是减法规则,由管理页显式写入。
 */
export async function ensureRule(
	sub: string,
	obj: string,
	act = "*",
	remark = "基线策略",
	eft: "allow" | "deny" = "allow",
): Promise<boolean> {
	const problem = policyRuleProblem({ sub, obj, act, eft });
	if (problem) throw new Error(`策略不合法(${problem}):${sub} → ${obj}`);
	const [existing] = await db
		.select({ id: sysDataPolicy.id })
		.from(sysDataPolicy)
		.where(and(eq(sysDataPolicy.v0, sub), eq(sysDataPolicy.v1, obj), eq(sysDataPolicy.v2, act)))
		.limit(1);
	if (existing) return false;
	const now = new Date();
	await db.insert(sysDataPolicy).values({
		id: newId(),
		ptype: "p",
		v0: sub,
		v1: obj,
		v2: act,
		v3: eft,
		status: 1,
		remark,
		create_time: now,
		update_time: now,
	});
	clearDataPolicyCache();
	logger.info("policy.ensure", { sub, obj, act, eft, remark });
	return true;
}

/**
 * 给某个人**按行**授权 —— 指派负责人时调。
 *
 * 为什么指派必须顺带写策略:"谁能看这一条"现在由策略表说了算,只改 `demo_grid.owner_id`
 * 而不写策略,负责人自己反而看不见自己那条(而 `owner_id` 又得留着:它表达的是"这条归谁办")。
 */
export async function grantRow(ownerId: string, resourceType: string, rowId: string): Promise<void> {
	await grantRule(`user:${ownerId}`, `${resourceType}@${rowId}`, "*", "指派负责人自动授权");
}

/**
 * 给某个人**按组织**授权(这个节点**及其以下**,层级现算) —— 迁移旧的「本部门及以下」档位、
 * 以及「借调」给他再加一个范围,都走它。
 */
export async function grantOrg(userId: string, resourceType: string, deptId: string): Promise<void> {
	await grantRule(`user:${userId}`, `${resourceType}@org:${deptId}`, "*", "按组织授权");
}

/**
 * 这个人被删掉了(或不再需要授权):把他名下的授权一并清掉。
 *
 * 只删 `user:<他>` 这些行 —— 部门规则(`dept:<节点>`)与角色规则(`role:<code>`)说的是"那个部门 / 那个角色",
 * 换个人仍然成立,不该跟着走。
 */
export async function revokeUser(userId: string): Promise<void> {
	await db.delete(sysDataPolicy).where(eq(sysDataPolicy.v0, `user:${userId}`));
	clearDataPolicyCache();
	logger.info("policy.revoke_user", { userId });
}

/** 一批行被删掉时,把它们身上**所有**授权一并清掉(不管是授给谁的) */
export async function revokeRows(resourceType: string, rowIds: readonly string[]): Promise<void> {
	if (rowIds.length === 0) return;
	await db.delete(sysDataPolicy).where(
		inArray(
			sysDataPolicy.v1,
			rowIds.map((id) => `${resourceType}@${id}`),
		),
	);
	clearDataPolicyCache();
	logger.info("policy.revoke_rows", { resourceType, count: rowIds.length });
}
export async function revokeRow(ownerId: string, resourceType: string, rowId: string): Promise<void> {
	await db
		.delete(sysDataPolicy)
		.where(
			and(
				eq(sysDataPolicy.v0, `user:${ownerId}`),
				eq(sysDataPolicy.v1, `${resourceType}@${rowId}`),
				eq(sysDataPolicy.v2, "*"),
			),
		);
	clearDataPolicyCache();
	logger.info("policy.revoke_row", { ownerId, resourceType, rowId });
}

/* ------------------------------------------------------------------ *
 * 「系统设置 ▸ 数据权限」页要用的两件事:台账要显示名,解释器要实测条数
 * ------------------------------------------------------------------ */

/** id → 人话。角色表 / 用户表 / 部门树 / 网格表都很小(角色 12 · 账号 38 · 部门 3700 · 网格 71),一次全量读,与 `department.tree` 同口径 */
type PolicyLabelMaps = {
	/** 角色 code → 角色名 */
	roles: Map<string, string>;
	/** 用户 id → 姓名 */
	users: Map<string, string>;
	/** 部门 id → 名字(同名节点补父名,免得「网格组」重名分不清) */
	depts: Map<string, string>;
	/** 资源类型 → (行 id → 名字) */
	rows: Record<string, Map<string, string>>;
};

async function labelMapsOf(): Promise<PolicyLabelMaps> {
	const [roleRows, userRows, deptRows, gridRows] = await Promise.all([
		db.select({ code: sysRole.code, name: sysRole.name }).from(sysRole),
		db.select({ id: sysUser.id, name: sysUser.name, email: sysUser.email }).from(sysUser),
		db.select({ id: sysDept.id, name: sysDept.name, parentId: sysDept.parent_id }).from(sysDept),
		db.select({ id: sysDemoGrid.id, name: sysDemoGrid.name, townName: sysDemoGrid.town_name }).from(sysDemoGrid),
	]);

	const roles = new Map(roleRows.map((row) => [row.code, row.name || row.code]));
	const users = new Map(userRows.map((row) => [row.id, row.name || row.email || row.id]));
	const nameById = new Map(deptRows.map((row) => [row.id, row.name]));
	const sameName = new Map<string, number>();
	for (const row of deptRows) sameName.set(row.name, (sameName.get(row.name) ?? 0) + 1);
	const depts = new Map(
		deptRows.map((row) => {
			const parent = row.parentId ? nameById.get(row.parentId) : null;
			const label = (sameName.get(row.name) ?? 0) > 1 && parent ? `${parent} / ${row.name}` : row.name;
			return [row.id, label];
		}),
	);
	const grids = new Map(gridRows.map((row) => [row.id, row.townName ? `${row.name}(${row.townName})` : row.name]));

	return { roles, users, depts, rows: { demo_grid: grids, sys_user: users } };
}

/**
 * 主体 → 人话(台账与解释器共用这一份,免得两处口径打架)。
 *
 * 查不到就原样回显 id/串:界面的第一职责是让人**看见**库里真有什么 —— 藏起来反而无从查起。
 */
function subjectLabelOf(maps: PolicyLabelMaps, kind: PolicySubjectKind, id: string | null, fallback: string): string {
	if (kind === "all") return "所有人";
	if (kind === "user") return maps.users.get(id ?? "") ?? id ?? fallback;
	if (kind === "role") return maps.roles.get(id ?? "") ?? id ?? fallback;
	return maps.depts.get(id ?? "") ?? id ?? fallback;
}

/** 范围对象 → 人话(组织取部门名;行取该资源类型的行名表 —— 用户表的"行名"就是姓名表) */
function rowLabelOf(maps: PolicyLabelMaps, resourceType: string, id: string): string {
	return (resourceType === "sys_user" ? maps.users.get(id) : maps.rows[resourceType]?.get(id)) ?? id;
}

/** 台账排序用的次序表 —— 主体直接用 `POLICY_SUBJECT_KINDS`(它就是那个顺序),资源是"全部 + 三种范围" */
const RESOURCE_ORDER = ["all", ...POLICY_SCOPE_KINDS] as const;

/**
 * 台账页的数据源:**全表** + 翻译好的显示名(规则数是几十条量级,直接全量返回,
 * 与其它台账页一样由前端分页,省一套分页接口)。
 *
 * 解析不出来的脏行也照常返回(`subjectKind` 兜底成 `user` 之外的原样串),
 * 理由:界面的第一职责是让人**看见**库里真有什么 —— 藏起来的话,「明明配了却看不到」就无从查起。
 */
export async function listPolicyRows(): Promise<PolicyRowView[]> {
	const [maps, rows] = await Promise.all([labelMapsOf(), db.select().from(sysDataPolicy)]);

	const views = rows.map((row): PolicyRowView => {
		const subject = parseSubject(row.v0);
		const resource = parseResource(row.v1);
		const subjectKind = subject?.kind ?? "user";
		const resourceKind = resource?.kind ?? "row";
		const resourceType = resource && resource.kind !== "all" ? resource.type : null;
		// 两边的判别联合都可能有 `{ kind: "all" }` 这种没有 id 的分支,先把 id 挑出来再用
		const subjectId = subject && subject.kind !== "all" ? subject.id : null;
		const resourceId = resource && (resource.kind === "org" || resource.kind === "row") ? resource.id : null;
		const resourceTypeLabel =
			resourceKind === "all" ? "全部资源" : (POLICY_RESOURCES[resourceType ?? ""]?.label ?? resourceType ?? row.v1);
		const subjectLabel = subjectLabelOf(maps, subjectKind, subjectId, row.v0);

		let resourceDetail = "";
		if (resourceKind === "org") resourceDetail = maps.depts.get(resourceId ?? "") ?? resourceId ?? "";
		else if (resourceKind === "row") resourceDetail = rowLabelOf(maps, resourceType ?? "", resourceId ?? "");

		return {
			id: row.id,
			subjectKind,
			subjectId,
			subjectRaw: row.v0,
			subjectLabel,
			resourceKind,
			resourceType,
			resourceId,
			resourceRaw: row.v1,
			resourceTypeLabel,
			resourceDetail,
			action: row.v2,
			effect: row.v3 === "deny" ? "deny" : "allow",
			status: Number(row.status ?? 1),
			remark: row.remark ?? "",
			createdAt: row.create_time ? row.create_time.toISOString() : null,
			updatedAt: row.update_time ? row.update_time.toISOString() : null,
		};
	});

	const rank = <T extends string>(list: readonly T[], value: string): number => {
		const at = list.indexOf(value as T);
		return at < 0 ? list.length : at;
	};
	return views.sort((a, b) => {
		const bySubject = rank(POLICY_SUBJECT_KINDS, a.subjectKind) - rank(POLICY_SUBJECT_KINDS, b.subjectKind);
		if (bySubject !== 0) return bySubject;
		const byName = a.subjectLabel.localeCompare(b.subjectLabel, "zh-Hans-CN");
		if (byName !== 0) return byName;
		const byType = (a.resourceType ?? "").localeCompare(b.resourceType ?? "");
		if (byType !== 0) return byType;
		const byKind = rank(RESOURCE_ORDER, a.resourceKind) - rank(RESOURCE_ORDER, b.resourceKind);
		if (byKind !== 0) return byKind;
		return a.resourceDetail.localeCompare(b.resourceDetail, "zh-Hans-CN");
	});
}

/**
 * 「谁能看到什么」—— 把 `dataScopeWhere` 的判定链整条摊开:主体集合 → 命中规则 → 编译出的
 * 组织 / 行 / 否定 → **实测条数**。判定本身仍然完全走 `dataScopeWhere` 那条路(同一批函数),
 * 所以界面上看到的数字就是列表接口真会返回的条数。
 */
export async function explainPolicyFor(userId: string): Promise<PolicyExplain | null> {
	const maps = await labelMapsOf();
	const [me] = await db
		.select({ id: sysUser.id, name: sysUser.name, email: sysUser.email })
		.from(sysUser)
		.where(eq(sysUser.id, userId))
		.limit(1);
	if (!me) return null;

	const { enforcer, configured } = await engineOf();
	const details = await subjectDetailsOf(userId);
	const subjects = details.map((item) => item.raw);

	// 备注从库里取(判决策在 Casbin 里,这里只是把 `(v0,v1,v2)` 对上的备注找出来)
	const remarkRows = await db
		.select({ sub: sysDataPolicy.v0, obj: sysDataPolicy.v1, act: sysDataPolicy.v2, remark: sysDataPolicy.remark })
		.from(sysDataPolicy)
		.where(and(eq(sysDataPolicy.status, 1), inArray(sysDataPolicy.v0, subjects)));
	const remarkOf = new Map(remarkRows.map((row) => [`${row.sub}|${row.obj}|${row.act}`, row.remark ?? ""]));

	const realRules = (await rulesOf(enforcer, subjects)).map((rule) => ({
		...rule,
		remark: remarkOf.get(`${rule.sub}|${rule.obj}|${rule.act}`) ?? "",
	}));

	const resources: PolicyExplain["resources"] = [];
	for (const resourceType of REGISTERED_RESOURCE_TYPES) {
		const allowed = await someSubjectAllowed(enforcer, subjects, resourceType, "read");
		const plan = compileScopePlan(realRules, resourceType, "read");
		// 与 `dataScopeWhere` 逐条对齐:未启用 ⇒ 不过滤;启用但没命中 ⇒ 恒假;其余按计划拼条件
		const where = !configured ? undefined : allowed ? await scopeSql(resourceType, plan) : sql`1 = 0`;
		const target = RESOURCE_TABLES[resourceType];
		const totalCount = target ? await target.count(undefined) : 0;
		resources.push({
			resourceType,
			label: POLICY_RESOURCES[resourceType]?.label ?? resourceType,
			allowed,
			unrestricted: plan.unrestricted,
			denied: plan.denied,
			orgs: plan.orgs.map((id) => ({ id, label: maps.depts.get(id) ?? id })),
			rows: plan.rows.map((id) => ({ id, label: rowLabelOf(maps, resourceType, id) })),
			denyOrgs: plan.denyOrgs.map((id) => ({ id, label: maps.depts.get(id) ?? id })),
			denyRows: plan.denyRows.map((id) => ({ id, label: rowLabelOf(maps, resourceType, id) })),
			visibleCount: where ? await (target?.count(where) ?? Promise.resolve(0)) : totalCount,
			totalCount,
		});
	}

	return {
		user: { id: me.id, name: me.name || me.email || me.id },
		configured,
		subjects: details.map((item) => ({
			raw: item.raw,
			kind: item.kind,
			id: item.id,
			label: subjectLabelOf(maps, item.kind, item.id, ""),
			why: item.why,
		})),
		rules: realRules,
		resources,
	};
}
