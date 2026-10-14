/**
 * 数据权限(`sys_data_policy` + `sys_data_plugin`)—— 集成测试。
 *
 * 测的是「规则怎么被翻译成 SQL 条件」这条链:规则表 → 插件取值 → 条件 → 命中行数;
 * 以及三条**失败关闭**的硬规则(插件取不到值 / 规则在但主体没命中 / 插件被删 ⇒ 一行也看不到)。
 *
 * 关键设计被这条用例锁住:`subject` 里**只存 `role:<id>`**,请求时才展开成当前人的角色 ——
 * 所以主体永远不物化,人员变动不需要回填规则。
 *
 * ⚠️ 会读写 `.env.local` 指向的库。造的数据一律 `__test__` 前缀,`after` 里按 id / 标识清干净;
 * 规则用的是 `*`(所有人)主体,所以**必须**按 id 删 —— 不能只靠前缀扫。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import {
	sysCasbinRule,
	sysDataPlugin,
	sysDataPolicy,
	sysDemoGrid,
	sysMenu,
	sysRole,
} from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { addUserRole, clearCasbinCache, setRoleMenus } from "../src/lib/casbin.ts";
import { clearDataScopeCache } from "../src/lib/data-scope.ts";
import {
	BUILTIN_PLUGIN_KEYS,
	clearPluginCache,
	LISTED_BUILTIN_PLUGIN_KEYS,
	loadDeptNodes,
	resolvePluginValues,
	STREET_NAMES,
} from "../src/lib/data-scope-plugins.ts";
import {
	isIdent,
	PLUGIN_ITEM_KEY_MAX,
	PLUGIN_ITEM_VALUE_MAX,
	type PolicyCtx,
	type PolicyDept,
	parseSubject,
	validatePolicyCombo,
} from "../src/lib/data-scope-spec.ts";
import { newId } from "../src/lib/ids.ts";
import { collectDescendantIds } from "../src/lib/tree.ts";
import { assertRejects, caller, callerAs, closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

const SUFFIX = uniqueSuffix();
/** `isIdent` 只认字母/数字/下划线 ⇒ 标识里不能带 `.` */
const PLUGIN_KEY = `${TEST_PREFIX}ds_${SUFFIX}`;

const ruleIds: string[] = [];
const roleIds: string[] = [];
const usersWithRoles: string[] = [];
/** 本文件建过的自定义插件标识 —— 中途断言失败也要能清干净 */
const pluginKeys: string[] = [];

after(async () => {
	for (const id of ruleIds) {
		await db.delete(sysDataPolicy).where(eq(sysDataPolicy.id, id));
	}
	// 兜底:按 `__test__` 前缀扫全表把本文件造的行收成 id —— 删除现在是软删,`plugin_key` 已被
	// `tombstone()` 改成 `...#d#<id 尾段>`,再按 key 查就查不到了(会留一堆软删行)
	const plugins = await db.select({ id: sysDataPlugin.id, pluginKey: sysDataPlugin.plugin_key }).from(sysDataPlugin);
	const pluginIds = plugins.filter((row) => row.pluginKey.includes(TEST_PREFIX)).map((row) => row.id);
	if (pluginIds.length > 0) await db.delete(sysDataPlugin).where(inArray(sysDataPlugin.id, pluginIds));
	const rules = await db.select({ id: sysDataPolicy.id, pluginKey: sysDataPolicy.plugin_key }).from(sysDataPolicy);
	const staleRuleIds = rules.filter((row) => (row.pluginKey ?? "").includes(TEST_PREFIX)).map((row) => row.id);
	if (staleRuleIds.length > 0) await db.delete(sysDataPolicy).where(inArray(sysDataPolicy.id, staleRuleIds));
	// 没被软删过的那几个(用例中途失败时)按原始 key 直接清
	for (const pluginKey of pluginKeys) {
		await db.delete(sysDataPlugin).where(eq(sysDataPlugin.plugin_key, pluginKey));
	}

	for (const id of usersWithRoles) {
		await db.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, "g"), eq(sysCasbinRule.v0, `user:${id}`)));
	}
	for (const id of roleIds) {
		await db.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, "g"), eq(sysCasbinRule.v1, `role:${id}`)));
		await db.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, "p"), eq(sysCasbinRule.v0, `role:${id}`)));
		await db.delete(sysRole).where(eq(sysRole.id, id));
	}
	clearCasbinCache();
	clearDataScopeCache();
	clearPluginCache();
	await closeDb();
});

/**
 * 建一条规则并记账(所有路径都必须能删干净)。
 *
 * **默认给 `status: 1`(上线)** —— router 里新建落下的是「启用」(2,引擎不加载),
 * 而这些用例测的是"规则怎么被翻译成 SQL",要的就是它立刻生效;测状态流转的用例自己显式传。
 */
async function createRule(input: Parameters<typeof caller.dataScope.create>[0]): Promise<string> {
	const { id } = await caller.dataScope.create({ status: 1, ...input });
	ruleIds.push(id);
	return id;
}

/**
 * 把本文件先前建的规则全删掉。
 *
 * **多条规则是「或」关系**(命中任意一条就可见),所以用例之间必须互不影响 ——
 * 否则上一条用例留下的「整类可见」会把这一条的 `visible` 顶回全表,断言就变成假的。
 */
async function resetRules(): Promise<void> {
	if (ruleIds.length === 0) return;
	for (const id of [...ruleIds]) {
		await db.delete(sysDataPolicy).where(eq(sysDataPolicy.id, id));
	}
	ruleIds.length = 0;
	clearDataScopeCache();
}

// ───────────────────────────── 纯规格层(不碰库) ─────────────────────────────

test("规格:规则组合校验(m18228 后只剩两种合法形态)", () => {
	// ① 什么也不填 = 整类可见
	assert.equal(validatePolicyCombo({ column: null, pluginKey: null }), null);
	// 不填插件却填了列 ⇒ 拒(否则人会以为"列 + 空插件"能筛出什么来)
	assert.match(validatePolicyCombo({ column: "town_id", pluginKey: null }) ?? "", /没选插件/);
	// ② 填了插件 ⇒ 必须选列
	assert.match(validatePolicyCombo({ column: null, pluginKey: "self" }) ?? "", /必须选一个列/);
	assert.equal(validatePolicyCombo({ column: "town_id", pluginKey: "self" }), null);
});

