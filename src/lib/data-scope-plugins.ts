/**
 * 数据权限的**值域插件** —— 规则右半边「`in` 什么」的唯一求值入口。只在服务端跑。
 *
 * 规则(一行 `sys_data_policy`)编出来的是 `<表>.<列> in (一串值)`;那串值从哪来,全在这个文件:
 *
 *  - **内置插件**:`self` / `my_departments` / `my_dept_ancestors` / `my_dept_only` /
 *    `my_sub_departments` / `my_street` / `my_street_tree` ——
 *    写死在代码里,不落库 —— 它们是权限地基,界面标「内置」且不可改删
 *    (另有一个**不对外**的 `fixed`,只为保留 key,见 `BUILTIN_PLUGINS` 尾部);
 *  - **自定义插件**:`sys_data_plugin.output_values` 存一份 **`{key, value}[]` 指定清单**,
 *    `toPlugin()` 直接消费 —— 加 / 改插件**不用重启**(用户明确要的)。
 *
 * 插件函数拿到的东西(`ResolvedPlugin.resolve({ ctx })`):
 *
 *   ctx = "我是谁":`{ user, roles, depts, descendants }`(见 `data-scope-spec.ts` 的 `PolicyCtx`)。
 *         v2 起**没有** `query` / `log` / `descendantsOf` 这层助手了 —— 用户写的是「清单」不是代码。
 *
 * v1.3 (m18228):user 明确「插件不需要域概念」 —— 「给值 / 给行」「user / dept / town / area
 * / text」整组字段砍掉,`code` → `fn`。
 *
 * v2 (m20034):user 进一步明确「函数插件只能代码预制」(即写在这里的内置),「新建插件」界面
 * 上**只接受「指定清单」(fixed)类** —— 用户手填 `[{key, value}]`,由 `toPlugin()` 拼成
 * `resolve` 函数。**`fn` 列 / `new Function` 编译路径已删**,`PLUGIN_PARAMS_MAX` 兜底
 * 也不需要了(规则行的 `params` 列也删了)。
 *
 * 旧 API(`resolve({ ctx, params })` / `args.items`)**已彻底删除** —— v1.4 / v1.5
 * 期间作为兼容层保留,v2 起引擎与所有内置/自定义插件统一按 `resolve({ ctx })` 实现。
 *
 * 三条纪律:
 * 1. **标识符只有"选"能决定**:资源表名 / 判据列名会拼进 SQL(它们当不了参数),
 *    所以界面上从 `information_schema` 里选 + `isIdent()` 校验;请求方输入永远只落进 `in (参数)`。
 * 2. **求值失败 ≠ 放行**:插件不存在 / 抛异常 / 超时,一律返回 `null`,
 *    调用方当"这条规则无效"处理(已经在这里留了 `warn`)。
 * 3. **写插件的边界在「权限点」**:v2 起用户写的是「清单」不是「代码」,插件 CRUD 不再是
 *    超管专属(m21097)—— 与「数据范围」页同口径,路由只挂 `protectedProcedure`,
 *    守权限靠菜单授权与 `sys:plugin:add` / `sys:plugin:edit` / `sys:plugin:remove` 三个按钮权限点。
 */
import { and, eq } from "drizzle-orm";

import { db } from "#/db";
import { sysDataPlugin, sysDept } from "#/db/data-base-schema";
import { ctxDeptIds, type PolicyCtx, parseItems } from "#/lib/data-scope-spec";
import { logger } from "#/lib/logger";
import { alive } from "#/lib/soft-delete";
import { collectDescendantIds } from "#/lib/tree";

// ── 类型 ────────────────────────────────────────────────────────────────────

/**
 * 求值入参:`ctx` 是"我是谁"的数据部分(`{ user, roles, depts, descendants }`)。
 *
 * v2 (m20034):「输出值」搬到 plugin 上,引擎不传 items / params —— 内置插件都按 ctx 自己算;
 * 自定义插件(清单类)的「输出值」在 `toPlugin()` 里直接灌进了它的 `resolve` 函数,
 * 闭包里拿,不需要 `args` 再传。
 */
