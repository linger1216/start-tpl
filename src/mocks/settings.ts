/**
 * 系统设置 · 统一授权管理 —— 用户管理 / 用户组管理 / 角色管理 三个页面的 mock 数据源。
 *
 * | 页面         | 本文件提供的东西                                      |
 * | ------------ | ----------------------------------------------------- |
 * | 用户管理     | `userTable` + `userStats`(单用户与批量授权共用)      |
 * | 用户组管理   | `groupTable` + `groupStats` + 成员 / 组授权写回       |
 * | 角色管理     | `roleTable` + `roleStats` + 权限树 / 权限点清单       |
 *
 * 本文件是**数据契约中枢**(见 `doc/前端结构与组件约定.md` §11.3):
 * 行类型 / 种子 / 权限点枚举 / 统计口径 `xxxStats(rows)` / Excel 列 `XXX_EXCEL_COLUMNS` 都在这里,
 * 组件层只负责取数与渲染。
 *
 * 硬性约定(与 `#/mocks/shared` 一致):禁止 `Math.random` / `new Date`;
 * **权限树由 `NAV_NODES`(全站菜单唯一来源)派生** —— 所以改 `nav-config.ts` 之后,
 * 角色种子里那些 `选` 的匹配式也要跟着核对(见 `ROLE_SPECS` 的注释),否则角色会匹配到 0 个权限点。
 *
 * 两条刻意保留的设计(派生新项目时值得照搬):
 *  - **一人多组 / 多角色**:`所属用户组` 与 `角色` 都是 `string[]`,
 *    用户组与用户双向一致(`成员ids` ↔ `所属用户组`),加入新组不从原组摘除。
 *  - **派生计数不落库**:`本人权限点数` / `有效权限点数` / `成员数` / `已授权权限数`
 *    / `关联用户数` 都是渲染期按授权数组算出的派生值,不进表单与导入导出。
 */
import type { NavNode } from "#/components/layout/nav-config";
import { MODULE_OPERATIONS, menuPermissionCode, modulePermissionCode, NAV_NODES } from "#/components/layout/nav-config";
import type { ExcelColumn } from "#/lib/excel";
import { createMockTable, type MockTableStore } from "#/lib/mock-table";
import { DEPT_NAMES } from "#/mocks/dicts";
import { dateBefore, idOf, personName, phone, pick, stampBefore } from "#/mocks/shared";

// ══ 一、权限点(菜单权限 + 操作权限 + 权限树) ════════════════════
export type PermissionKind = "目录" | "菜单" | "操作";
export type PermissionNode = {
	id: string;
	name: string;
	code: string;
	kind: PermissionKind;
	children?: PermissionNode[];
};
/** 存库的权限点(扁平化,供清单表 / 计数 / Excel 导出) */
export type PermissionPoint = {
	id: string;
	code: string;
	name: string;
	kind: PermissionKind;
	所属模块: string;
	说明: string;
};

/**
 * 每个一级模块下固定的操作权限 + 菜单 → 权限点编码,都取自 `nav-config.ts`
 * (权限点编码的唯一真源;这里不再抄一份,避免两处漂移)。
 */
const OPERATIONS = MODULE_OPERATIONS;

const menuCode = menuPermissionCode;

/** 菜单节点 → 权限节点:有 path 的是菜单,只有 children 的是目录 */
function navToPermission(node: NavNode, moduleCode: string, index: number): PermissionNode {
	const code = node.path ? menuCode(node.path) : `dir:${moduleCode}:${index + 1}`;
	const children = (node.children ?? []).map((child, i) => navToPermission(child, moduleCode, i));
	return {
		id: code,
		name: node.name,
		code,
		kind: node.path ? "菜单" : "目录",
		...(children.length ? { children } : {}),
	};
}

/** 权限树 —— 菜单权限逐项对齐 `NAV_NODES`,每个一级模块再挂一组操作权限 */
export const PERMISSION_TREE: PermissionNode[] = NAV_NODES.map((module, index) => {
	const moduleCode = modulePermissionCode(module, index);
	const menus = (module.children ?? []).map((child, i) => navToPermission(child, moduleCode, i));
	const operations: PermissionNode[] = OPERATIONS.map((name, i) => ({
		id: `op:${moduleCode}:${i + 1}`,
		name,
		code: `op:${moduleCode}:${i + 1}`,
		kind: "操作",
	}));
	return { id: moduleCode, name: module.name, code: moduleCode, kind: "目录", children: [...menus, ...operations] };
});