test("规格:主体写法解析,`up:` 这类 v0 写法必须不再被识别", () => {
	assert.deepEqual(parseSubject("*"), { kind: "all" });
	assert.deepEqual(parseSubject("role:r1"), { kind: "role", id: "r1" });
	assert.deepEqual(parseSubject("dept:d1"), { kind: "dept", id: "d1" });
	assert.deepEqual(parseSubject("user:u1"), { kind: "user", id: "u1" });
	assert.equal(parseSubject("up:1"), null, "v0 的 up: 语法已整体删除,不能再解析出来");
	assert.equal(parseSubject("role:"), null, "空的 id 不算主体");
	assert.equal(parseSubject("role"), null, "没有冒号就不是主体");
});

test("规格:表名 / 列名要拼进 SQL,所以只认标识符形状", () => {
	assert.equal(isIdent("demo_grid"), true);
	assert.equal(isIdent("_x1"), true);
	assert.equal(isIdent("1abc"), false, "不能以数字开头");
	assert.equal(isIdent("a.b"), false, "带点的限定名不放行");
	assert.equal(isIdent("a`b"), false);
	assert.equal(isIdent("数据表"), false, "中文表名不放行(要拼 SQL)");
});

// ───────────────────────────── 元数据 / 插件清单 ─────────────────────────────

test("资源元数据:主键从 information_schema 读,列带中文名", async () => {
	const list = await caller.dataScope.resources();
	const grid = list.find((item) => item.table === "demo_grid");
	assert.ok(grid, "demo_grid 应该出现在资源清单里");

	assert.equal(grid.pk, "id", "主键应来自 column_key = PRI,而不是登记表里填的");
	const columns = grid.columns.map((item) => item.column);
	for (const column of ["town_id", "owner_id"]) {
		assert.ok(columns.includes(column), `demo_grid.${column} 应该在列清单里`);
	}
	// m24215:下拉只展示业务表 —— sys_* 系统表不应出现在资源清单里
	assert.ok(
		list.every((item) => !item.table.startsWith("sys_")),
		"sys_* 表不应进入下拉,但引擎按 tag 路径解析历史规则时仍然能拿到它们",
	);
});

test("插件清单:内置排在前面、界面上是只读的,兜底插件不出现", async () => {
	const plugins = await caller.dataScope.plugins();
	const keys = plugins.map((item) => item.key);
	for (const key of LISTED_BUILTIN_PLUGIN_KEYS) {
		assert.ok(keys.includes(key), `内置插件 ${key} 必须在清单里`);
	}
	const builtin = plugins.filter((item) => item.impl === "builtin");
	assert.equal(builtin.length, LISTED_BUILTIN_PLUGIN_KEYS.length, "内置插件个数应与代码里写死的一致");

	// m18652:`fixed` 是兜底(恒返空),且**可选清单里不该出现** —— 否则用户会选中一个永远看不到数据的插件
	assert.ok(BUILTIN_PLUGIN_KEYS.includes("fixed"), "`fixed` 仍是保留 key(挡用户建同名插件)");
	assert.ok(!keys.includes("fixed"), "`fixed` 是兜底,不能出现在可选清单里");

	const list = await caller.dataPlugin.list();
	assert.equal(list.builtin.length, LISTED_BUILTIN_PLUGIN_KEYS.length);
	assert.ok(
		list.builtin.every((item) => !("resolve" in item)),
		"接口不能把 resolve 函数序列化出去",
	);
});

// ───────────────────────────── 规则 → 条件 → 命中行数 ─────────────────────────────

test("给值插件 + 固定清单:预览命中行数与手算一致", async () => {
	await resetRules();
	const total = Number((await db.select({ n: sql<number>`count(*)` }).from(sysDemoGrid))[0]?.n ?? 0);
	assert.ok(total > 0, "前置条件:demo_grid 里得有数据");

	// 取两个真实的 town_id 当参数(用真值才测得出"条件真的下推到了 SQL")
	const towns = await db
		.select({ town: sysDemoGrid.town_id, n: sql<number>`count(*)` })
		.from(sysDemoGrid)
		.where(isNotNull(sysDemoGrid.town_id))
		.groupBy(sysDemoGrid.town_id)
		.orderBy(desc(sql`count(*)`))
		.limit(2);
	const params = towns.map((row) => row.town).filter((town): town is string => Boolean(town));
	assert.ok(params.length > 0, "前置条件:demo_grid.town_id 得有非空值");

	const expected = Number(
		(await db.select({ n: sql<number>`count(*)` }).from(sysDemoGrid).where(inArray(sysDemoGrid.town_id, params)))[0]
			?.n ?? 0,
	);

	// m20034 (v2):「输出值」装在插件上 —— 先建一个固定清单类用户自建插件,outputValues 是那两个 town_id,
	// 然后规则引用它。内置 `fixed` 现在是空数组(兜底,不让用户直接用)。
	const fixedPluginKey = `${TEST_PREFIX}ds_fixed_${SUFFIX}`;
	await caller.dataPlugin.create({
		pluginKey: fixedPluginKey,
		label: "测试用:固定清单",
		outputValues: params.map((town) => ({ key: "town_id", value: town })),
	});
	pluginKeys.push(fixedPluginKey);

	await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		pluginKey: fixedPluginKey,
		remark: "测试用:固定清单",
	});

	const preview = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.equal(preview.total, total, "总数是这张表的行数");
	assert.equal(preview.visible, expected, "命中行数必须等于 town_id in (...) 的手算值");
	assert.ok(preview.visible < preview.total, "只放开两个街镇 ⇒ 一定要比总数少");
	assert.ok(preview.condition.length > 0, "要给出人能读的等效条件");
	assert.ok(
		preview.sample.every((id) => !id.includes("?")),
		"示例只回主键,不回白盒 SQL 里的占位符",
	);
});