export type ResolveArgs = {
	ctx: PolicyCtx;
};

/** 一个已经能求值的插件 */
export type ResolvedPlugin = {
	/** `plugin_key`,策略行就是靠它找到这里 */
	key: string;
	label: string;
	impl: "builtin" | "fn";
	remark?: string;
	/**
	 * **不进界面清单**(m18652 起的字段)。
	 *
	 * 现在的唯一用户是内置 `fixed`:它只为保留 key 而存在(挡住用户建同名插件),
	 * 不该出现在可选下拉里 —— 选中它只会拿到一个恒返 `[]` 的插件。
	 */
	hidden?: boolean;
	/**
	 * 这个插件**会给哪些 key**(m23422)—— 规则的 `value_key` 从这里面选。
	 *
	 * 内置插件在代码里写死;自建「清单」插件由 `toPlugin()` 按 `output_values[].key` 去重得到。
	 * 界面拿它渲染「值域的 key」下拉,所以它必须**诚实地反映 `resolve()` 会返回的 key**:
	 * 声明的 key 不存在,规则就会取不到值(失败关闭,一行看不到)。
	 */
	valueKeys: string[];
	/**
	 * 求值:返回 **一行一个对象**(`Record<string, string>[]`)。
	 *
	 * 引擎按规则的 `value_key` 从每行取值(m23422;留空的老规则按 `column` 推断):
	 *   - 插件返 `[{id: "u1", name: "张三"}]`,规则 `value_key = "id"` ⇒ 取 `id`
	 *   - `value_key = "name"` ⇒ 取 `name`(同插件服务多列,适配表里存"街镇名"而非"街镇 id"的场景)
	 *   - 缺失 key ⇒ warn + 空数组(规则编译为 `1 = 0`,一行也看不到)
	 *
	 * 兼容:插件返 `string[]` 也接受(被 coerce 成 `[{value: str}]`);`fixed` / `self` 等
	 * 简单场景就返 `[{value: ...}]`。**空数组 = 这个人什么都没有**。
	 *
	 * v1.4 (m18655):从 `string[]` 升级到 `Record<string,string>[]`,因为按 value 单形态
	 * 撑不住"表里存的是街镇值/街镇名"这类非 id 列。
	 */
	resolve: (args: ResolveArgs) => Promise<Record<string, string>[]>;
};

/** 界面清单用的形状 —— 去掉函数与 `hidden` 标记,可以安全地回给客户端 */
export type PluginInfo = Omit<ResolvedPlugin, "resolve" | "hidden">;

// ── SQL 小工具 ──────────────────────────────────────────────────────────────

// v2 起已删:`selectRows()` 没用了 —— 内置插件都只看 ctx,不走 SQL;`toPlugin()` 也不再编译函数体。
// `toValueRows` / `coerceRow` 仍保留作为防御层(以防用户代码/老插件代码意外走到这里)。

/**
 * 插件返回值归一:统一成 `Record<string, string>[]`(一行一个对象,每个字段都是字符串)。
 *
 * 三种输入都接受 —— 兼容现有插件代码:
 *  - `string[]`             → `[{value: str}, ...]`(老插件不用动)
 *  - `number[]`             → `[{value: String(n)}, ...]`(同上,数值兼容)
 *  - `Record<string, ...>[]` → 字段是字符串的留下,其它丢弃(数字会 `String(n)`)
 *
 * 空数组 / 空字段 / 空字符串 全部丢弃,去重(按"全字段序列化的 JSON"做 key)。
 *
 * 插件是别人写的代码,返回 `undefined` / 一个字符串 / 一堆对象都有可能 —— 求值路径上
 * 不能因为这个把读接口炸掉。
 *
 * v1.4 (m18655):从「只收字符串」改成「收对象 + 自动 coerce 字符串」,因为按 value 单形态
 * 撑不住"表里存的是街镇名/街镇 id"这类多字段场景。
 */
function toValueRows(value: unknown): Record<string, string>[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: Record<string, string>[] = [];
	for (const item of value) {
		const row = coerceRow(item);
		if (!row) continue;
		const fingerprint = JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
		if (seen.has(fingerprint)) continue;
		seen.add(fingerprint);
		out.push(row);
	}
	return out;
}