/** 勾选某个节点时要落库的权限点(目录节点自身不计入,只取其子节点) */
export function permissionIdsIn(node: PermissionNode): string[] {
	if (node.kind === "目录") return (node.children ?? []).flatMap(permissionIdsIn);
	return [node.id, ...(node.children ?? []).flatMap(permissionIdsIn)];
}

/** 权限树 → 扁平权限点清单 */
function flatten(nodes: PermissionNode[], module: string, out: PermissionPoint[]): void {
	for (const node of nodes) {
		const 说明 = node.kind === "操作" ? `${module}模块的${node.name}操作权限` : `菜单:${module} / ${node.name}`;
		out.push({
			id: node.id,
			code: node.code,
			name: node.name,
			kind: node.kind,
			所属模块: module,
			说明: node.kind === "目录" ? `${module}模块分组节点` : 说明,
		});
		if (node.children) flatten(node.children, module, out);
	}
}

/** 全部权限点(扁平) */
export const PERMISSION_POINTS: PermissionPoint[] = PERMISSION_TREE.flatMap((m) => {
	const out: PermissionPoint[] = [];
	flatten([m], m.name, out);
	return out;
});
/** 可授权的权限点 id(目录只作分组,不单独授权) */
export const ALL_PERMISSION_IDS: string[] = PERMISSION_POINTS.filter((p) => p.kind !== "目录").map((p) => p.id);
/** 权限点 id → 中文名 */
export const PERMISSION_NAME_OF: Record<string, string> = Object.fromEntries(
	PERMISSION_POINTS.map((p) => [p.id, p.name]),
);

/** 权限点清单表(角色管理页的只读目录);数据即 `PERMISSION_POINTS`,页面自写列 */
export const permissionPointTable: MockTableStore<PermissionPoint> = createMockTable(PERMISSION_POINTS, "PERM");