test("试用接口:换成指定账号算,并把逐条规则的账 + 真实样张一起给出来", async () => {
	await resetRules();
	// 「行数最多的 town」+ 总行数:与状态流转那几个用例共用 `busiestTown()`(算口径只有一处)
	const { expected, total, params } = await busiestTown();

	// m20034 (v2):trial 也得用「用户自建 fixed 类插件」才有输出值。
	const fixedPluginKey = `${TEST_PREFIX}ds_trialfixed_${SUFFIX}`;
	await caller.dataPlugin.create({
		pluginKey: fixedPluginKey,
		label: "测试用:试用页固定清单",
		outputValues: params.map((town) => ({ key: "town_id", value: town })),
	});
	pluginKeys.push(fixedPluginKey);

	// 主体给 `*`,这样"换成谁算"都应该得到同一个条件 —— 变量只剩"考生是谁"
	await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		pluginKey: fixedPluginKey,
		remark: "测试用:试用页",
	});

	const mine = await caller.dataScope.trial({ resource: "demo_grid", sampleLimit: 5 });
	assert.equal(mine.total, total);
	assert.equal(mine.visible, expected, "试用接口算出来的行数必须与预览一致");
	assert.equal(mine.isMe, true, "不传 userId 就是算当前登录人");

	const rows = mine.rows ?? [];
	assert.ok(rows.length > 0, "试用要连真实样张一起取(`select *`)");
	assert.ok(rows.length <= 5, "样张行数受 sampleLimit 限制");
	assert.ok(Object.keys(rows[0]).length > 1, "样张是 `select *`,列数应多于 1(不是只回主键)");
	assert.ok(
		mine.rules?.some((rule) => rule.effect === "filter"),
		"「规则的账」里要能看出这条是「按值筛行」",
	);

	// 换成库里**没有**的账号(调用者仍是管理员):主体是 `*` ⇒ 条件不变,但身份换成对方、名字退化成 id
	const other = await caller.dataScope.trial({
		resource: "demo_grid",
		userId: "trace-missing-user",
	});
	assert.equal(other.visible, expected, "主体是 `*` ⇒ 换成谁算都是同一个条件");
	assert.equal(other.isMe, false);
	assert.equal(other.userId, "trace-missing-user");
	assert.equal(other.userName, "trace-missing-user", "库里查不到名字就退回 id,不能空着");
	assert.equal(other.roles.length, 0, "这个账号没有任何角色");
	// m18035:trial 响应字段 depts[] 已改名 ancestors[]
	assert.equal(other.ancestors.length, 0, "这个账号没有任何部门");
});

test("值域的 key:同一个清单放多类值,两条规则各取各的 key(m23422)", async () => {
	await resetRules();
	const total = Number((await db.select({ n: sql<number>`count(*)` }).from(sysDemoGrid))[0]?.n ?? 0);

	// 两列各取一个真实值当参数(用真值才测得出"条件真的下推到了 SQL")
	const [town] = await db
		.select({ value: sysDemoGrid.town_id })
		.from(sysDemoGrid)
		.where(isNotNull(sysDemoGrid.town_id))
		.groupBy(sysDemoGrid.town_id)
		.orderBy(desc(sql`count(*)`))
		.limit(1);
	const [owner] = await db
		.select({ value: sysDemoGrid.owner_id })
		.from(sysDemoGrid)
		.where(isNotNull(sysDemoGrid.owner_id))
		.groupBy(sysDemoGrid.owner_id)
		.orderBy(desc(sql`count(*)`))
		.limit(1);
	const townValue = town?.value ?? "";
	const ownerValue = owner?.value ?? "";
	assert.ok(townValue && ownerValue, "前置条件:demo_grid 的 town_id / owner_id 都得有非空值");

	const countByTown = async (value: string) =>
		Number(
			(await db.select({ n: sql<number>`count(*)` }).from(sysDemoGrid).where(eq(sysDemoGrid.town_id, value)))[0]?.n ??
				0,
		);
	const countByOwner = async (value: string) =>
		Number(
			(await db.select({ n: sql<number>`count(*)` }).from(sysDemoGrid).where(eq(sysDemoGrid.owner_id, value)))[0]?.n ??
				0,
		);

	// 同一个清单插件里放两类值(town_key / owner_key)—— 这正是 m23422 要解决的场景
	const twoKeyPlugin = `${TEST_PREFIX}ds_twokeys_${SUFFIX}`;
	await caller.dataPlugin.create({
		pluginKey: twoKeyPlugin,
		label: "测试用:一个清单两类值",
		outputValues: [
			{ key: "town_key", value: townValue },
			{ key: "owner_key", value: ownerValue },
		],
	});
	pluginKeys.push(twoKeyPlugin);

	// ① 判据列 town_id + valueKey=town_key
	const townRuleId = await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		valueKey: "town_key",
		pluginKey: twoKeyPlugin,
		remark: "测试用:按 town_key",
	});
	const byTown = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.equal(byTown.visible, await countByTown(townValue), "要拿 town_key 的值去筛 town_id 列");
	assert.ok(byTown.visible < total, "只放开一个街镇 ⇒ 一定比总数少");
	assert.match(byTown.condition, /town_id/);
	// 台账要把 key 带出来 —— 否则同一个插件的两条规则在界面上长得一模一样
	assert.equal(
		(await caller.dataScope.list()).find((row) => row.id === townRuleId)?.valueKey,
		"town_key",
		"list 要回 valueKey,表单才能回填、台账才能区分",
	);

	// ② 同一个插件换成 key=owner_key 去接 owner_id 列 —— 两条规则互不干扰
	await resetRules();
	await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "owner_id",
		valueKey: "owner_key",
		pluginKey: twoKeyPlugin,
		remark: "测试用:按 owner_key",
	});
	const byOwner = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.equal(byOwner.visible, await countByOwner(ownerValue), "同插件换 key ⇒ 改按 owner_key 的值筛");
	assert.match(byOwner.condition, /owner_id/);

	// ③ key 写错 ⇒ **建的时候就拒**:插件自己声明过会给哪些 key(界面上的下拉就是它)
	await assertRejects(
		() =>
			caller.dataScope.create({
				subject: "*",
				resource: "demo_grid",
				column: "town_id",
				valueKey: "not_a_key",
				pluginKey: twoKeyPlugin,
			}),
		"它现在能给",
	);

	// ④ 库里的 key 过时了(插件改过 / 手改过数据)⇒ 引擎照样失败关闭,而不是"当它没配"
	await resetRules();
	const staleId = await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		valueKey: "town_key",
		pluginKey: twoKeyPlugin,
		remark: "测试用:事后把 key 改坏",
	});
	await db.update(sysDataPolicy).set({ value_key: "gone_key" }).where(eq(sysDataPolicy.id, staleId));
	clearDataScopeCache();
	const stale = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.equal(stale.visible, 0, "key 取不到值 ⇒ 一行也看不到(失败关闭)");
	assert.equal(stale.rules?.find((rule) => rule.id === staleId)?.effect, "skipped", "这条规则该记成「跳过」");
});