/** 一项 → `{[k]: string}`;非对象 / 全空字段 一律回 `null`(被 `toValueRows` 跳过) */
function coerceRow(item: unknown): Record<string, string> | null {
	if (item === null || item === undefined) return null;
	if (typeof item === "string") return item ? { value: item } : null;
	if (typeof item === "number") return Number.isFinite(item) ? { value: String(item) } : null;
	if (typeof item !== "object") return null;

	const obj = item as Record<string, unknown>;
	const row: Record<string, string> = {};
	let has = false;
	for (const [k, v] of Object.entries(obj)) {
		if (typeof v === "string" && v) {
			row[k] = v;
			has = true;
		} else if (typeof v === "number" && Number.isFinite(v)) {
			row[k] = String(v);
			has = true;
		}
	}
	return has ? row : null;
}

// ── 组织树缓存 ──────────────────────────────────────────────────────────────

/** 组织树的一行 —— 不带 `mine`(那是"对谁而言",由引擎按人算) */
export type DeptNode = { id: string; name: string; parentId: string | null };

/**
 * 为什么要缓存:`sys_dept` 现在 3700 行,而「我的部门及以下 / 及以上」每算一次都要先有整棵父子关系。
 * 手法与 `src/lib/sys-para.ts:138` 一样:30 秒 TTL + 写操作后主动清。
 *
 * ⚠️ **改了组织架构必须清**(`clearDeptCache()`)—— 部门路由的增 / 改 / 删都要调,
 * 否则新加的部门在 30 秒内对数据权限"还不存在"。
 */
const DEPT_CACHE_TTL_MS = 30_000;
let deptCache: { at: number; nodes: DeptNode[] } | null = null;

/** 组织架构变了之后清缓存 */
export function clearDeptCache(): void {
	deptCache = null;
}

/** 整棵组织树(id + 名字 + 父级),给引擎算 `ctx.depts`、给插件算子树用 */
export async function loadDeptNodes(): Promise<DeptNode[]> {
	if (deptCache && Date.now() - deptCache.at < DEPT_CACHE_TTL_MS) return deptCache.nodes;
	const nodes = await db
		.select({ id: sysDept.id, name: sysDept.name, parentId: sysDept.parent_id })
		.from(sysDept)
		.where(alive(sysDept));
	deptCache = { at: Date.now(), nodes };
	return nodes;
}

// ── 闵行区的 14 个街镇(工业区) ─────────────────────────────────────────────

/**
 * **闵行区 14 个街镇(工业区)** —— 4 个街道 + 9 个镇 + 1 个工业区(m19644 反馈)。
 *
 * 为什么写死在代码里:这是**行政区划**,不是业务数据 —— 组织树里「镇、街道」那一层就是这 14 个,
 * 让插件按名字比对最直接(比"父节点是不是某个 id"稳:树可以被改名,也可以有多套组织树)。
 *
 * 名字取自线上组织树本身(`sys_dept` 里「镇、街道」的子节点写的是「古美路街道」而不是
 * 「古美街道」),所以和表里存的街镇值、界面上显示的写法一致。
 * 「莘庄工业区」树里暂时没有对应节点,先占位 —— 将来挂上去也不用改代码。
 */
export const STREET_NAMES: readonly string[] = [
	// 4 个街道
	"江川路街道",
	"古美路街道",
	"新虹街道",
	"浦锦街道",
	// 9 个镇
	"莘庄镇",
	"七宝镇",
	"颛桥镇",
	"华漕镇",
	"虹桥镇",
	"梅陇镇",
	"吴泾镇",
	"马桥镇",
	"浦江镇",
	// 1 个工业区(按街镇管理)
	"莘庄工业区",
];

const STREET_NAME_SET = new Set(STREET_NAMES);

// ── 内置插件 ────────────────────────────────────────────────────────────────