/** 把「A、B、C」这类分隔文本拆成数组(Excel 导入 / 历史文本写法仍是这种形态) */
export function splitGrantValues(value: unknown): string[] {
	return String(value ?? "")
		.split(/[、,，;；|]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

/**
 * 多值字段的统一读法。
 *
 * 库里的形态有三种,读的时候都要吃得下:
 *  1. `["A", "B"]` —— 种子数据与授权写回落库的形态;
 *  2. `"A、B"` / `"A,B"` —— Excel 导入写回来的文本形态;
 *  3. 空数组 / 空串 —— 未分配。
 * 统一成**去重后的数组**,因此调用方不必再关心 `String(row.角色)` 这类旧写法。
 */
export function listOf(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	const raw = Array.isArray(value) ? value : [value];
	return [...new Set(raw.flatMap((item) => splitGrantValues(item)))];
}

/** 多值字段写回时的入库形态:去空、去重、保持顺序 */
export function uniqueList(values: readonly string[]): string[] {
	return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

/** 多值字段的展示文本(授权记录里的「角色 A、B」) */
export function joinList(values: readonly string[]): string {
	return values.join("、");
}

// ══ 二、角色表 ═══════════════════════════════════════════════
export type RoleRow = {
	id: string;
	角色名: string;
	角色编码: string;
	数据范围: string;
	状态: string;
	创建时间: string;
	备注: string;
	/** 已授权的权限点 id(多值数组,存 row 上,不进表格) */
	权限点: string[];
};

export const DATA_SCOPES = ["全部数据", "本部门及下级", "本部门数据", "仅本人数据", "自定义范围"];

/** 权限点选择器:(权限点 id, 序号) => 是否拥有该权限 */
type PermissionMatcher = (id: string, index: number) => boolean;

/**
 * 角色种子里的匹配写法:`all` / `even` / `third` / `op` / `has:x` / `not:x` / `re:正则`。
 *
 * 按**第一个冒号**切开:冒号左边是写法,右边整个是参数 —— 所以 `re:` 的正则里
 * 可以放心带冒号(权限点 id 都是 `模块:页面` 的形状,不带这句就没法精确匹配)。
 */
function matcherOf(token: string): PermissionMatcher {
	const at = token.indexOf(":");
	const kind = at === -1 ? token : token.slice(0, at);
	const value = at === -1 ? "" : token.slice(at + 1);
	if (kind === "all") return () => true;
	if (kind === "even") return (_, i) => i % 2 === 0;
	if (kind === "third") return (_, i) => i % 3 === 0;
	if (kind === "op") return (id) => id.startsWith("op:") && id.endsWith(":1");
	if (kind === "has") return (id) => id.includes(value);
	if (kind === "not") return (id) => !id.includes(value);
	return (id) => new RegExp(value).test(id);
}

/**
 * 角色种子:{名, 码, 范围, 态, 天(创建于几天前), 注, 选}
 *
 * ⚠️ `选` 里的匹配式**必须与 `nav-config.ts` 的 `NAV_NODES` 对得上**。
 * 权限点 id 的形状由 `nav-config.ts` 派生:
 *  - 菜单 = 路径冒号化 → `settings:users`、`settings:tags`、`demo:table`;
 *  - 操作 = `op:<模块码>:<序号>` → `op:settings:1`…`op:settings:7`,
 *    `op:module-1`…`op:module-3`(无 path 的分组回落到 `module-<序号>`,见 `modulePermissionCode`)。
 *
 * **改了菜单一定要回来核对这里** —— 匹配不到任何权限点的角色,在「角色管理」页会显示 0 项权限,
 * 而且不会报错(这是本项目踩过的坑)。
 */
const ROLE_SPECS = [
	{
		名: "超级管理员",
		码: "ROLE_SUPER_ADMIN",
		范围: "全部数据",
		态: "启用",
		天: 420,
		注: "系统内置角色,独占全部菜单与操作权限",
		选: "all",
	},
	{
		名: "系统管理员",
		码: "ROLE_SYS_ADMIN",
		范围: "全部数据",
		态: "启用",
		天: 390,
		注: "系统设置的全部页面 + 各模块的操作权限;不含组件展示与框架能力",
		选: "re:^(settings:|op:)",
	},
	{
		名: "组件库维护",
		码: "ROLE_SHOWCASE",
		范围: "仅本模块",
		态: "启用",
		天: 360,
		注: "标签管理 —— 维护标签树的人",
		选: "re:^settings:tags$",
	},
	{
		名: "前端开发",
		码: "ROLE_FE_DEV",
		范围: "仅本模块",
		态: "启用",
		天: 330,
		注: "框架能力样例页",
		选: "re:^demo:",
	},
	{
		名: "权限管理员",
		码: "ROLE_RBAC",
		范围: "全部数据",
		态: "启用",
		天: 300,
		注: "用户管理页,负责授权",
		选: "re:^settings:users$",
	},
	{
		名: "配置管理员",
		码: "ROLE_CONFIG",
		范围: "全部数据",
		态: "启用",
		天: 260,
		注: "菜单 / 字典 / 参数三页,负责系统配置",
		选: "re:^settings:(menus|dictionary|parameters)$",
	},
	{
		名: "只读审计员",
		码: "ROLE_AUDITOR",
		范围: "全部数据",
		态: "启用",
		天: 210,
		注: "只保留各模块的「查看」操作权限,不允许任何写操作",
		选: "op",
	},
	{
		名: "待分配",
		码: "ROLE_PENDING",
		范围: "仅本人数据",
		态: "停用",
		天: 120,
		注: "新入职的默认角色,权限点按序号隔位发放(演示用)",
		选: "even",
	},
];

export const ROLE_NAMES: string[] = ROLE_SPECS.map((spec) => spec.名);

// ══ 三、用户表 / 用户组表 ═════════════════════════════════════
export type UserRow = {
	id: string;
	账号: string;
	姓名: string;
	手机号: string;
	所属部门: string;
	/**  一人可同时属于多个用户组(空数组 = 未分配组) */
	所属用户组: string[];
	/**  一人可同时拥有多个角色 */
	角色: string[];
	状态: string;
	最近登录时间: string;
	/** 该用户**本人**被直接授予的权限点 id(组 / 角色带来的权限另行推导,不落库) */
	权限点: string[];
};

export type GroupRow = {
	id: string;
	组名: string;
	所属条线: string;
	已授权角色: string[];
	状态: string;
	创建时间: string;
	/** 成员的用户 id 列表(数组;与用户侧「所属用户组」双向一致) */
	成员ids: string[];
	/** 本组被授予的权限点 id */
	权限点: string[];
};

/**
 * 用户组的条线候选 —— 与用户部门同一口径(系统字典 `#/mocks/dicts` 的部门树)。
 *
 * 保持 `string[]` 形状以兼容用户 / 用户组种子的「所属条线」字段;
 * 数据源那边存的是 `dept_id`,展示时用 `deptName` 回查 —— 一处维护,避免两张部门清单。
 */
export const DEPARTMENTS: readonly string[] = DEPT_NAMES;

/** 账号状态枚举(表单下拉 / 快速筛选 / 导入校验共用) */
export const USER_STATUSES = ["启用", "停用", "锁定"];
/** 用户组状态枚举 */
export const GROUP_STATUSES = ["启用", "停用"];
/** 角色状态枚举 */
export const ROLE_STATUSES = ["启用", "停用"];

/**
 * 用户组种子:{组, 条线, 态, 角色, 选}
 *
 * `角色` 必须是 `ROLE_SPECS` 里的名字,`条线` 必须是 `DEPARTMENTS` 里的取值 ——
 * 两处对不上时,组授权会挂到一个不存在的角色上(页面表现为"已授权角色"是空)。
 */
const GROUP_SPECS = [
	{ 组: "系统管理组", 条线: "信息技术科", 态: "启用", 角色: "系统管理员", 选: "re:^(settings:|op:)" },
	{ 组: "标签维护组", 条线: "信息技术科", 态: "启用", 角色: "组件库维护", 选: "re:^settings:tags$" },
	{ 组: "前端开发组", 条线: "信息技术科", 态: "启用", 角色: "前端开发", 选: "re:^demo:" },
	{ 组: "权限管理组", 条线: "综合办公室", 态: "启用", 角色: "权限管理员", 选: "re:^settings:users$" },
	{
		组: "配置管理组",
		条线: "数据管理科",
		态: "启用",
		角色: "配置管理员",
		选: "re:^settings:(menus|dictionary|parameters)$",
	},
	{ 组: "审计组", 条线: "监督检查科", 态: "启用", 角色: "只读审计员", 选: "op" },
	{ 组: "只读访客组", 条线: "业务一处", 态: "停用", 角色: "只读审计员", 选: "third" },
	{ 组: "新员工组", 条线: "人事科", 态: "停用", 角色: "待分配", 选: "even" },
];

export const GROUP_NAMES: string[] = GROUP_SPECS.map((spec) => spec.组);
/** 用户组的条线候选:组种子用到的条线 + 用户部门(「综合管理」是用户组特有的条线口径) */
export const GROUP_LINES: string[] = [...new Set([...GROUP_SPECS.map((spec) => spec.条线), ...DEPARTMENTS])];
/** 种子里的状态分布(确定性取值:24 人里有停用与锁定,不是清一色启用) */
const USER_STATUS_PATTERN = ["启用", "启用", "启用", "启用", "停用", "锁定"];
/** 每个用户的角色数(确定性取值:超管之外的骨干确实同时持 2~3 个角色) */
const USER_ROLE_COUNT = [2, 3, 1, 2, 3, 1];
/** 每个用户的用户组数(确定性取值:确实存在同时属于 2 个组的用户) */
const USER_GROUP_COUNT = [1, 2, 2, 1, 2, 1];

/**
 * 24 个用户:角色 1~3 个、用户组 1~2 个、本人另有少量直接授权。
 *  —— 多组多角色在这里就是种子事实,不是"理论上支持"。
 */
const USER_SEED: UserRow[] = Array.from({ length: 24 }, (_, i) => {
	const 角色 = uniqueList(Array.from({ length: pick(USER_ROLE_COUNT, i) }, (_, k) => pick(ROLE_NAMES, i * 2 + k * 3)));
	const 所属用户组 = uniqueList(
		Array.from({ length: pick(USER_GROUP_COUNT, i) }, (_, k) => pick(GROUP_NAMES, i + k * 3)),
	);
	const own = ALL_PERMISSION_IDS.filter((_, k) => (k + i * 5) % 41 === 0).slice(0, 6);
	return {
		id: idOf("USR", i + 1),
		账号: `demo${String(i + 1).padStart(3, "0")}`,
		姓名: personName(i + 2),
		手机号: phone(i + 2),
		所属部门: pick(DEPARTMENTS, i),
		所属用户组,
		角色,
		状态: pick(USER_STATUS_PATTERN, i),
		最近登录时间: stampBefore((i % 29) + 1, i * 3),
		权限点: own,
	};
});

export const userTable: MockTableStore<UserRow> = createMockTable(USER_SEED, "USR");

const GROUP_SEED: GroupRow[] = GROUP_SPECS.map(({ 组, 条线, 态, 角色, 选 }, i) => {
	//:用户侧是数组,组成员按「多组归属」反查 —— 一个人可以同时出现在多个组的成员ids 里
	const members = USER_SEED.filter((user) => groupsOfUser(user).includes(组)).map((user) => user.id);
	const 权限点 = ALL_PERMISSION_IDS.filter(matcherOf(选));
	return {
		id: idOf("GRP", i + 1),
		组名: 组,
		所属条线: 条线,
		状态: 态,
		已授权角色: [角色],
		成员ids: members,
		创建时间: dateBefore(200 + i * 17),
		权限点,
	};
});

export const groupTable: MockTableStore<GroupRow> = createMockTable(GROUP_SEED, "GRP");

// ══ 四、角色表 / 授权记录表(授权结果的落库证据) ═════════════════
const OPERATOR = "当前登录人(系统管理员)";

export type GrantRecordRow = {
	id: string;
	授权对象类型: string;
	授权对象: string;
	授权内容: string;
	授权来源: string;
	操作人: string;
	授权时间: string;
	说明: string;
};
type GrantRecordDraft = Omit<GrantRecordRow, "id">;

/** 一条授权记录的构造(种子与运行时写回共用,保证字段口径一致) */
const grantRecord = (
	类型: string,
	对象: string,
	内容: string,
	来源: string,
	分钟: number,
	说明 = "由系统设置页写入的授权记录",
): GrantRecordDraft => ({
	授权对象类型: 类型,
	授权对象: 对象,
	授权内容: 内容,
	授权来源: 来源,
	操作人: OPERATOR,
	授权时间: stampBefore(0, 分钟),
	说明,
});
/** 授权对象展示名:张三(demo001) */
const userRef = (user: UserRow) => `${user.姓名}(${user.账号})`;

export const roleTable: MockTableStore<RoleRow> = createMockTable(
	ROLE_SPECS.map(({ 名, 码, 范围, 态, 天, 注, 选 }, i) => {
		const 权限点 = ALL_PERMISSION_IDS.filter(matcherOf(选));
		return {
			id: idOf("ROLE", i + 1),
			角色名: 名,
			角色编码: 码,
			数据范围: 范围,
			状态: 态,
			创建时间: dateBefore(天),
			备注: 注,
			权限点,
		};
	}),
	"ROLE",
);

/** 授权对象类型枚举(授权记录表的字段口径;写回函数只产出这三种) */
// 授权来源文案的枚举:单用户授权 / 批量授权 / 用户组授权 / 角色授权配置 / 继承(用户组) —— 见各写回函数

export const GRANT_TARGET_TYPES = ["用户", "用户组", "角色"];
const GRANT_RECORD_SEED: GrantRecordRow[] = [
	...USER_SEED.slice(0, 5).map((u, i) =>
		grantRecord(
			"用户",
			userRef(u),
			`角色 ${joinList(rolesOfUser(u)) || "—"} · 本人权限点 ${ownPermissionIds(u).length} 项`,
			"单用户授权",
			i + 1,
		),
	),
	...USER_SEED.slice(5, 8).map((u, i) =>
		grantRecord(
			"用户",
			userRef(u),
			`继承用户组「${joinList(groupsOfUser(u))}」的授权`,
			"继承(用户组)",
			i + 2,
			"组授权后由组内成员继承",
		),
	),
	...ROLE_SPECS.slice(0, 3).map((r) =>
		grantRecord(
			"角色",
			r.名,
			`权限点 ${ALL_PERMISSION_IDS.filter(matcherOf(r.选)).length} 项 · 数据范围 ${r.范围}`,
			"角色授权配置",
			3,
			"按角色配置权限",
		),
	),
	...GROUP_SPECS.slice(0, 3).map((g) =>
		grantRecord(
			"用户组",
			g.组,
			`角色 ${g.角色} · 权限点 ${ALL_PERMISSION_IDS.filter(matcherOf(g.选)).length} 项`,
			"用户组授权",
			4,
			"给整个用户组授权",
		),
	),
].map((record, i) => ({ id: idOf("GRT", i + 1), ...record }));

export const grantRecordTable: MockTableStore<GrantRecordRow> = createMockTable(GRANT_RECORD_SEED, "GRT");

// ══ 五、授权写回(页面调用,真改 mock 表) ═══════════════════════
export type GrantPayload = {
	角色?: string[];
	权限点?: string[];
	/** 落进授权记录表的来源,如「单用户授权」「批量授权」「用户组授权」 */
	来源: string;
	说明?: string;
};

function appendGrantRecords(records: GrantRecordDraft[]): void {
	if (records.length > 0) grantRecordTable.getState().insert(records);
}

/**
 * 给一批用户写入角色 / 权限点,并为每个用户补一条授权记录。
 * 单用户授权与批量授权共用这一个入口 —— 都是真写回,不是只弹提示。
 *
 * 角色以**数组**落库(一次写多个),因此弹窗里的多选是真实多角色归属;
 * 「所属用户组」不在这里动 —— 多组归属由用户组页的「管理成员」维护,避免两个入口互相踩。
 */
export function grantToUsers(userIds: string[], payload: GrantPayload): number {
	const users = userTable.getState().rows.filter((row) => userIds.includes(row.id));
	const roles = uniqueList(payload.角色 ?? []);
	const permissions = uniqueList(payload.权限点 ?? []).filter((id) => PERMISSION_NAME_OF[id] !== undefined);
	for (const user of users) {
		userTable.getState().update(user.id, { 角色: roles, 权限点: permissions });
	}
	const 内容 = `角色 ${joinList(roles) || "—"} · 权限点 ${permissions.length} 项`;
	appendGrantRecords(
		users.map((user, i) => grantRecord("用户", userRef(user), 内容, payload.来源, i * 4, payload.说明 ?? "用户级授权")),
	);
	return users.length;
}

/** 组内成员(以组成员列表为准,按用户表反查) */
export function membersOfGroup(group: GroupRow): UserRow[] {
	const ids = new Set(listOf(group.成员ids));
	return userTable.getState().rows.filter((row) => ids.has(row.id));
}

/** :给整个用户组授权;组内成员的有效权限由 `effectivePermissionIds` 推导继承 */
export function grantToGroup(groupId: string, payload: GrantPayload): { members: number } {
	const group = groupTable.getState().rows.find((row) => row.id === groupId);
	if (!group) return { members: 0 };
	const roles = uniqueList(payload.角色 ?? []);
	const permissions = uniqueList(payload.权限点 ?? []).filter((id) => PERMISSION_NAME_OF[id] !== undefined);
	groupTable.getState().update(groupId, { 已授权角色: roles, 权限点: permissions });
	const members = membersOfGroup(group);
	const groupName = String(group.组名);
	const 内容 = `角色 ${joinList(roles) || "—"} · 权限点 ${permissions.length} 项`;
	// 一条组级记录 + 每位成员一条「继承」记录 —— 让「组授权落到了人」在 mock 里可见
	appendGrantRecords([
		grantRecord("用户组", groupName, 内容, payload.来源, 1, payload.说明 ?? "用户组级授权"),
		...members.map((member, i) =>
			grantRecord(
				"用户",
				userRef(member),
				`继承用户组「${groupName}」的授权(${permissions.length} 项权限)`,
				"继承(用户组)",
				i * 3,
				"组授权后成员自动继承",
			),
		),
	]);
	return { members: members.length };
}

/**
 * :管理成员 —— 重设**本组**成员,并双向同步用户的「所属用户组」多值列表。
 *
 *  一人多组:加入本组只往用户的多组列表里追加,不再从原组摘除;
 * 移除也只摘掉本组那一项,用户在其他组的归属保持不变。
 */
export function setGroupMembers(groupId: string, memberIds: string[]): { added: number; removed: number } {
	const group = groupTable.getState().rows.find((row) => row.id === groupId);
	if (!group) return { added: 0, removed: 0 };
	const groupName = String(group.组名);
	const before = new Set(listOf(group.成员ids));
	const after = new Set(memberIds);
	const added = [...after].filter((id) => !before.has(id));
	const removed = [...before].filter((id) => !after.has(id));
	const ordered = userTable
		.getState()
		.rows.filter((row) => after.has(row.id))
		.map((row) => row.id);
	groupTable.getState().update(groupId, { 成员ids: ordered });
	for (const id of added) {
		const user = userTable.getState().rows.find((row) => row.id === id);
		if (!user) continue;
		userTable.getState().update(id, { 所属用户组: uniqueList([...groupsOfUser(user), groupName]) });
	}
	for (const id of removed) {
		const user = userTable.getState().rows.find((row) => row.id === id);
		if (!user) continue;
		userTable.getState().update(id, { 所属用户组: groupsOfUser(user).filter((name) => name !== groupName) });
	}
	return { added: added.length, removed: removed.length };
}

/** :按角色配置权限点与数据范围;角色下的用户随之获得这部分权限(返回受影响用户数) */
export function setRolePermissions(
	roleId: string,
	payload: { 权限点: string[]; 数据范围?: string; 备注?: string },
): number {
	const role = roleTable.getState().rows.find((row) => row.id === roleId);
	if (!role) return 0;
	const permissions = uniqueList(payload.权限点).filter((id) => PERMISSION_NAME_OF[id] !== undefined);
	roleTable.getState().update(roleId, {
		权限点: permissions,
		...(payload.数据范围 ? { 数据范围: payload.数据范围 } : {}),
		...(payload.备注 === undefined ? {} : { 备注: payload.备注 }),
	});
	const affected = countUsersWithRole(String(role.角色名));
	const 范围 = payload.数据范围 ?? String(role.数据范围);
	appendGrantRecords([
		grantRecord(
			"角色",
			String(role.角色名),
			`权限点 ${permissions.length} 项 · 数据范围 ${范围}`,
			"角色授权配置",
			2,
			`该角色下的 ${affected} 个用户随角色继承本次配置`,
		),
	]);
	return affected;
}

// ══ 六、多值字段读法 + 权限推导 ═══════════════════════════════
/** 读侧只关心字段名,不关心具体行类型;`UserRow` / `GroupRow` / `GrantRecordRow` 都能传 */
type MockRowLike = Record<string, unknown>;

/**:用户的所属用户组(多组) */
export function groupsOfUser(user: MockRowLike): string[] {
	return listOf(user.所属用户组);
}

/**:用户的角色(多角色) */
export function rolesOfUser(user: MockRowLike): string[] {
	return listOf(user.角色);
}

/** 用户本人被直接授予的权限点(不含组 / 角色继承) */
export function ownPermissionIds(user: MockRowLike): string[] {
	return listOf(user.权限点);
}

/** :持有某角色的用户数(角色列表「关联用户数」的渲染期口径) */
export function countUsersWithRole(roleName: string): number {
	return userTable.getState().rows.filter((user) => rolesOfUser(user).includes(roleName)).length;
}

/** 某用户所属的全部用户组行(多组归属,按组名匹配) */
function groupsOf(user: MockRowLike): GroupRow[] {
	const names = groupsOfUser(user);
	return groupTable.getState().rows.filter((group) => names.includes(String(group.组名)));
}

/** 该用户从「所属用户组」继承的权限点:组权限点 + 组被授予角色的权限点 */
function inheritedGroupPermissionIds(user: MockRowLike): string[] {
	const groups = groupsOf(user);
	const groupPermissionIds = groups.flatMap((group) => listOf(group.权限点));
	const groupRoleNames = groups.flatMap((group) => listOf(group.已授权角色));
	const groupRolePermissions = roleTable
		.getState()
		.rows.filter((role) => groupRoleNames.includes(String(role.角色名)))
		.flatMap((role) => listOf(role.权限点));
	return [...groupPermissionIds, ...groupRolePermissions];
}

/** 该用户从「角色」继承的权限点(多角色全部并入) */
function inheritedRolePermissionIds(user: MockRowLike): string[] {
	const roleNames = rolesOfUser(user);
	return roleTable
		.getState()
		.rows.filter((role) => roleNames.includes(String(role.角色名)))
		.flatMap((role) => listOf(role.权限点));
}

/**
 * 用户的有效权限 = 本人权限点 ∪ 所属用户组(权限点 + 组角色) ∪ 用户自己的角色权限点。
 *
 *  之后每个来源都是**多值**:一个人可能属于 2 个组、持 3 个角色,
 * 全部并入后按权限点 id 去重,再剔除已不存在的权限点。
 * 「组授权后成员继承」在 mock 里由此函数推导,不需要给每个成员重复落库。
 */
export function effectivePermissionIds(user: MockRowLike): string[] {
	const merged = [...ownPermissionIds(user), ...inheritedGroupPermissionIds(user), ...inheritedRolePermissionIds(user)];
	return [...new Set(merged)].filter((id) => PERMISSION_NAME_OF[id] !== undefined);
}

/** 有效权限数(用户管理页用来直观看到组 / 角色继承的结果;派生列与弹窗共用) */
export function effectivePermissionCount(user: MockRowLike): number {
	return effectivePermissionIds(user).length;
}

// ══ 七、统计口径(纯函数;UI 组装在域内 `<域>-<页面>-stats.tsx`) ══
/**  用户管理页的指标:总数 / 启用 / 停用锁定 / 覆盖组数 / 近 30 天登录 */
export function userStats(rows: readonly UserRow[]) {
	return {
		用户总数: rows.length,
		启用用户: rows.filter((row) => String(row.状态) === "启用").length,
		停用锁定: rows.filter((row) => ["停用", "锁定"].includes(String(row.状态))).length,
		//  一人多组:覆盖组数要按多值数组展开去重,不能把 ["A","B"] 当成一个值
		覆盖用户组数: new Set(rows.flatMap((row) => groupsOfUser(row))).size,
		近30天有登录: rows.filter((row) => String(row.最近登录时间) >= dateBefore(30)).length,
	};
}

/**  用户组管理页的指标:组数 / 组内成员合计 / 已授权的组 / 平均成员数 */
export function groupStats(rows: readonly GroupRow[]) {
	const 成员合计 = rows.reduce((acc, row) => acc + listOf(row.成员ids).length, 0);
	return {
		用户组数: rows.length,
		// 多组用户在每个所属组里各计一次,合计口径与「组内成员数」列一致
		组内成员合计: 成员合计,
		已授权的组: rows.filter((row) => listOf(row.权限点).length > 0).length,
		平均成员数: rows.length === 0 ? 0 : Math.round((成员合计 / rows.length) * 10) / 10,
	};
}

/**  角色管理页的指标:角色数 / 启用 / 权限点总量 / 关联用户合计 / 平均权限点数 */
export function roleStats(rows: readonly RoleRow[]) {
	const 权限合计 = rows.reduce((acc, row) => acc + listOf(row.权限点).length, 0);
	return {
		角色总数: rows.length,
		启用角色: rows.filter((row) => String(row.状态) === "启用").length,
		权限点总量: ALL_PERMISSION_IDS.length,
		覆盖模块数: PERMISSION_TREE.length,
		//  多角色:一个用户持 N 个角色就在这 N 行里各计一次
		关联用户合计: rows.reduce((acc, row) => acc + countUsersWithRole(String(row.角色名)), 0),
		平均权限点数: rows.length === 0 ? 0 : Math.round((权限合计 / rows.length) * 10) / 10,
	};
}

// ══ 八、Excel 列契约(导入模板 / 导出文件共用;UI 只负责渲染与调度) ══
/**
 * Excel 列定义:key 收窄成行字段名,导出时索引不会失去类型。
 *
 * 与「这份数据长什么样」有关的东西放这里(§4.1 第 2 条),页面不重复声明列头;
 * 派生列(本人权限点数 / 有效权限点数 / 成员数)不进 Excel —— 它们由授权数组算出。
 *
 * 列类型统一用公共的 `ExcelColumn`(`#/lib/excel`),本域不再自造一份同形状的类型。
 */

export const USER_EXCEL_COLUMNS: ExcelColumn<keyof UserRow>[] = [
	{ key: "账号", label: "账号", required: true, width: 14 },
	{ key: "姓名", label: "姓名", required: true, width: 10 },
	{ key: "手机号", label: "手机号", required: true, width: 14 },
	{ key: "所属部门", label: "所属部门/条线", required: true, width: 16 },
	{ key: "所属用户组", label: "所属用户组(多个用、分隔)", width: 26 },
	{ key: "角色", label: "角色(多个用、分隔)", width: 26 },
	{ key: "状态", label: "状态", required: true, width: 10 },
	{ key: "最近登录时间", label: "最近登录时间", width: 20 },
];

export const GROUP_EXCEL_COLUMNS: ExcelColumn<keyof GroupRow>[] = [
	{ key: "组名", label: "组名", required: true, width: 20 },
	{ key: "所属条线", label: "所属条线", required: true, width: 16 },
	{ key: "已授权角色", label: "已授权角色(多个用、分隔)", width: 26 },
	{ key: "状态", label: "状态", required: true, width: 10 },
	{ key: "创建时间", label: "创建时间", width: 14 },
];

export const ROLE_EXCEL_COLUMNS: ExcelColumn<keyof RoleRow>[] = [
	{ key: "角色名", label: "角色名", required: true, width: 16 },
	{ key: "角色编码", label: "角色编码", required: true, width: 20 },
	{ key: "数据范围", label: "数据范围", required: true, width: 16 },
	{ key: "状态", label: "状态", required: true, width: 10 },
	{ key: "创建时间", label: "创建时间", width: 14 },
	{ key: "备注", label: "备注", width: 40 },
];

export const PERMISSION_POINT_EXCEL_COLUMNS: ExcelColumn<keyof PermissionPoint>[] = [
	{ key: "code", label: "权限编码", required: true, width: 26 },
	{ key: "name", label: "权限名称", required: true, width: 20 },
	{ key: "kind", label: "权限类型", required: true, width: 12 },
	{ key: "所属模块", label: "所属模块", width: 16 },
	{ key: "说明", label: "说明", width: 46 },
];

export const GRANT_RECORD_EXCEL_COLUMNS: ExcelColumn<keyof GrantRecordRow>[] = [
	{ key: "授权对象类型", label: "授权对象类型", required: true, width: 14 },
	{ key: "授权对象", label: "授权对象", required: true, width: 22 },
	{ key: "授权内容", label: "授权内容", required: true, width: 34 },
	{ key: "授权来源", label: "授权来源", width: 16 },
	{ key: "操作人", label: "操作人", width: 20 },
	{ key: "授权时间", label: "授权时间", width: 18 },
	{ key: "说明", label: "说明", width: 40 },
];