test("失败关闭:插件取不到值 ⇒ 编译成 1 = 0,一行也看不到", async () => {
	await resetRules();
	// 「我的部门及以下」对没有部门的账号(测试管理员不在 sys_user_dept 里)取到的是空集
	await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		pluginKey: "my_departments",
		remark: "测试用:取不到值",
	});

	const preview = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.equal(preview.visible, 0, "取不到值时必须一行也看不到(v0 就是在这里放行的)");
});

test("整类可见:什么插件都不配 ⇒ 不过滤", async () => {
	await resetRules();
	const total = Number((await db.select({ n: sql<number>`count(*)` }).from(sysDemoGrid))[0]?.n ?? 0);
	const id = await createRule({ subject: "*", resource: "demo_grid", remark: "测试用:整类可见" });

	const preview = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.equal(preview.visible, total, "没有任何插件 ⇒ 不产生条件,整张表都可见");

	// 组合校验:现有规则上再单独改一列会被拦(合并之后是"有列没插件")
	await assertRejects(() => caller.dataScope.update({ id, column: "town_id" }), "没选插件");
});

test("规则的增删改查:出参带人话标签,删掉后条件也跟着消失", async () => {
	await resetRules();
	const id = await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		pluginKey: "my_departments",
		remark: "测试用:人话标签",
	});

	const rows = await caller.dataScope.list();
	const row = rows.find((item) => item.id === id);
	assert.ok(row, "新建的规则应出现在清单里");
	assert.equal(row.subject, "*");
	assert.equal(row.subjectLabel, "所有人");
	assert.equal(row.resource, "demo_grid");
	assert.ok(row.resourceLabel.length > 0, "资源表要带中文名");
	assert.equal(row.column, "town_id");
	assert.ok(row.columnLabel && row.columnLabel.length > 0, "列要带中文名");
	assert.equal(row.pluginKey, "my_departments");
	const plugin = (await caller.dataScope.plugins()).find((item) => item.key === "my_departments");
	assert.equal(row.pluginLabel, plugin?.label);
	// m20034 (v2)起:规则不再带 items —— 输出值装在插件的 output_values 里。

	// 参数换成一个真实街镇 ⇒ 命中行数要跟着变(证明改的是真生效的东西)
	const town = (
		await db.select({ town: sysDemoGrid.town_id }).from(sysDemoGrid).where(isNotNull(sysDemoGrid.town_id)).limit(1)
	)[0]?.town;
	assert.ok(town, "前置条件:要有一个真实 town_id");
	await caller.dataScope.update({ id, remark: "改过" });
	const after = (await caller.dataScope.list()).find((item) => item.id === id);
	assert.equal(after?.remark, "改过");

	await caller.dataScope.remove({ ids: [id] });
	assert.equal(
		(await caller.dataScope.list()).some((item) => item.id === id),
		false,
	);
});

// ───────────────────────────── v1.6 内置 my_street(m19644 反馈) ─────────────────────────────

/** 给 `my_street` 造一份"我是谁"(只用到 `depts`;引擎真正装配的 ctx 多 user/roles/descendants) */
function ctxWithDepts(depts: PolicyDept[]): PolicyCtx {
	return { user: { id: `${TEST_PREFIX}me`, name: "测试人" }, roles: [], depts, descendants: [] };
}

/** 线上组织树里「镇、街道」那一层;用例要拿真实树跑,不然名单漏了人也发现不了 */
async function streetContainerId(): Promise<string> {
	const nodes = await loadDeptNodes();
	const container = nodes.find((node) => node.name === "镇、街道");
	assert.ok(container, "前置条件:线上组织树里要有「镇、街道」这一层");
	return container.id;
}

test("v1.6 my_street:14 个街镇名必须覆盖组织树里「镇、街道」下的每一个节点", async () => {
	const containerId = await streetContainerId();
	const streets = (await loadDeptNodes()).filter((node) => node.parentId === containerId);
	assert.ok(streets.length > 0, "前置条件:「镇、街道」下面要挂着街镇");
	for (const street of streets) {
		assert.ok(
			STREET_NAMES.includes(street.name),
			`${street.name} 不在 STREET_NAMES 里 —— 名单漏了,这个街镇的人会静默地一行也看不到`,
		);
	}
});