/**
 * 内置插件 —— **写在代码里,不落库**。
 *
 * 为什么不许改删:这些是权限地基(`self` 配 `owner_id`、「我的部门及以下」配 `town_id` …),
 * 被误改会**静默**改变所有人的可见范围,事后没人知道是"数据权限"干的。
 * 需要"部门名等于某几个固定字符串"这类,用自定义「清单」插件。
 *
 * v2 (m20034)说明:除 `fixed` 外全部按 ctx 自动算;
 * `fixed` 仍在代码里但**仅作兜底**(`resolve: () => []`)、**不出现在可选清单里** ——
 * 用户新建的「清单」插件走 `sys_data_plugin` 自己的 `output_values`,不调用这个内建。
 */
const BUILTIN_PLUGINS: ResolvedPlugin[] = [
	{
		key: "self",
		valueKeys: ["value"],
		label: "我本人",
		impl: "builtin",
		remark: "只有一条:当前登录用户的 id。配在 `owner_id` 这类「这条归谁办」的列上",
		resolve: ({ ctx }) => Promise.resolve(ctx.user ? [{ value: ctx.user.id }] : []),
	},

	{
		key: "my_departments",
		valueKeys: ["id", "name"],
		label: "我的部门及以下",
		impl: "builtin",
		remark: "我所在的部门 + 它下面的整棵子树(街镇 → 网格组 → …),同时返 id + name;规则按 `column` 选 `id` 还是 `name`",
		resolve: async ({ ctx }) => {
			const roots = ctxDeptIds(ctx);
			if (roots.length === 0) return [];
			const ids = collectDescendantIds(await loadDeptNodes(), roots);
			// 用 `loadDeptNodes()` 已经返回了 name —— 但 collectDescendantIds 只回 id。
			// 为了一并拿 name,这里再查一次;或读缓存的 nodes 拼一下。
			const nodes = await loadDeptNodes();
			const byId = new Map(nodes.map((n) => [n.id, n.name]));
			return ids.map((id) => ({ id, name: byId.get(id) ?? "" }));
		},
	},
	{
		key: "my_dept_ancestors",
		valueKeys: ["id", "name"],
		label: "我的部门及以上",
		impl: "builtin",
		remark: "我所在的部门 + 它上面那条链(一直到根),同时返 id + name;规则按 `column` 选 `id` 还是 `name`",
		// `ctx.depts` 已经带 name,直接摊平
		resolve: ({ ctx }) => Promise.resolve(ctx.depts.map((dept) => ({ id: dept.id, name: dept.name }))),
	},
	{
		key: "my_dept_only",
		valueKeys: ["id", "name"],
		label: "我的部门(仅本级)",
		impl: "builtin",
		remark: "只有我所属的部门本身,不含下级、不含上级。适合「本部门自办件」这类范围(与「我的部门及以下」互为补充)",
		resolve: ({ ctx }) =>
			Promise.resolve(ctx.depts.filter((dept) => dept.mine).map((dept) => ({ id: dept.id, name: dept.name }))),
	},
	{
		key: "my_sub_departments",
		valueKeys: ["id", "name"],
		label: "我的下级部门",
		impl: "builtin",
		remark: "我所属部门的下级(不含本级)。适合「只看下级报上来的数据」;没有下级时返空",
		// `ctx.descendants` 是「我 + 子孙」,减掉 `mine` 就是纯下级
		resolve: async ({ ctx }) => {
			const mine = new Set(ctxDeptIds(ctx));
			if (mine.size === 0) return [];
			const nodes = await loadDeptNodes();
			const byId = new Map(nodes.map((node) => [node.id, node.name]));
			return ctx.descendants.filter((id) => !mine.has(id)).map((id) => ({ id, name: byId.get(id) ?? "" }));
		},
	},

	{
		key: "my_street",
		valueKeys: ["id", "name"],
		label: "我所在的街镇",
		impl: "builtin",
		remark:
			"从我所在的部门往上找,遇到第一个街镇(闵行区 14 个街镇 / 工业区之一)就返它的 id + name;整条链上没有街镇 ⇒ 空(失败关闭)",
		// m19644:`ctx.depts` 是根 → 我 的祖先链(由 `deptTreeOf` 在引擎里构造,见
		// `src/lib/data-scope.ts`),所以插件只要在数组里找名字就行,不必再爬 `parentId`。
		// 链上一个街镇都没有 ⇒ `[]`(失败关闭 —— 不能把"我挂区级机关"的人也判成可见)。
		resolve: ({ ctx }) => {
			for (const dept of ctx.depts) {
				if (STREET_NAME_SET.has(dept.name)) {
					return Promise.resolve([{ id: dept.id, name: dept.name }]);
				}
			}
			return Promise.resolve([]);
		},
	},

	{
		key: "my_neighborhood",
		valueKeys: ["id", "name"],
		label: "我所在的居村",
		impl: "builtin",
		remark: "从我所在的部门往上找,遇到第一个居村就返它的 id + name;整条链上没有 ⇒ 空(失败关闭)",
		// m19644:`ctx.depts` 是根 → 我 的祖先链(由 `deptTreeOf` 在引擎里构造,见
		// `src/lib/data-scope.ts`),所以插件只要在数组里找名字就行,不必再爬 `parentId`。
		// 链上一个街镇都没有 ⇒ `[]`(失败关闭 —— 不能把"我挂区级机关"的人也判成可见)。
		resolve: ({ ctx }) => {
			const res = [];
			for (const dept of ctx.depts) {
				if (
					dept.name.includes("居委会") ||
					dept.name.includes("村委会") ||
					dept.name.includes("居民委员会") ||
					dept.name.includes("村民委员会")
				) {
					res.push({ id: dept.id, name: dept.name });
				}
			}
			return Promise.resolve(res);
		},
	},

	{
		key: "my_street_tree",
		valueKeys: ["id", "name"],
		label: "我所在的街镇及以下",
		impl: "builtin",
		remark:
			"先按「我所在的街镇」找到街镇节点,再取它下面整棵子树(街镇 → 村 / 网格组 → …)。适合镇级管理员看全镇;链上没有街镇 ⇒ 空(失败关闭)",
		// 与 `my_street` 的差别:`my_street` 只回街镇**一个**节点(常配 `town_id`),
		// 这个回「街镇 + 其下所有部门」(常配 `dept_id` / `town_id`)。
		resolve: async ({ ctx }) => {
			const street = ctx.depts.find((dept) => STREET_NAME_SET.has(dept.name));
			if (!street) return [];
			const nodes = await loadDeptNodes();
			const byId = new Map(nodes.map((node) => [node.id, node.name]));
			return collectDescendantIds(nodes, [street.id]).map((id) => ({ id, name: byId.get(id) ?? "" }));
		},
	},

	{
		// 保留 key 用:挡用户在「新建插件」里建一个同名条目(装载时内置优先,库里那条
		// 永远轮不到,留着只会让人以为多了一个插件)。
		//
		// **它不是兜底**:`resolvePluginValues()` 对未知 key 直接返 `null`(规则当无效),
		// 不会回退到这里;`hidden: true` 又让 `LISTED_BUILTIN_PLUGIN_KEYS` / `listPlugins()`
		// 把它滤掉,所以界面永远不提供它。`resolve` 恒返 `[]` 只是占位。
		//
		// 条目本身不能删:`tests/data-scope.test.ts` 断言它是保留 key 且不可删。
		key: "fixed",
		valueKeys: [],
		label: "指定清单(保留 key)",
		impl: "builtin",
		hidden: true,
		remark:
			"保留 key:挡用户建同名插件,**不是兜底**。未知 key 由引擎直接判为「规则无效」(返 `null`),不会回退到这里;`hidden` 又让它不进可选清单,界面上看不到它。",
		resolve: () => Promise.resolve([]),
	},
];

