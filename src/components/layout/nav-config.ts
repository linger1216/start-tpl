/**
 * 静态导航配置 —— 菜单的**兜底 + 种子来源** + 三个纯树工具。
 *
 * 运行时菜单以数据库 `sys_menu` 表为准(`nav-menu.ts` 的 `buildNavTree` 把平铺行拼成树,
 * 侧边栏 / 面包屑 / 模块概览都读它);本文件负责三件事:
 *  1. **兜底**:`sys_menu` 表为空(或还没返回)时,渲染这棵树 —— 配置表被清空不会白屏;
 *  2. **纯树工具**:`findNavTrailIn` / `findNavNodeIn` / `navNodeContains` / `collectNavGroupIds`
 *     都只吃传进来的树,不依赖任何全局状态(读取由 `nav-data.ts` 负责);
 *  3. **种子来源**:`pnpm db:seed:menus` 把这里逐节点写进 `sys_menu` 表(只补不覆盖)。
 *
 * 侧边栏(sidebar.tsx)、面包屑(topbar.tsx)与模块概览页(module-overview.tsx)
 * 都从「当前菜单树」派生,不要在别处再维护第二份菜单或路径中文名映射。
 *
 * ── 本模板的菜单结构 ────────────────────────────────────────────
 *  工作台     `/`                    系统入口页:上手自检清单 + 各展示页入口 + UI 原语示例
 *  我的通知   `/notices`             通知中心
 *  框架能力   纯分组                  6 个能力样例:tRPC / 表单 / 表格 / 数据库 / 登录认证 / 全局状态
 *  Demo       `/demo/grid`           演示业务页「网格履职」
 *  系统设置   `/settings`             ★ 唯一保留的真实业务模块(十个页面,完整 CRUD 骨架)
 *
 * 派生新项目时:把「框架能力」这一枝删掉(连带 `routes/(main)/demo/`),
 * 再把「系统设置」按新业务改名 / 扩展即可;UI 原语的示例在工作台
 * (`components/modules/workbench/ui-gallery.tsx`),不需要时整块删掉。
 *
 * 图标约定:值来自 `NAV_ICON_MAP`,键名是「小写 kebab-case」。
 * `NavIcon` 是 `keyof NAV_ICON_MAP`,写错图标名会在 `pnpm typecheck` 阶段失败;
 * `tests/icons.test.ts` 另有一条断言盯着「`NAV_NODES` 用到的图标必须都已登记」。
 * 菜单管理页(`/settings/menus`)的图标选择器能选全量 lucide 图标,但**只有登记在本表里的
 * 才会生效**(认不出来退回 `file-text`)—— 想让新图标可用,往 `NAV_ICON_MAP` 里加一行。
 */
import {
	BarChart3,
	Bell,
	Boxes,
	Cable,
	ClipboardList,
	Contact,
	Database,
	Files,
	FileText,
	Gauge,
	KeyRound,
	LayoutDashboard,
	LayoutGrid,
	LayoutPanelTop,
	Library,
	ListChecks,
	Menu as MenuIcon,
	MessageSquare,
	Palette,
	RefreshCw,
	ScrollText,
	Settings,
	ShieldAlert,
	ShieldCheck,
	SlidersHorizontal,
	Sparkles,
	Table as TableIcon,
	Tags,
	Users,
	Workflow,
} from "lucide-react";

/**
 * 菜单可用图标表:键为「小写 kebab-case」,与存库图标名约定一致。
 *
 * **不要给这个常量加 `Record<string, …>` 标注** —— 加了之后 `keyof typeof NAV_ICON_MAP`
 * 会退化成 `string`,`NavIcon` 就再也拦不住拼错的图标名(曾经真的漏过三个)。
 */
export const NAV_ICON_MAP = {
	// 模块级
	dashboard: Gauge,
	bell: Bell,
	library: Library,
	sparkles: Sparkles,
	workflow: Workflow,
	settings: Settings,
	boxes: Boxes,
	// 组件展示
	"bar-chart-3": BarChart3,
	"layout-dashboard": LayoutDashboard,
	"clipboard-list": ClipboardList,
	table: TableIcon,
	"grid-3x3": LayoutGrid,
	"layout-panel-top": LayoutPanelTop,
	"message-square": MessageSquare,
	"list-checks": ListChecks,
	// 框架能力
	cable: Cable,
	"refresh-cw": RefreshCw,
	database: Database,
	"key-round": KeyRound,
	"shield-alert": ShieldAlert,
	"shield-check": ShieldCheck,
	// 系统设置
	users: Users,
	contact: Contact,
	tags: Tags,
	menu: MenuIcon,
	"sliders-horizontal": SlidersHorizontal,
	palette: Palette,
	"scroll-text": ScrollText,
	// 兜底
	"file-text": FileText,
	files: Files,
};

export type NavIcon = keyof typeof NAV_ICON_MAP;

export type NavNode = {
	name: string;
	path?: string;
	icon: NavIcon;
	/** 模块级节点的说明,用于模块概览页页头;叶子节点可留空。 */
	description?: string;
	children?: NavNode[];
};

/**
 * 菜单树。约定:
 *  - 有 `children` 且**无** `path` → 可折叠分组(点击整行只做展开/收起)
 *  - 有 `children` 且**有** `path` → 左侧链接跳模块首页,右侧 chevron 折叠
 *  - 叶子名称即侧边栏展示名(建议 ≤ 8 个汉字,超出会被截断)
 */
