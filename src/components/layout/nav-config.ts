/**
 * 静态导航配置 —— 菜单的**兜底 + 权限点派生 + 种子来源**。
 *
 * 运行时菜单以数据库 `sys_menu` 表为准(`nav-menu.ts` 的 `buildNavTree` 把平铺行拼成树,
 * 侧边栏 / 面包屑 / 模块概览都读它);本文件负责三件事:
 *  1. **兜底**:`sys_menu` 表为空(或还没返回)时,渲染这棵树 —— 配置表被清空不会白屏;
 *  2. **权限点派生**:`navRequiredPermission` / `menuPermissionCode` / `modulePermissionCode`
 *     从这棵树派生(授权页的权限点目录见 `mocks/settings.ts`,同样派生自这里);
 *  3. **种子来源**:`pnpm db:seed:menus` 把这里逐节点写进 `sys_menu` 表(只补不覆盖)。
 *
 * 侧边栏(sidebar.tsx)、面包屑(topbar.tsx)与模块概览页(module-overview.tsx)
 * 都从「当前菜单树」派生,不要在别处再维护第二份菜单或路径中文名映射。
 *
 * ── 本模板的菜单结构 ────────────────────────────────────────────
 *  工作台     `/`                    系统入口页:上手自检清单 + 各展示页入口
 *  组件展示   纯分组                  模板自带组件的「活文档」,按组件层级分 7 页
 *  框架能力   纯分组                  tRPC / Query / Form / Table / Drizzle / Auth / Store / Sentry
 *  系统设置   `/settings`             ★ 唯一保留的真实业务模块(七个页面,完整 CRUD 骨架)
 *
 * 派生新项目时:把「框架能力」这一枝删掉(连带 `routes/(main)/demo/`),
 * 再把「系统设置」按新业务改名 / 扩展即可;UI 原语的示例在工作台
 * (`components/modules/workbench/ui-gallery.tsx`),不需要时整块删掉。
 *
 * 图标约定:值来自 `NAV_ICON_MAP`,键名是「小写 kebab-case」。
 * `NavIcon` 是 `keyof NAV_ICON_MAP`,写错图标名会在 `pnpm typecheck` 阶段失败。
 * 菜单管理页(`/settings/menus`)的图标选择器能选全量 lucide 图标,但**只有登记在本表里的
 * 才会生效**(认不出来退回 `file-text`)—— 想让新图标可用,往 `NAV_ICON_MAP` 里加一行。
 */
import {
	BarChart3,
	Boxes,
	Cable,
	ClipboardList,
	Contact,
	Database,
	FileText,
	Gauge,
	KeyRound,
	LayoutPanelTop,
	Library,
	ListChecks,
	Menu as MenuIcon,
	MessageSquare,
	Palette,
	RefreshCw,
	Settings,
	ShieldAlert,
	SlidersHorizontal,
	Sparkles,
	Table as TableIcon,
	Tags,
	Users,
	Workflow,
} from "lucide-react";

import { MENU_DETAIL_PATH_PREFIX } from "#/lib/menu-detail-path";

/** 菜单可用图标表:键为「小写 kebab-case」,与存库图标名约定一致。 */
export const NAV_ICON_MAP: Record<string, typeof Gauge> = {
	// 模块级
	dashboard: Gauge,
	library: Library,
	sparkles: Sparkles,
	workflow: Workflow,
	settings: Settings,
	boxes: Boxes,
	// 组件展示
	"bar-chart-3": BarChart3,
	"clipboard-list": ClipboardList,
	table: TableIcon,
	"layout-panel-top": LayoutPanelTop,
	"message-square": MessageSquare,
	"list-checks": ListChecks,
	// 框架能力
	cable: Cable,
	"refresh-cw": RefreshCw,
	database: Database,
	"key-round": KeyRound,
	"shield-alert": ShieldAlert,
	// 系统设置
	users: Users,
	contact: Contact,
	tags: Tags,
	menu: MenuIcon,
	"sliders-horizontal": SlidersHorizontal,
	palette: Palette,
	// 兜底
	"file-text": FileText,
};

export type NavIcon = keyof typeof NAV_ICON_MAP;