/**
 * 内置插件的 key(**含 `hidden` 的兜底**;`BUILTIN_PLUGINS` 里全部)——
 * 插件 CRUD 拿它挡写入(`sys_data_plugin` 里出现同名行没有意义:装载时内置优先,
 * 库里那条永远轮不到,见 `loadPlugins()`),连 `fixed` 也一并保留,免得用户建一个同名的假清单。
 */
export const BUILTIN_PLUGIN_KEYS: readonly string[] = BUILTIN_PLUGINS.map((plugin) => plugin.key);

/**
 * 界面清单里**真正会看到**的内置 key(`hidden` 的不算)。
 *
 * 与 `BUILTIN_PLUGIN_KEYS` 的差别:`fixed` 是保留 key、不可选,不在这里 —— 用例按这个数个数。
 */
export const LISTED_BUILTIN_PLUGIN_KEYS: readonly string[] = BUILTIN_PLUGINS.filter((plugin) => !plugin.hidden).map(
	(plugin) => plugin.key,
);

// ── 自定义插件:清单(`output_values`) ──────────────────────────────────────

/**
 * 库行 → 可求值的插件(`output_values` 类)。
 *
 * v2 起:不再编译函数体 —— 直接把 `{key, value}[]` 拼进 `resolve` 的返值里。
 * 「输出值」是插件的属性:每条规则引用某个 plugin,引擎到这条 plugin 的 `output_values`
 * 取清单拼 SQL —— 规则的 `column` 决定比哪一列,`value_key` 决定**取清单里的哪个 key**
 * (m23422:同一个清单可以放多类值,如 `town_id` 与 `risk_level`,各配一条规则互不干扰)。
 *
 * 坏行(`output_values` 为空 / 字段非法)返回 `null`(留一条 warn),不让一条脏数据影响别的规则。
 */