test("v1.6 my_street:从我开始往上找第一个街镇,链上没有街镇就返回空", async () => {
	const containerId = await streetContainerId();
	const nodes = await loadDeptNodes();
	const byId = new Map(nodes.map((node) => [node.id, node]));

	// 拿真实树造一条链:一个街镇 + 它下面的一个子孙当"我"
	const street = nodes.find((node) => node.parentId === containerId && STREET_NAMES.includes(node.name));
	assert.ok(street, "前置条件:要有一个名字在名单里的街镇");
	const isUnder = (node: (typeof nodes)[number], ancestorId: string): boolean => {
		let cursor = node.parentId ? byId.get(node.parentId) : undefined;
		let guard = 0;
		while (cursor && guard < 64) {
			if (cursor.id === ancestorId) return true;
			cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
			guard += 1;
		}
		return false;
	};
	const deeper = nodes.find((node) => node.id !== street.id && isUnder(node, street.id));
	assert.ok(deeper, "前置条件:街镇下面要挂着人");

	const chain: PolicyDept[] = [];
	let cursor: (typeof nodes)[number] | undefined = deeper;
	let guard = 0;
	while (cursor && guard < 64) {
		chain.push({ id: cursor.id, name: cursor.name, parentId: cursor.parentId, mine: cursor.id === deeper.id });
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
		guard += 1;
	}
	const rows = await resolvePluginValues("my_street", { ctx: ctxWithDepts(chain) });
	assert.deepEqual(rows, [{ id: street.id, name: street.name }], "命中往上第一个街镇,且只回它一个(不是把整条链摊出去)");

	// 反例:链上一个街镇都没有(线上真例:「区大数据中心 → 区数据局 → 区府」)
	const noStreet = await resolvePluginValues("my_street", {
		ctx: ctxWithDepts([
			{ id: `${TEST_PREFIX}self`, name: `${TEST_PREFIX}某科室`, parentId: `${TEST_PREFIX}org`, mine: true },
			{ id: `${TEST_PREFIX}org`, name: `${TEST_PREFIX}某中心`, parentId: null, mine: false },
		]),
	});
	assert.deepEqual(noStreet, [], "非街镇 ⇒ 空集(失败关闭),不是把祖先链当街镇放出去");
});

// ─────────────── v1.7 内置 my_dept_only / my_sub_departments / my_street_tree(m18652) ───────────────

/** 同 `ctxWithDepts`,但能指定「我的部门及以下」的扁平 id(`my_sub_departments` 要用) */
function ctxWithTree(depts: PolicyDept[], descendants: string[]): PolicyCtx {
	return { ...ctxWithDepts(depts), descendants };
}

/** 从某个部门往上爬到根,造一条 ctx.depts(`mine` 只标起点那个) */
async function chainOf(nodeId: string): Promise<PolicyDept[]> {
	const byId = new Map((await loadDeptNodes()).map((node) => [node.id, node]));
	const chain: PolicyDept[] = [];
	let cursor = byId.get(nodeId);
	let guard = 0;
	while (cursor && guard < 64) {
		chain.push({ id: cursor.id, name: cursor.name, parentId: cursor.parentId, mine: cursor.id === nodeId });
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
		guard += 1;
	}
	return chain;
}

test("v1.7 my_dept_only:只回我所属的部门本身(不摊上级、不摊下级)", async () => {
	const ctx = ctxWithDepts([
		{ id: `${TEST_PREFIX}root`, name: `${TEST_PREFIX}区局`, parentId: null, mine: false },
		{ id: `${TEST_PREFIX}me`, name: `${TEST_PREFIX}我科`, parentId: `${TEST_PREFIX}root`, mine: true },
	]);
	assert.deepEqual(
		await resolvePluginValues("my_dept_only", { ctx }),
		[{ id: `${TEST_PREFIX}me`, name: `${TEST_PREFIX}我科` }],
		"上级(root)不在里面 —— 这才是「仅本级」与「及以上」的差别",
	);

	// 反例:一个部门都没挂 ⇒ 空集(失败关闭)
	const none = await resolvePluginValues("my_dept_only", {
		ctx: ctxWithDepts([{ id: `${TEST_PREFIX}root`, name: `${TEST_PREFIX}区局`, parentId: null, mine: false }]),
	});
	assert.deepEqual(none, [], "没有任何 mine 部门 ⇒ 空集,不是把上级当成我的部门");
});

test("v1.7 my_sub_departments:是「我的部门及以下」减掉本级,带 name,不含本级", async () => {
	const containerId = await streetContainerId();
	const nodes = await loadDeptNodes();
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const street = nodes.find((node) => node.parentId === containerId && STREET_NAMES.includes(node.name));
	assert.ok(street, "前置条件:要有一个名字在名单里的街镇");

	const descendants = collectDescendantIds(nodes, [street.id]);
	const subIds = descendants.filter((id) => id !== street.id);
	assert.ok(subIds.length > 0, "前置条件:街镇下面要挂着部门");

	const rows = await resolvePluginValues("my_sub_departments", {
		ctx: ctxWithTree([{ id: street.id, name: street.name, parentId: street.parentId, mine: true }], descendants),
	});
	assert.ok(rows, "求值失败会返 null —— 这里是正例,必须拿得到数组");
	assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(subIds), "下级 = descendants 减掉本级,不多不少");
	assert.ok(!rows.some((row) => row.id === street.id), "不含本级");
	assert.ok(
		rows.every((row) => row.name === (byId.get(row.id)?.name ?? "")),
		"每一行都要带对的 name(规则可以按 name 列过滤)",
	);

	// 反例:没有下级(descendants 只有我自己)⇒ 空集
	const leaf = await resolvePluginValues("my_sub_departments", {
		ctx: ctxWithTree([{ id: street.id, name: street.name, parentId: street.parentId, mine: true }], [street.id]),
	});
	assert.deepEqual(leaf, [], "没有下级 ⇒ 空集(失败关闭),不是把本级放出去");
});