export const NAV_NODES: NavNode[] = [
	{
		name: "工作台",
		path: "/",
		icon: "dashboard",
		description: "模板入口页:上手自检清单、目录职责速查、各展示页入口。",
	},
	{
		name: "我的通知",
		path: "/notices",
		icon: "bell",
		description: "站内通知:全部已读、点一条跳到对应页面;有「发通知」权限的人还能给指定的人发一条。",
	},
	{
		name: "框架能力",
		icon: "workflow",
		description:
			"每一项框架能力一个**可运行**的样例页:TanStack Query、表单、表格、Drizzle 数据库、登录认证、全局状态(tRPC 本身贯穿所有样例)。",
		children: [
			{ name: "数据请求", path: "/demo/tanstack-query", icon: "refresh-cw" },
			{ name: "表单", path: "/demo/form/simple", icon: "clipboard-list" },
			{ name: "表格", path: "/demo/table", icon: "table" },
			{ name: "数据库", path: "/demo/drizzle", icon: "database" },
			{ name: "登录认证", path: "/demo/better-auth", icon: "key-round" },
			{ name: "全局状态", path: "/demo/store", icon: "boxes" },
			{ name: "业务首页", path: "/demo/business-home", icon: "layout-dashboard" },
		],
	},

	{
		name: "Demo",
		icon: "grid-3x3",
		description: "演示性业务页(可随 demo 一起删):目前是「网格履职」。",
		children: [{ name: "网格履职", path: "/demo/grid", icon: "grid-3x3" }],
	},
	{
		// ★ 本模板保留的真实业务模块 —— 派生新项目时从这里开始改
		name: "系统设置",
		path: "/settings",
		icon: "settings",
		description:
			"十一个页面全部接真实数据:部门(树 + 成员/角色)、角色(权限点勾选)、用户(台账 + 授权)、标签(树)、菜单(树 + 驱动侧边栏)、字典、参数、文件、审计日志、数据权限(数据范围 + 值域插件)—— 演示「列表 + 表单 + 详情 + 树形排序」的骨架。",
		children: [
			{ name: "用户管理", path: "/settings/users", icon: "users" },
			{ name: "部门管理", path: "/settings/departments", icon: "contact" },
			{ name: "角色管理", path: "/settings/roles", icon: "key-round" },
			{ name: "标签管理", path: "/settings/tags", icon: "tags" },
			{ name: "菜单管理", path: "/settings/menus", icon: "menu" },
			{ name: "字典管理", path: "/settings/dictionary", icon: "library" },
			{ name: "参数管理", path: "/settings/parameters", icon: "sliders-horizontal" },
			{ name: "文件管理", path: "/settings/files", icon: "files" },
			{ name: "审计日志", path: "/settings/logs", icon: "scroll-text" },
			{ name: "数据范围", path: "/settings/data-scope", icon: "shield-alert" },
			{ name: "值域插件", path: "/settings/data-plugins", icon: "cable" },
		],
	},
];

/** 路径是否命中某菜单节点(`/` 只精确匹配,避免命中所有路径)。 */
function isPathMatch(pathname: string, path: string): boolean {
	if (path === "/") return pathname === "/";
	return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * 在**给定菜单树**里找当前路径的命中链(面包屑 / 侧边栏展开分支)。
 * 未命中任何菜单项时返回空数组,由调用方回落到自己的兜底逻辑。
 *
 * 为什么收「树」而不是直接读 `NAV_NODES`:运行时菜单以 `sys_menu` 表为准,
 * 树可能有第二棵 —— 所以查找逻辑做成纯函数,渲染层把当前树传进来。
 */
export function findNavTrailIn(nodes: readonly NavNode[], pathname: string): NavNode[] {
	const walk = (list: readonly NavNode[], trail: NavNode[]): NavNode[] | null => {
		for (const node of list) {
			const next = [...trail, node];
			if (node.path && isPathMatch(pathname, node.path)) {
				// 命中后继续往子树里找更精确的一级(模块首页 vs 子页面)
				return (node.children ? walk(node.children, next) : null) ?? next;
			}
			if (node.children) {
				const deeper = walk(node.children, next);
				if (deeper) return deeper;
			}
		}
		return null;
	};
	return walk(nodes, []) ?? [];
}

/** 按路径精确取节点(模块概览页用来渲染自己的子树)。 */
export function findNavNodeIn(nodes: readonly NavNode[], path: string): NavNode | undefined {
	const walk = (list: readonly NavNode[]): NavNode | undefined => {
		for (const node of list) {
			if (node.path === path) return node;
			const deeper = node.children ? walk(node.children) : undefined;
			if (deeper) return deeper;
		}
		return undefined;
	};
	return walk(nodes);
}

/** 节点的子树里是否包含 pathname(折叠态下高亮当前所在模块)。 */
export function navNodeContains(node: NavNode, pathname: string): boolean {
	if (node.path && isPathMatch(pathname, node.path)) return true;
	return (node.children ?? []).some((child) => navNodeContains(child, pathname));
}

/** 全部分组(有 children 的节点)的稳定 id —— 折叠态用。 */
export function collectNavGroupIds(nodes: NavNode[] = NAV_NODES): string[] {
	const ids: string[] = [];
	const walk = (list: NavNode[]) => {
		for (const node of list) {
			if (node.children?.length) {
				ids.push(node.path ?? node.name);
				walk(node.children);
			}
		}
	};
	walk(nodes);
	return ids;
}
