import { Link, useLocation } from "@tanstack/react-router";
import { ChevronRight, Layers } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useParaRaw } from "#/hooks/use-para-prefs";
import { parseSidebarCollapseMode, SIDEBAR_MODE_CONFIG_KEY, type SidebarCollapseMode } from "#/lib/sidebar-mode";
import { cn } from "#/lib/utils";
import { collectNavGroupIds, NAV_ICON_MAP, type NavNode, navNodeContains } from "./nav-config";
import { useNavNodes, useNavTrail } from "./nav-data";
import { SidebarHeader } from "./sidebar-header";

/* ═══════════════════════════════════════════════════════════════════════════
   侧边栏 —— 只做导航(规格见 DESIGN.md §5.1)

   三条设计决定:

   ① **只用品牌色一种强调色,不用点缀色谱。**
      曾经给每个一级模块配过一个色相,真实菜单密度下它变成了"彩虹",
      反而比单色更难看清"我在哪"。点缀色谱现在只服务**数据展示**(指标卡 / 分类标签)。

   ② **层级靠缩进,不靠引导线。**
      早先这里画肘形接头 + 贯穿竖线,还要给每条线算"该不该亮" —— 一整套几何与归属判定,
      换来的是一根 1px 的线,还实测出过"选中第 3 项、亮线落在第 1 项"。
      现在父 → 子就是一层缩进,"我在哪个分组"由选中态本身的颜色说。

   ③ **分组展开用 `grid-template-rows: 0fr → 1fr`** —— 全项目唯一允许的布局动画;
      收起时必须给面板加 `inert`,不然键盘 Tab 会钻进看不见的链接。

   收起后的样子(60px 迷你图标栏 / 整条隐藏)是**系统参数**,
   键为 `ui.sidebar.collapsed_mode`,读取见 `lib/sidebar-mode.ts`,设置入口在「系统设置 ▸ 参数管理」。

   ④ **顶部的品牌标题区不在这里** —— 它是独立组件 `layout/sidebar-header.tsx`
      (icon + 标题 + 副标题)。标题区讲"这是哪个系统",菜单讲"有哪些页面、我在哪",
      两件事各自演进,互不 import。
   ═══════════════════════════════════════════════════════════════════════════ */

export function Sidebar({ collapsed, onExpand }: { collapsed: boolean; onExpand?: () => void }) {
	const { pathname } = useLocation();
	const mode = useSidebarCollapseMode();
	/** "收起了 且 收起形态是迷你栏"才渲染图标栏;hidden 模式下收起就是整条宽度归零 */
	const rail = collapsed && mode === "rail";

	const nodes = useNavNodes();

	// 当前路径命中的分组链 —— 决定初始展开哪些分支
	const trail = useNavTrail(pathname);
	const trailIds = useMemo(() => trail.map((n) => n.path ?? n.name), [trail]);

	// 默认折叠:只展开当前路径所在分支。
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
		() => new Set(collectNavGroupIds(nodes).filter((id) => !trailIds.includes(id))),
	);

	// 客户端跳转后自动展开新分支;不强制收起用户手动展开过的分组
	useEffect(() => {
		if (trailIds.length === 0) return;
		setCollapsedIds((prev) => {
			if (trailIds.every((id) => !prev.has(id))) return prev;
			const next = new Set(prev);
			for (const id of trailIds) next.delete(id);
			return next;
		});
	}, [trailIds]);

	/** 切换一个分组的折叠态。useState setter 是稳定的,直接传引用让 NavItem 不必再 memo。 */
	function toggleCollapsedId(id: string) {
		setCollapsedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	return (
		<aside
			className={cn(
				// overflow-hidden 是**必须**的:宽度动画期间内容得先被裁住,否则折叠的一瞬会横向溢出。
				"relative flex shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground",
				"sticky top-0 h-screen transition-[width] duration-200 ease-brand",
				// 完全隐藏模式下宽度归零,连右边框一起收掉(否则屏幕上会留一条 1px 竖线)
				collapsed ? (mode === "rail" ? "w-[60px]" : "w-0 border-r-0") : "w-60",
			)}
		>
			{/* 品牌标题区:独立组件(见文件头 ④)。收起成迷你栏时只留品牌图标 */}
			<SidebarHeader compact={rail} title="管理后台" subtitle="TanStack Start 模板" />

			<nav
				className={cn(
					"relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden",
					rail ? "items-center gap-1 p-2" : "stagger gap-px p-3",
				)}
			>
				{rail
					? nodes.map((node) => <RailItem key={node.name} node={node} pathname={pathname} />)
					: nodes.map((node) => (
							<NavItem
								key={node.name}
								node={node}
								pathname={pathname}
								collapsedIds={collapsedIds}
								onToggle={toggleCollapsedId}
							/>
						))}
			</nav>

			{/* 迷你栏的"回去"入口。完全隐藏态整条宽度为 0,叫回来的入口在顶栏 */}
			{rail && onExpand ? (
				<div className="border-t border-border p-2">
					<button
						type="button"
						onClick={onExpand}
						aria-label="展开侧边栏"
						className="mx-auto flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-raise-2 transition-colors duration-150 hover:border-primary hover:text-primary"
					>
						<ChevronRight className="size-3.5" />
					</button>
				</div>
			) : null}
		</aside>
	);
}