test("v1.7 my_street_tree:街镇 + 它下面整棵子树(与 my_street 只回一个节点成对比)", async () => {
	const containerId = await streetContainerId();
	const nodes = await loadDeptNodes();
	const street = nodes.find((node) => node.parentId === containerId && STREET_NAMES.includes(node.name));
	assert.ok(street, "前置条件:要有一个名字在名单里的街镇");
	const expected = collectDescendantIds(nodes, [street.id]);
	assert.ok(expected.length > 1, "前置条件:街镇下面要有子树,否则这个用例证不了「及以下」");

	// 造一个"人在街镇下面"的 ctx:链是「根 → … → 街镇 → … → 我」
	const deeper = expected.find((id) => id !== street.id);
	assert.ok(deeper, "前置条件:街镇下面要挂着部门");
	const rows = await resolvePluginValues("my_street_tree", { ctx: ctxWithDepts(await chainOf(deeper)) });

	assert.ok(rows, "求值失败会返 null —— 这里是正例,必须拿得到数组");
	assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(expected), "整棵子树,一个不漏");
	assert.ok(
		rows.some((row) => row.id === street.id),
		"含街镇本级 —— 与 my_street 的差别就在这里",
	);

	// 反例:链上一个街镇都没有 ⇒ 空集(和 my_street 同一条失败关闭纪律)
	const noStreet = await resolvePluginValues("my_street_tree", {
		ctx: ctxWithDepts([
			{ id: `${TEST_PREFIX}self`, name: `${TEST_PREFIX}某科室`, parentId: `${TEST_PREFIX}org`, mine: true },
			{ id: `${TEST_PREFIX}org`, name: `${TEST_PREFIX}某中心`, parentId: null, mine: false },
		]),
	});
	assert.deepEqual(noStreet, [], "非街镇 ⇒ 空集(失败关闭)");
});

// ───────────────────────────── 插件 CRUD(不是超管专属,m21097) ─────────────────────────────

test("自定义函数插件:保存时真编译一次,能预览,被规则引用时拒绝删、强删后规则静默失效", async () => {
	await resetRules();

	// m20034 (v2)起:不再有 `fn` / 不再编译 —— zod 在 schema 层把空 / 超长 / 超行拦掉。
	await assertRejects(
		() => caller.dataPlugin.create({ pluginKey: PLUGIN_KEY, label: "测试用:缺清单", outputValues: [] }),
		"至少要填一行",
	);

	// > v2 blockquote:「输出值」三上限断言(行数 / key 长 / value 长)—— 全在 zod schema 拦。
	// 注意 fragment 必须出现在 zod issues JSON 里 —— 用 schema 里的中文文案 `key 最长` / `value 最长`。
	const tooMany = Array.from({ length: 201 }, () => ({ key: "town_id", value: "x" }));
	await assertRejects(
		() =>
			caller.dataPlugin.create({
				pluginKey: PLUGIN_KEY,
				label: "太多行",
				outputValues: tooMany,
			}),
		"输出值最多",
	);
	await assertRejects(
		() =>
			caller.dataPlugin.create({
				pluginKey: PLUGIN_KEY,
				label: "key 超长",
				outputValues: [{ key: "x".repeat(PLUGIN_ITEM_KEY_MAX + 1), value: "v" }],
			}),
		"key 最长",
	);
	await assertRejects(
		() =>
			caller.dataPlugin.create({
				pluginKey: PLUGIN_KEY,
				label: "value 超长",
				outputValues: [{ key: "k", value: "x".repeat(PLUGIN_ITEM_VALUE_MAX + 1) }],
			}),
		"value 最长",
	);

	await caller.dataPlugin.create({
		pluginKey: PLUGIN_KEY,
		label: "测试用:我所属的部门",
		outputValues: [{ key: "town_id", value: "310112103" }],
		remark: "自定义(测试)",
	});

	const list = await caller.dataPlugin.list();
	const custom = list.custom.find((item) => item.pluginKey === PLUGIN_KEY);
	assert.ok(custom, "自定义插件应出现在清单里");
	assert.equal(custom.impl, "fn");
	// m20034 (v2):界面要拿回清单原样(不是函数体)
	assert.ok(Array.isArray(custom.outputValues), "list().custom[].outputValues 必须是数组");
	assert.ok(custom.outputValues.length > 0, "清单要能读回非空");

	// 内置标识不许被占用(装载时内置优先,库里那条永远轮不到)
	// m20034 (v2):zod 先过(`outputValues` ≥ 1 行),再走到 router 的「内置插件」判断
	await assertRejects(
		() =>
			caller.dataPlugin.create({
				pluginKey: "fixed",
				label: "想顶掉内置",
				outputValues: [{ key: "k", value: "v" }],
			}),
		"内置插件",
	);
	// 内置插件不能删
	await assertRejects(() => caller.dataPlugin.remove({ pluginKeys: ["fixed"] }), "不能删");

	// 预览:拿当前登录的人真跑一次,并且**把"按什么上下文算的"一起回出来**
	// (取不到值时管理员得能一眼看出是"配置错了"还是"这个人恰好没有")
	const tested = await caller.dataPlugin.test({ pluginKey: PLUGIN_KEY });
	assert.equal(tested.ok, true, "语法合法,应该跑得动");
	// v1.4 (m18655):输出从 `values: string[]` 改成 `rows: Record<string,string>[]`(对象数组)
	assert.ok(Array.isArray(tested.rows));
	assert.ok(Array.isArray(tested.roles), "预览要回角色名");
	// m18035 反馈:上下文里的 depts / descendants 改名为 ancestors / children,
	// 内部数据模型 `ctx.depts` 没动(改它牵动引擎 + 插件),只在「给 UI 看」这一步换名字。
	assert.ok(Array.isArray(tested.ancestors), "预览要回部门祖先");
	// m17492 反馈后:预览值域不再支持换人,一律按当前登录人算 —— `isMe` 恒 true
	assert.equal(tested.isMe, true, "预览值域一律按当前登录人算");
	// `ancestors[i].mine` 是数据契约;test-admin 在测试库里没挂部门 ⇒ 空数组也合法
	assert.ok(
		tested.ancestors.every((d) => typeof d.name === "string" && typeof d.mine === "boolean"),
		"ancestors[i] 要带 name/mine",
	);
	// m17838 反馈:「我的部门及以下」也要摊开给 UI 用 —— 改名 children 后,「部门children」
	assert.ok(Array.isArray(tested.children), "预览要回 children(部门children)id 列表");
	assert.ok(
		tested.children.every((d) => typeof d.name === "string" && typeof d.mine === "boolean"),
		"children[i] 要带 name/mine",
	);
	// m18546:输出值不查名字 —— 显示什么就是什么。前端一列原始值,后端不查 label。
	// 因此这里不再有 `valueLabels` 契约;values 是数组、每项是字符串就够了(上面已守)。
	// (历史:m17825 + m17838 + m18035 链路 —— 查 label 那条路已删除。)

	// 挂一条规则引用它 ⇒ 直接删要被拒(否则规则会静默变成"一行也看不到",很难查)
	const ruleId = await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		pluginKey: PLUGIN_KEY,
		remark: "测试用:引用自定义插件",
	});
	await assertRejects(() => caller.dataPlugin.remove({ pluginKeys: [PLUGIN_KEY] }), "强制删除");

	await caller.dataPlugin.remove({ pluginKeys: [PLUGIN_KEY], force: true });
	assert.equal(
		(await caller.dataPlugin.list()).custom.some((item) => item.pluginKey === PLUGIN_KEY),
		false,
	);

	// 插件没了 ⇒ 那条规则还在,但取不到值 ⇒ 失败关闭(不是放行)
	const preview = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.equal(preview.visible, 0, "被删插件的规则必须变成一行也看不到,绝不能整表放行");
	await caller.dataScope.remove({ ids: [ruleId] });
});