function toPlugin(row: typeof sysDataPlugin.$inferSelect): ResolvedPlugin | null {
	const items = parseItems(row.output_values);
	if (items.length === 0) {
		logger.warn("data_scope.plugin_broken", { key: row.plugin_key, reason: "output_values 为空" });
		return null;
	}

	const rows: Record<string, string>[] = items.map((it) => ({ [it.key]: it.value }));

	return {
		key: row.plugin_key,
		label: row.label || row.plugin_key,
		remark: row.remark || undefined,
		impl: "fn",
		// 一行只有一个 key,所以「会给哪些 key」就是清单里出现过的那些(去重、保持先后顺序)
		valueKeys: [...new Set(items.map((it) => it.key))],
		resolve: () => Promise.resolve(rows),
	};
}

// ── 装载 + 缓存 ─────────────────────────────────────────────────────────────

/**
 * 插件缓存 —— 与 `sys_para` 同一个手法(30 秒 TTL + 写操作后主动清)。
 *
 * 为什么非缓不可:策略行上只有 `plugin_key`,每个读接口都要先拿到插件定义;`toPlugin()`
 * 每次都跑(还要 `parseItems`)的话几十行表也是浪费。多实例时"我这边的 CRUD 清了缓存"
 * 不等于"别人也清了",所以 TTL 之外还靠 TTL 兜底(30 秒后必然重查)。
 */
const PLUGIN_CACHE_TTL_MS = 30_000;
let pluginCache: { at: number; map: Map<string, ResolvedPlugin> } | null = null;

/** 插件增 / 删 / 改之后清缓存(插件路由的每个 mutation 尾部都要调) */
export function clearPluginCache(): void {
	pluginCache = null;
}

/**
 * 全部可用插件:**内置优先**。
 *
 * 表里若有一行和内置同名,以内置为准(留一条 warn)—— 内置那些是权限地基,
 * 不该被一张表里的行顶掉;真撞了名,把表里那行改个 `plugin_key` 即可。
 */
export async function loadPlugins(): Promise<Map<string, ResolvedPlugin>> {
	if (pluginCache && Date.now() - pluginCache.at < PLUGIN_CACHE_TTL_MS) return pluginCache.map;

	const map = new Map<string, ResolvedPlugin>();
	for (const plugin of BUILTIN_PLUGINS) map.set(plugin.key, plugin);

	const rows = await db
		.select()
		.from(sysDataPlugin)
		.where(and(eq(sysDataPlugin.status, 1), alive(sysDataPlugin)));
	for (const row of rows) {
		if (map.has(row.plugin_key)) {
			logger.warn("data_scope.plugin_shadowed", { key: row.plugin_key });
			continue;
		}
		const plugin = toPlugin(row);
		if (plugin) map.set(plugin.key, plugin);
	}

	pluginCache = { at: Date.now(), map };
	return map;
}