/**
 * 收起后的样子 —— 读系统参数 `ui.sidebar.collapsed_mode`(取值域见 `lib/sidebar-mode.ts`)。
 *
 * 这里**没有**任何自定义 store / subscribe / getSnapshot:值的订阅与缓存是 React Query
 * 本来就在做的事(`para.byKey`,读法统一走 `hooks/use-para-prefs.ts` 的 `useParaRaw`)。
 * 首屏的值由 `(main)/route.tsx` 的 loader 预取,
 * 所以 SSR 直出的宽度就是最终宽度;读不到 / 值非法 → 回落默认值,不会崩。
 */
function useSidebarCollapseMode(): SidebarCollapseMode {
	return parseSidebarCollapseMode(useParaRaw(SIDEBAR_MODE_CONFIG_KEY));
}

function NavItem({
	node,
	pathname,
	collapsedIds,
	onToggle,
}: {
	node: NavNode;
	pathname: string;
	collapsedIds: ReadonlySet<string>;
	onToggle: (id: string) => void;
}) {
	const Icon = NAV_ICON_MAP[node.icon] ?? Layers;
	const hasChildren = !!node.children?.length;
	// 折叠态的稳定 key:有 path 用 path,纯分组(没 path)用 name —— 同一棵树内都唯一
	const nodeId = node.path ?? node.name;

	// 纯文字分组(无 path 无 children):用一段小标题作区段头,inline 就够
	if (!node.path && !hasChildren) {
		return (
			<div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
				<span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{node.name}</span>
				<span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
			</div>
		);
	}

	if (hasChildren) {
		// 父级按钮"自身被选中"= 路径精确命中(子页 /settings/users 不算);用户明确要求默认全黑,
		// 蓝色只属于"被点中的那一项",所以父级这里必须用 `===` 而不是 prefix 匹配。
		const selfSelected = pathname === node.path;
		const open = !collapsedIds.has(nodeId);

		return (
			<div>
				<button
					type="button"
					onClick={() => onToggle(nodeId)}
					aria-expanded={open}
					className={cn(
						"group/nav relative flex w-full items-center gap-2.5 rounded-full px-2.5 py-1.5 text-left text-sm font-medium",
						selfSelected ? "bg-brand-soft text-primary" : "text-foreground hover:bg-hover hover:text-foreground",
						"transition-[color,background-color] duration-150 ease-brand",
					)}
				>
					<Icon
						className={cn(
							"size-4 shrink-0 transition-colors duration-150",
							selfSelected ? "text-primary" : "text-foreground",
						)}
					/>
					<span
						className={cn(
							"flex-1 truncate transition-colors duration-150",
							selfSelected ? "text-primary" : "text-foreground",
						)}
					>
						{node.name}
					</span>
					{/* chevron 只做**旋转**,不换图标 —— 换图标是硬切,旋转才是连续的 */}
					<ChevronRight
						aria-hidden
						className={cn(
							"size-3.5 shrink-0 transition-transform duration-200 ease-brand",
							selfSelected ? "text-primary" : "text-foreground",
							open && "rotate-90",
						)}
					/>
				</button>

				<NavPanel node={node} pathname={pathname} open={open} collapsedIds={collapsedIds} onToggle={onToggle} />
			</div>
		);
	}

	const active = !!node.path && (pathname === node.path || pathname.startsWith(`${node.path}/`));
	return (
		<Link
			to={node.path ?? "#"}
			aria-current={active ? "page" : undefined}
			className={cn(
				// 选中态 = 浅底 + 强调色文字图标(无边框,只用底色区分);
				// 未选中 = 深色文字,hover 只换底色 —— hover **不**变蓝,蓝色只属于"被选中"。
				"group/nav relative flex items-center gap-2.5 rounded-full px-2.5 py-1.5 text-sm font-medium",
				"transition-[color,background-color] duration-150 ease-brand",
				active ? "bg-brand-soft text-primary" : "text-foreground hover:bg-hover hover:text-foreground",
			)}
		>
			<Icon
				className={cn(
					"size-4 shrink-0 transition-colors duration-150",
					active ? "text-primary" : "text-foreground group-hover/nav:text-foreground",
				)}
			/>
			<span className="flex-1 truncate">{node.name}</span>
		</Link>
	);
}