test("插件形态 v1.3:插件只回答「哪些值算他的」,字段仅 pluginKey/label/outputValues/status", async () => {
	await resetRules();
	const customKey = `${TEST_PREFIX}dsfn_${SUFFIX}`;
	pluginKeys.push(customKey);

	// 取一个真实存在的 town_id(demo_grid 用 nanoid 而非行政区码)→ 现取现用,
	// 让 "list 里能拿回来 / 规则能筛出至少 1 行" 都用同一个事实锚点。
	const [{ town: realTown }] = await db
		.select({ town: sysDemoGrid.town_id })
		.from(sysDemoGrid)
		.where(isNotNull(sysDemoGrid.town_id))
		.limit(1);
	assert.ok(realTown, "前置条件:demo_grid 至少要有 1 条 town_id");

	// 只填清单 ⇒ 新建插件本来就合法 —— 没有任何「恰填一个」的硬规则
	await caller.dataPlugin.create({
		pluginKey: customKey,
		label: "测试用:仅清单",
		outputValues: [{ key: "town_id", value: realTown }],
	});
	const row = (await caller.dataPlugin.list()).custom.find((item) => item.pluginKey === customKey);
	assert.ok(row, "自定义插件应出现在清单里");
	assert.equal(row.impl, "fn");
	assert.ok(Array.isArray(row.outputValues), "list().custom[].outputValues 必须是数组");
	assert.equal(row.outputValues[0]?.key, "town_id");
	assert.equal(row.outputValues[0]?.value, realTown);

	// 挂进规则后引擎走的是「column in [...]」 ⇒ 清单有 1 行,应只筛到 1 个街镇
	const ruleId = await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		pluginKey: customKey,
		remark: "测试用:outputValues 插件",
	});
	const preview = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.ok(preview.visible > 0, "清单给出真实街镇 ⇒ 应能筛出至少 1 行");
	await caller.dataScope.remove({ ids: [ruleId] });
	await caller.dataPlugin.remove({ pluginKeys: [customKey] });
});

// ───────────────────────────── 状态流转:新建(启用)→ 试算 → 上线 ─────────────────────────────

/**
 * demo_grid 里取"行数最多的那个 town_id"、它盖住的行数、总行数 —— 试用与状态流转那几个用例都用它。
 * `params` 也一并给出来:用例要拿它拼用户自建 fixed 插件的输出值。
 */
async function busiestTown(): Promise<{ expected: number; total: number; params: string[] }> {
	const total = Number((await db.select({ n: sql<number>`count(*)` }).from(sysDemoGrid))[0]?.n ?? 0);
	const towns = await db
		.select({ town: sysDemoGrid.town_id, n: sql<number>`count(*)` })
		.from(sysDemoGrid)
		.where(isNotNull(sysDemoGrid.town_id))
		.groupBy(sysDemoGrid.town_id)
		.orderBy(desc(sql`count(*)`))
		.limit(1);
	const params = towns.map((row) => row.town).filter((town): town is string => Boolean(town));
	const expected = Number(
		(await db.select({ n: sql<number>`count(*)` }).from(sysDemoGrid).where(inArray(sysDemoGrid.town_id, params)))[0]
			?.n ?? 0,
	);
	return { expected, total, params };
}