/**
 * 界面清单:内置在前,其余按名字排。**不带 `resolve` / `hidden`**,可以安全地回给客户端。
 *
 * `hidden` 的内置(`fixed`)**不出现** —— 它是保留 key,列出来只会让人选中一个恒返空的插件。
 * 引擎侧仍从 `loadPlugins()` 拿得到它(`loadPlugins` 才是"全部可用插件")。
 */
export async function listPlugins(): Promise<PluginInfo[]> {
	const plugins = [...(await loadPlugins()).values()].filter((plugin) => !plugin.hidden);
	plugins.sort(
		(a, b) => Number(b.impl === "builtin") - Number(a.impl === "builtin") || a.label.localeCompare(b.label, "zh"),
	);
	return plugins.map(({ resolve: _resolve, hidden: _hidden, ...info }) => info);
}

// ── 求值入口 ────────────────────────────────────────────────────────────────

/** 插件求值超时:插件是"别人写的代码",不能让它把读接口挂住(同步死循环拦不住,异步卡住能拦) */
const PLUGIN_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`插件求值超过 ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

/**
 * 按 `plugin_key` 求值 —— 策略侧(`lib/data-scope.ts`)的唯一入口。
 *
 * 返回 `null` 表示**这条规则不可用**(插件不存在 / 编译不过 / 抛异常 / 超时),调用方按
 * "这条规则无效"处理 —— 既不是"放行",也不是"什么也看不见";是否 500 由调用方决定(我们不 500)。
 * 已在这里留好 `warn`,所以上层不必重复记日志。
 *
 * v1.4 (m18655):返回值从 `string[]` 改为 `Record<string,string>[]`(一行一个对象),
 * 引擎按规则的 `column` 当 key 取值(`row[column]`)。详见 `ResolvedPlugin.resolve` doc。
 */
export async function resolvePluginValues(key: string, args: ResolveArgs): Promise<Record<string, string>[] | null> {
	const plugin = (await loadPlugins()).get(key);
	if (!plugin) {
		logger.warn("data_scope.plugin_missing", { key });
		return null;
	}
	try {
		return toValueRows(await withTimeout(plugin.resolve(args), PLUGIN_TIMEOUT_MS));
	} catch (error) {
		logger.warn("data_scope.plugin_failed", {
			key,
			message: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

// ── 保存前的检查(插件路由用) ───────────────────────────────────────────────

/**
 * **预览值域**(插件页的「预览」按钮):拿真实的人跑一次,把结果或原因原样回给管理员。
 *
 * 与 `resolvePluginValues()` 的区别只在"要不要原因":那个给策略侧用,失败一律 `null`;
 * 这个给人看,必须知道自己错在哪。内置插件也能预览。
 *
 * v1.4 (m18655):返 `rows: Record<string,string>[]`(原始对象数组),不查名字、不扁平化。
 * 前端按规则的 `column` 在 `rows[i][column]` 取值并展示 —— 也可以无视 column 直接
 * 把整个对象列出来。
 *
 * v2 (m20034):「清单」类自定义插件直接消费自己的 `output_values`,**`args` 不再传 items**;
 * 内置插件照样按 ctx 算。
 */
export async function testPlugin(
	key: string,
	args: ResolveArgs,
): Promise<{ ok: boolean; rows: Record<string, string>[]; message?: string }> {
	const plugin = (await loadPlugins()).get(key);
	if (!plugin) return { ok: false, rows: [], message: `没有这个插件:${key}` };
	try {
		const rows = toValueRows(await withTimeout(plugin.resolve(args), PLUGIN_TIMEOUT_MS));
		return {
			ok: true,
			rows,
			message: rows.length === 0 ? "没有取到任何值 —— 用它做条件会编译成 `1 = 0`(一行也看不到)" : undefined,
		};
	} catch (error) {
		return { ok: false, rows: [], message: error instanceof Error ? error.message : String(error) };
	}
}