/**
 * 展开面板 —— 层级只靠**缩进**(一层 `pl-3`),不画引导线。
 *
 * 收起时必须给面板加 `inert`:内容仍在 DOM 里,不然键盘 Tab 会钻进看不见的链接。
 */
function NavPanel({
	node,
	pathname,
	open,
	collapsedIds,
	onToggle,
}: {
	node: NavNode;
	pathname: string;
	open: boolean;
	collapsedIds: ReadonlySet<string>;
	onToggle: (id: string) => void;
}) {
	const children = node.children ?? [];

	return (
		<div inert={!open} className={cn("collapse-grid", open && "is-open")}>
			<div>
				<div className="ml-2 flex flex-col gap-px pl-3">
					{children.map((child) => (
						<NavItem
							key={child.name}
							node={child}
							pathname={pathname}
							collapsedIds={collapsedIds}
							onToggle={onToggle}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

/* ── 折叠态:60px 迷你图标栏 ──────────────────────────────────────────────
   只列一级菜单:仍能看到全部分区并一步跳过去;含当前页的那一项高亮。
   名字用**原生 title**:自绘浮层会被侧边栏的 overflow-hidden 裁掉,而 CSS 无法同时
   "纵向 auto + 横向可见"(一个轴为 auto,另一个轴必然也是 auto)。 */

function RailItem({ node, pathname }: { node: NavNode; pathname: string }) {
	const Icon = NAV_ICON_MAP[node.icon] ?? Layers;
	const own = !!node.path && (pathname === node.path || pathname.startsWith(`${node.path}/`));
	/** 含当前页的分组也要高亮 —— 否则停在子页(/settings/users)时整条栏没有一个亮点 */
	const active = own || navNodeContains(node, pathname);
	// 分组自身没有 path:点它就去第一个有 path 的子项(纯分组菜单才有这一档)
	const target = node.path ?? node.children?.find((child) => child.path)?.path ?? "#";

	return (
		<Link
			to={target}
			title={node.name}
			aria-label={node.name}
			aria-current={own ? "page" : undefined}
			className={cn(
				"flex size-9 shrink-0 items-center justify-center rounded-xl transition-[color,background-color,box-shadow] duration-150 ease-brand",
				// 选中态与展开态**共用同一套底色**:浅蓝底 + 主色图标。
				// 这里曾经是实心主色块(`bg-primary` + 反白 + glow)—— 一收起,整条栏的主色面积
				// 就和展开态判若两物(展开态只有淡淡一层浅蓝)。用户要的正是"统一成不折叠的背景色"。
				active ? "bg-brand-soft text-primary" : "text-muted-foreground hover:bg-hover hover:text-foreground",
			)}
		>
			<Icon className="size-4" />
		</Link>
	);
}