test("状态流转:新建落「启用」(引擎不加载),试算通过后「上线」才真的生效", async () => {
	await resetRules();
	const { expected, total } = await busiestTown();

	// v2 起 builtin fixed 返 [] —— 必须先建一个用户自建 fixed 类插件,引用它;
	// town_id 用 `busiestTown` 计算出来的 busiest town,确保筛出来的行数 = expected。
	const fixedKey = `${TEST_PREFIX}state_${SUFFIX}`;
	pluginKeys.push(fixedKey);
	const [{ town: realTown }] = await db
		.select({ town: sysDemoGrid.town_id })
		.from(sysDemoGrid)
		.where(isNotNull(sysDemoGrid.town_id))
		.groupBy(sysDemoGrid.town_id)
		.orderBy(desc(sql`count(*)`))
		.limit(1);
	assert.ok(realTown, "前置条件:demo_grid 至少要有 1 条 town_id");
	await caller.dataPlugin.create({
		pluginKey: fixedKey,
		label: "测试用:状态流转 fixed",
		outputValues: [{ key: "town_id", value: realTown }],
	});

	// 新建**不传 status** ⇒ 落「启用」(2):清单里看得见,引擎不加载(上线了才加载)
	const { id } = await caller.dataScope.create({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		pluginKey: fixedKey,
		remark: "测试用:状态流转",
	});
	ruleIds.push(id);

	const created = (await caller.dataScope.list()).find((item) => item.id === id);
	assert.equal(created?.status, 2, "新建落的必须是「启用」,还不能生效");

	const before = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.equal(before.visible, total, "还没上线 ⇒ 引擎不加载它,一行都不筛");

	// 带 `ruleId` 试算 = “假如上线它”:主体是 `*`,这条一定命中
	const trial = await caller.dataScope.trial({ resource: "demo_grid", ruleId: id, sampleLimit: 5 });
	assert.equal(trial.visible, expected, "试算要给出「上线之后」的行数");
	assert.equal(trial.trialRule?.id, id, "要回给弹窗「试的是哪条」,才能把这条标出来");
	assert.equal(trial.trialRule?.status, 2);
	assert.equal(trial.trialRule?.subjectLabel, "所有人");
	assert.ok(
		trial.rules?.some((rule) => rule.id === id),
		"逐条规则的账里要能看到被试算的这条",
	);
	assert.equal(trial.warning, undefined, "主体命中,不该给警告");

	// m23214:弹窗还要贴「引擎真跑的 SQL」—— 用同一个 dialect 渲染同一条语句,不另写一份人话描述
	assert.match(trial.sql?.count.text ?? "", /select count\(\*\)/, "要给出「数出能看到几行」的真 SQL");
	assert.match(trial.sql?.rows.text ?? "", /limit \?/i, "抽样语句的 LIMIT 也必须走 ? 占位,不能拼数字");
	assert.deepEqual(trial.sql?.rows.params, [realTown, 5], "参数摊开给用户看:先是值域的值,再是 LIMIT");

	// 上线 ⇒ 引擎真的开始筛(不带 ruleId 的试算也该只剩这几行)
	const live = await caller.dataScope.update({ id, status: 1 });
	assert.equal(live.status, 1);
	assert.equal(live.demoted, false, "只改状态不算改形态");
	const after = await caller.dataScope.trial({ resource: "demo_grid" });
	assert.equal(after.visible, expected, "上线之后才算数");
});

test("改过形态的规则自动退回「启用」:改完的那条和试算过的已经不是一回事", async () => {
	await resetRules();
	const id = await createRule({
		subject: "*",
		resource: "demo_grid",
		column: "town_id",
		pluginKey: "my_departments",
		remark: "测试用:退回启用",
	});
	await caller.dataScope.update({ id, status: 1 });

	// 只改备注 ⇒ 不动状态(表单会把形态字段原样回发,值没变就不该把已上线的规则摘下来)
	const kept = await caller.dataScope.update({ id, remark: "改个说明" });
	assert.equal(kept.demoted, false, "形态没变 ⇒ 不该退回");
	assert.equal(kept.status, 1);

	// m20034 (v2)起:items 不再是规则的形态字段;换 column 触发 demoted
	const back = await caller.dataScope.update({ id, column: "duty" });
	assert.equal(back.demoted, true, "形态变了就必须重新试算");
	assert.equal(back.status, 2);

	// 显式给状态优先级最高:说上线就是上线
	const explicit = await caller.dataScope.update({
		id,
		column: "owner_id",
		status: 1,
	});
	assert.equal(explicit.demoted, false);
	assert.equal(explicit.status, 1);
});

test("预览一条规则:主体不含这个人时明说「对 TA 不起作用」", async () => {
	await resetRules();
	const id = await createRule({
		subject: "user:trace-missing-user",
		resource: "demo_grid",
		column: "town_id",
		pluginKey: "my_departments",
		remark: "测试用:主体不命中",
	});

	const trial = await caller.dataScope.trial({ resource: "demo_grid", ruleId: id });
	assert.equal(trial.visible, 0, "唯一一条上线规则没命中我 ⇒ 失败关闭,一行也看不到");
	assert.match(trial.warning ?? "", /不含这个人/);
	assert.equal(
		trial.rules?.find((rule) => rule.id === id)?.effect,
		"not-matched",
		"账上要写清是「主体没命中」,不是「列配错了」",
	);
});

test("写插件谁都能:有权限点的普通角色也建得来(m21097)", async () => {
	const roleId = newId();
	await db.insert(sysRole).values({
		id: roleId,
		name: `${TEST_PREFIX}ds_${SUFFIX}`, // sys_role.name 是 varchar(32)
		sort: 999,
		status: 1,
		remark: "",
	});
	roleIds.push(roleId);

	// 把「值域插件」页面 + 新增 / 改 / 删三个按钮权限点都授给它 ⇒ permMiddleware 全放行
	const menus = await db.select({ id: sysMenu.id, name: sysMenu.name, perm: sysMenu.perm }).from(sysMenu);
	const page = menus.find((item) => item.name === "值域插件");
	const add = menus.find((item) => item.perm === "sys:plugin:add");
	const edit = menus.find((item) => item.perm === "sys:plugin:edit");
	const remove = menus.find((item) => item.perm === "sys:plugin:remove");
	assert.ok(page, "前置条件:库里要有「值域插件」菜单(由 seed-rbac 建)");
	assert.ok(add, "前置条件:库里要有 perm='sys:plugin:add' 的按钮权限点");
	assert.ok(edit, "前置条件:库里要有 perm='sys:plugin:edit' 的按钮权限点");
	assert.ok(remove, "前置条件:库里要有 perm='sys:plugin:remove' 的按钮权限点");
	await setRoleMenus(roleId, [page.id, add.id, edit.id, remove.id]);

	const userId = `${TEST_PREFIX}${SUFFIX}`;
	usersWithRoles.push(userId);
	await addUserRole(userId, roleId);
	const plain = callerAs({ id: userId, name: "有权限点的普通角色", isSuper: false });

	// m21097 起:写插件谁都能 —— 与「数据范围」同口径,菜单授权就够,不再叠超管判定。
	const key = `${TEST_PREFIX}dsx_${SUFFIX}`;
	pluginKeys.push(key);
	const created = await plain.dataPlugin.create({
		pluginKey: key,
		label: "普通角色建插件",
		outputValues: [{ key: "k", value: "v" }],
	});
	assert.equal(created.pluginKey, key);

	// 改 / 删也走得通
	await plain.dataPlugin.update({ pluginKey: key, label: "改名" });
	await plain.dataPlugin.remove({ pluginKeys: [key] });
});