export type NavNode = {
	name: string;
	path?: string;
	icon: NavIcon;
	/** 模块级节点的说明,用于模块概览页页头;叶子节点可留空。 */
	description?: string;
	/**
	 * 访问该菜单所需的**权限点编码**(可选)。
	 *
	 * 不写就按 `path` 派生(`navRequiredPermission`):`/settings/users` → `settings:users`;
	 * **带 `children` 的容器节点不派生** —— 容器的可见性由子节点决定,避免拦一个授权不了的码。
	 * 只有三种情况需要显式声明:
	 *  ① 权限点编码与页面路径不一致(沿用历史系统的编码,或一个页面被多处复用);
	 *  ② 无 `path` 的分组节点要单独拦一道(如整块「系统设置」只给管理员);
	 *  ③ 需要把权限点**钉死**(路由改名不该悄悄换掉已授权的权限点)。
	 * 声明后以本字段为准,派生值被覆盖。
	 *
	 * 读写链路:本文件派生的权限点编码 → 用户有效权限 → `filterNavByPermission`
	 * 过滤侧边栏。中间「权限点落库 → 角色授权」一段尚未落地
	 * (见 `components/layout/nav-permissions.tsx` 顶部的说明)。
	 */
	permission?: string;
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
		name: "框架能力",
		icon: "workflow",
		description:
			"每一项框架能力一个**可运行**的样例页:tRPC 接口、TanStack Query、表单、表格、Drizzle 数据库、登录认证、全局状态。",
		children: [
			{ name: "tRPC 接口", path: "/demo/trpc-todo", icon: "cable" },
			{ name: "数据请求", path: "/demo/tanstack-query", icon: "refresh-cw" },
			{ name: "表单", path: "/demo/form/simple", icon: "clipboard-list" },
			{ name: "表格", path: "/demo/table", icon: "table" },
			{ name: "数据库", path: "/demo/drizzle", icon: "database" },
			{ name: "登录认证", path: "/demo/better-auth", icon: "key-round" },
			{ name: "全局状态", path: "/demo/store", icon: "boxes" },
		],
	},
	{
		// ★ 本模板唯一保留的真实业务模块 —— 派生新项目时从这里开始改
		name: "系统设置",
		path: "/settings",
		icon: "settings",
		description:
			"真实业务示例:用户(完整 CRUD + 授权)、标签(树)、菜单(树 + 驱动侧边栏)、字典、参数五个模块。演示「列表 + 表单 + 详情 + 授权 + Excel 导入导出 + 树形排序」的骨架,以及 mock 数据与数据库两种数据来源。",
		children: [
			{ name: "用户管理", path: "/settings/users", icon: "users" },
			{ name: "标签管理", path: "/settings/tags", icon: "tags" },
			{ name: "菜单管理", path: "/settings/menus", icon: "menu" },
			{ name: "字典管理", path: "/settings/dictionary", icon: "library" },
			{ name: "参数管理", path: "/settings/parameters", icon: "sliders-horizontal" },
			{ name: "界面偏好", path: "/settings/appearance", icon: "palette" },
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

// ── 菜单 ↔ 权限:编码派生、按权限过滤 ─────────────────────────────
//
// 两条链路(唯一真源是本文件的 `NAV_NODES`):
//   ① 权限点编码:菜单 = 页面路径(`/a/b` → `a:b`),操作 = `op:<模块码>:<序号>`;
//   ② 可见性:`filterNavByPermission(当前菜单树, 有效权限码集合)` —— 未登录 / 未接权限服务时传
//      `undefined`,表示**不过滤**(默认全可见),所以本文件在权限模块落地前不影响现有渲染。
//
// **权限点目录**(「某个角色能勾哪些项」)不在本文件,在 `mocks/settings.ts` 的
// `PERMISSION_TREE` / `PERMISSION_POINTS` —— 那边把 `NAV_NODES` 转成"带中文目录层级的树",
// 形状是授权界面要的(本文件的 `NavNode` 是渲染要的),两者都从同一棵 `NAV_NODES` 派生,不会漂移。

/** 页面路径 → 菜单权限点编码(`/settings/users` → `settings:users`);`/`(工作台)得空串 */
export function menuPermissionCode(path: string): string {
	return path.replace(/^\//, "").replace(/\//g, ":");
}

/**
 * 一级模块的权限码前缀:有 path 用路径码;`/`(工作台)与纯分组节点回落到 `module-<序号>`。
 * 操作权限点(`op:<模块码>:<序号>`)与「角色管理」页的授权项都按这个前缀命名。
 */
export function modulePermissionCode(module: NavNode, index: number): string {
	return (module.path ? menuPermissionCode(module.path) : "") || `module-${index + 1}`;
}

/**
 * 节点**自身**要求的权限码 —— 过滤菜单时只看这个。
 *
 * 规则(踩过的坑,别改回去):
 *  ① 显式 `permission` 优先(任何节点都能声明,声明了就必然是权限点目录里的一项);
 *  ② 没有显式声明时,**只有叶子节点**按 `path` 派生 —— 「系统设置」这种「一级模块首页 + 子菜单」
 *     的容器**不拿自己的 `/settings` 去拦**:那个码不在权限点目录里,一拦整个模块永远不可见
 *     (实测:给定权限码集合后,一级模块只剩「工作台」能显示)。容器的可见性由子节点决定:
 *     子项全被过滤 → 容器自身也消失。
 *  ③ 叶子 `/`(工作台)得空串 → 不设权限点 → 所有登录用户可见(系统入口页)。
 *
 * 导出它是因为它是**权限模型的公开契约**:接 RBAC 时,服务端与授权页都要用同一套派生规则。
 */
export function navRequiredPermission(node: NavNode): string | undefined {
	if (node.permission) return node.permission;
	if (node.children?.length) return undefined;
	// 「参数化菜单」(path = <前缀>/<记录 id>,见 lib/menu-detail-path.ts)不派生权限点:
	// 路径里带的是记录 id,派生出来会是 `data:raw:SRC-260920-153045` 这种授权页无法表达的码。
	// 这类菜单的可见性跟随"它指向的那条记录能不能看",由业务侧统一处理。
	if (node.path?.startsWith(MENU_DETAIL_PATH_PREFIX)) return undefined;
	const code = node.path ? menuPermissionCode(node.path) : "";
	return code || undefined;
}

/** 各一级模块下固定的操作权限 —— 与「角色管理」页的授权项逐项一致 */
export const MODULE_OPERATIONS = ["查看", "新增", "编辑", "删除", "导入", "导出", "授权"] as const;

/**
 * 按用户的有效权限码过滤菜单树。
 *
 * - `granted` 为 `undefined` / `null` → **不过滤**(未登录、权限服务未接通时的默认态);
 * - 节点要求的权限码未授予 → 整枝隐藏(要求的码见 `navRequiredPermission`);
 * - 容器的子项全被过滤 → 容器自身也不显示;
 * - 过滤是**纯函数 + 返回新对象**,不改 `NAV_NODES`(SSR 与客户端拿到同一份输入 → 同一份输出)。
 */
export function filterNavByPermission(nodes: readonly NavNode[], granted?: ReadonlySet<string> | null): NavNode[] {
	if (!granted) return [...nodes];
	const out: NavNode[] = [];
	for (const node of nodes) {
		const code = navRequiredPermission(node);
		if (code && !granted.has(code)) continue;
		if (node.children?.length) {
			const children = filterNavByPermission(node.children, granted);
			if (children.length === 0) continue;
			out.push({ ...node, children });
		} else {
			out.push(node);
		}
	}
	return out;
}

/** 命中的菜单链(面包屑用),按权限过滤:被隐藏的节点不进面包屑。 */
export function findVisibleNavTrailIn(
	nodes: readonly NavNode[],
	pathname: string,
	granted?: ReadonlySet<string> | null,
): NavNode[] {
	const trail = findNavTrailIn(nodes, pathname);
	if (!granted) return trail;
	return trail.filter((node) => {
		const code = navRequiredPermission(node);
		return !code || granted.has(code);
	});
}

export function findVisibleNavTrail(pathname: string, granted?: ReadonlySet<string> | null): NavNode[] {
	return findVisibleNavTrailIn(NAV_NODES, pathname, granted);
}
