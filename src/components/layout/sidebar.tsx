import { Link, useLocation } from "@tanstack/react-router";
import { ChevronRight, Layers, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useSidebarCollapseMode } from "#/lib/ui-prefs";
import { cn } from "#/lib/utils";
import { collectNavGroupIds, NAV_ICON_MAP, type NavNode, navNodeContains } from "./nav-config";
import { useVisibleNavNodes, useVisibleNavTrail } from "./nav-permissions";

/* ═══════════════════════════════════════════════════════════════════════════
   侧边栏 —— 单强调色 + 连线层级(规格见 DESIGN.md §5.1)

   三条设计决定(都踩过坑,别随手改回去):

   ① **导航只用品牌色一种强调色,不用点缀色谱。**
      曾经给每个一级模块配过一个色相(侧边栏图标块 → 面包屑 → 页头同色)——
      在真实菜单密度下它变成了"彩虹",反而比单色更难看清"我在哪"。
      点缀色谱现在只服务**数据展示**(指标卡 / 分类标签 / 筛选 chip),那里多色才有意义。

   ② **层级靠"连线"表达,不靠色块。**
      父 → 子是肘形接头(└)+ 贯穿竖线。**这一枝含当前页时连线转强调色** ——
      于是"我在哪个分组"由线的颜色说,不需要父级也铺一层底色
      (铺了之后同时展开三个分组会有三行看着都像选中)。

   ③ **只有一级菜单有图标。**
      二级及以下纯文字 —— 图标一多,层级反而看不出来。
   ═══════════════════════════════════════════════════════════════════════════ */

/** 行高 = py-1.5(6+6) + 文本行高 20px = 32px ⇒ 半行 16px,连线端点的计算都基于它 */
const ROW_HALF = "16px";

export function Sidebar({ collapsed, onExpand }: { collapsed: boolean; onExpand?: () => void }) {
	const { pathname } = useLocation();
	const mode = useSidebarCollapseMode();
	const rail = collapsed && mode === "rail";

	// 菜单树按权限过滤:未接权限服务时 = 全量 NAV_NODES(见 nav-permissions.tsx)
	const nodes = useVisibleNavNodes();

	// 当前路径命中的分组链(同样按权限过滤)—— 决定初始展开哪些分支
	const trail = useVisibleNavTrail(pathname);
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

	return (
		<aside
			className={cn(
				// overflow-hidden 是**必须**的:宽度动画期间内容得先被裁住,否则折叠的一瞬会横向溢出。
				// (迷你栏的名字因此用原生 title 而不是自绘浮层 —— 自绘气泡会被这里裁掉,
				//  而 CSS 做不到"纵向 auto + 横向可见":一个轴为 auto,另一个轴必然也是 auto。)
				"relative flex shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground",
				"sticky top-0 h-screen transition-[width] duration-200 ease-brand",
				// 完全隐藏模式下宽度归零,连右边框一起收掉(否则屏幕上会留一条 1px 竖线)
				collapsed ? (mode === "rail" ? "w-[60px]" : "w-0 border-r-0") : "w-60",
			)}
		>
			{/* 顶部一层极淡色温:让品牌区不是"死白",同时不形成可见的装饰渐变 */}
			<div aria-hidden className="ambient-veil pointer-events-none absolute inset-x-0 top-0 h-44 opacity-70" />

			{/* ── Brand ──────────────────────────────────────────────── */}
			<div
				className={cn(
					"relative flex h-14 shrink-0 items-center gap-2.5 border-b border-border",
					rail ? "justify-center px-0" : "px-3.5",
				)}
			>
				<Link
					to="/"
					aria-label="回到工作台"
					className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground shadow-(--shadow-glow) transition-[filter] duration-200 hover:brightness-110"
				>
					A
				</Link>
				{!rail && (
					<>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">管理后台</div>
							<div className="mt-0.5 flex items-center gap-1.5">
								<span className="pulse-dot relative inline-flex size-1.5 shrink-0 rounded-full bg-success" />
								<span className="truncate text-[10.5px] text-muted-foreground">v3.2 · 已连接</span>
							</div>
						</div>
						<button
							type="button"
							aria-label="新建"
							className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-[color:var(--af-blue-soft)] hover:text-primary"
						>
							<Plus className="size-4" />
						</button>
					</>
				)}
			</div>

			{/* ── Quick search(仅展开态)──────────────────────────────── */}
			{!rail && (
				<div className="relative px-2 pt-2.5">
					<button
						type="button"
						className="group flex w-full items-center gap-2 rounded-xl border border-border bg-[color:var(--af-surface)] px-2.5 py-1.5 text-left text-[12.5px] text-muted-foreground transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-[color:var(--af-blue-line)] hover:bg-background hover:text-foreground focus-visible:border-primary focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-[color:var(--af-blue-ring)] focus-visible:outline-none"
					>
						<Search className="size-3.5 shrink-0 transition-colors duration-150 group-hover:text-primary" />
						<span className="flex-1 truncate">搜索菜单 / 页面 / 主体</span>
						<kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] tracking-tight text-muted-foreground">
							⌘ K
						</kbd>
					</button>
				</div>
			)}

			{/* ── Nav ────────────────────────────────────────────────── */}
			<nav
				className={cn(
					"relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden",
					rail ? "items-center gap-0.5 p-2" : "stagger gap-px p-2 pt-3",
				)}
			>
				{rail
					? nodes.map((node) => <RailItem key={node.name} node={node} pathname={pathname} />)
					: nodes.map((node) => (
							<NavItem
								key={node.name}
								node={node}
								pathname={pathname}
								depth={0}
								collapsedIds={collapsedIds}
								onToggle={toggleCollapsedId}
							/>
						))}
			</nav>

			{/* ── Footer ─────────────────────────────────────────────── */}
			<div className="relative border-t border-border p-2">
				{rail ? (
					<div className="flex flex-col items-center gap-2">
						{/* 迷你栏的"回去"入口 —— 一枚圆形箭头 */}
						{onExpand ? (
							<button
								type="button"
								onClick={onExpand}
								aria-label="展开侧边栏"
								className="flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-(--af-raise-2) transition-colors duration-150 hover:border-primary hover:text-primary"
							>
								<ChevronRight className="size-3.5" />
							</button>
						) : null}
						<div title="管理员 · 超级管理员">
							<div className="flex size-7 items-center justify-center rounded-full bg-secondary text-[12px] font-medium text-foreground ring-1 ring-border">
								管
							</div>
						</div>
					</div>
				) : (
					<div className="group flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-[color:var(--af-hover)]">
						<div className="relative shrink-0">
							<div className="flex size-7 items-center justify-center rounded-full bg-secondary text-[12px] font-medium text-foreground ring-1 ring-border transition-shadow duration-200 group-hover:ring-[color:var(--af-blue-line)]">
								管
							</div>
							<span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-[color:var(--sidebar)] bg-success" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="truncate text-[12.5px] font-medium">管理员</div>
							<div className="truncate text-[10.5px] text-muted-foreground">超级管理员</div>
						</div>
						<ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-[transform,color] duration-200 ease-brand group-hover:translate-x-0.5 group-hover:text-foreground" />
					</div>
				)}
			</div>
		</aside>
	);

	/** 切换一个分组的折叠态。useState setter 是稳定的,直接传 ref 让 NavItem 不必再 memo。 */
	function toggleCollapsedId(id: string) {
		setCollapsedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}
}

function NavItem({
	node,
	pathname,
	depth,
	collapsedIds,
	onToggle,
}: {
	node: NavNode;
	pathname: string;
	depth: number;
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
				<span className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
					{node.name}
				</span>
				<span className="h-px flex-1 bg-gradient-to-r from-[color:var(--border)] to-transparent" />
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
						"group/nav relative flex w-full items-center gap-2.5 rounded-full px-2.5 py-1.5 text-left text-[13px] font-medium",
						selfSelected
							? "bg-[color:var(--af-blue-soft)] text-primary"
							: "text-foreground hover:bg-[color:var(--af-hover)] hover:text-foreground",
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

				<NavPanel
					node={node}
					pathname={pathname}
					depth={depth}
					open={open}
					collapsedIds={collapsedIds}
					onToggle={onToggle}
				/>
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
				"group/nav relative flex items-center gap-2.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium",
				"transition-[color,background-color] duration-150 ease-brand",
				active
					? "bg-[color:var(--af-blue-soft)] text-primary"
					: "text-foreground hover:bg-[color:var(--af-hover)] hover:text-foreground",
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
 * 展开面板 —— 父 → 子的连线就在这一层。
 *
 * 两种线:
 *  - **贯穿竖线**:贴在每一项的左侧;非末项贯穿整行,末项只到行中线(线在最后一个子项处收住);
 *  - **肘形接头**:只有首项画 —— 一条 `border-b + border-l + rounded-bl` 的折角,
 *    把父级的落点接到第一个子项上。
 *
 * **每条线的归属**是踩过的坑(实测:"选中第 3 项,亮线却落在第 1 项"),关键是搞清楚
 * "线在视觉上连的是哪两个节点":
 *  - **肘形接头**只画在 index=0,它在"父级落点"和"第一个子项"之间 —— 它表达的是**整枝**,
 *    所以只要这枝里有任何 active(branchActive),它就亮;
 *  - **贯穿竖线**画在每一项左侧:对中间行,这条线从"本行顶"贯穿到"本行底",
 *    它在视觉上是**承接"上方兄弟"的末尾 → 本行 → 下方兄弟的开头**;
 *    所以它应当表达"本枝里这一段链路是否被选中",即:**本行 active 或 下一行 active** 时点亮。
 *    末项的竖线只到本行中线(往下的端点是空的),所以它的判定只有"本行 active"。
 *
 * 这样选第 3 项时,第 2 行那条贯穿竖线亮、第 3 行那条贯穿竖线也亮(因为它在视觉上是
 * "从第 3 行的顶连到第 3 行的底,服务于当前选中"),而第 1 行的贯穿竖线灭。
 */
function NavPanel({
	node,
	pathname,
	depth,
	open,
	collapsedIds,
	onToggle,
}: {
	node: NavNode;
	pathname: string;
	depth: number;
	open: boolean;
	collapsedIds: ReadonlySet<string>;
	onToggle: (id: string) => void;
}) {
	const children = node.children ?? [];

	return (
		// 收起时 inert —— 内容仍在 DOM 里,不然键盘 Tab 会钻进看不见的链接
		<div inert={!open} className={cn("collapse-grid", open && "is-open")}>
			<div>
				{/* 一级 / 二级菜单都按"图标中心"对连线(行 pl-2.5 + 图标 16px ⇒ 中心 18px) */}
				<div className="relative ml-[18px] flex flex-col">
					{children.map((child, index) => {
						const isLast = index === children.length - 1;
						/** 这一行对应的子菜单是否被选中 —— 连线的唯一判据。
						 *  关键:每条连线只对自己的子项负责(点到哪个菜单,哪个菜单的线才亮),
						 *  不再看"整枝是否含当前页"。旧版用 `branchActive` 让父→子的肘形接头
						 *  在"选中任意子项"时都亮,结果表现为"线永远指着第一个子菜单(用户管理)"。 */
						const childActive = !!child.path && (pathname === child.path || pathname.startsWith(`${child.path}/`));
						const lineLit = childActive;
						const lineClass = lineLit ? "bg-[color:var(--af-blue-line)]" : "bg-[color:var(--border)]";
						/** 肘形接头只画在第一行,它接的是"父级落点 ↔ 第一个子项";
						 *  所以它只在**第一个子项自己被选中**时才亮,跟其它子项无关。 */
						const elbowLit = index === 0 && childActive;
						const elbowClass = elbowLit ? "border-[color:var(--af-blue-line)]" : "border-[color:var(--border)]";
						return (
							<div key={child.name} className="relative">
								<span
									aria-hidden
									className={cn("absolute top-0 left-0 w-px rounded-full transition-colors duration-150", lineClass)}
									style={isLast ? { height: ROW_HALF } : { bottom: 0 }}
								/>
								{index === 0 ? (
									<span
										aria-hidden
										className={cn(
											"absolute top-0 left-0 rounded-bl-[8px] border-b border-l transition-colors duration-150",
											elbowClass,
										)}
										style={{ height: ROW_HALF, width: 14 }}
									/>
								) : null}
								{/* 直接用 padding-left 推内容到连线右侧,不再嵌一层 pl-7 容器 ——
								    旧实现把内容塞进独立 div,导致 ring 边框无法贴到行外,
								    在行的顶/右侧出现"断裂"。现在行 = 链接本身,边框走 link 的 box。 */}
								<div className="pl-5">
									<NavItem
										node={child}
										pathname={pathname}
										depth={depth + 1}
										collapsedIds={collapsedIds}
										onToggle={onToggle}
									/>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

/* ── 折叠态:60px 迷你图标栏 ─────────────────────────────────────────────
   不再是"整条消失",而是一条图标轨 —— 仍能看到全部分区并直接跳转。
   含当前页的分组会把子项以"小图标竖列"展开在下方,所以折叠态也能一步跳到同级页面。 */

function RailItem({ node, pathname }: { node: NavNode; pathname: string }) {
	const Icon = NAV_ICON_MAP[node.icon] ?? Layers;
	const own = !!node.path && (pathname === node.path || pathname.startsWith(`${node.path}/`));
	const branchActive = navNodeContains(node, pathname);
	const active = own || branchActive;
	const kids = (node.children ?? []).filter((child): child is NavNode & { path: string } => Boolean(child.path));

	return (
		<div className="flex w-full flex-col items-center">
			{/*
			 * 名字用**原生 title**:自绘浮层会被侧边栏的 overflow-hidden 裁掉,
			 * 而 CSS 无法同时"纵向 auto + 横向可见"(一个轴为 auto,另一个轴必然也是 auto)。
			 */}
			<Link
				to={node.path ?? kids[0]?.path ?? "#"}
				title={node.name}
				aria-label={node.name}
				aria-current={own ? "page" : undefined}
				className={cn(
					"flex size-9 shrink-0 items-center justify-center rounded-xl transition-[color,background-color,box-shadow] duration-150 ease-brand",
					active
						? "bg-primary text-primary-foreground shadow-(--shadow-glow)"
						: "text-muted-foreground hover:bg-[color:var(--af-hover)] hover:text-foreground",
				)}
			>
				<Icon className="size-4" />
			</Link>

			{/* 含当前页的分组:子项竖列 + 一条贯穿细线,层级在折叠态也读得出来 */}
			{branchActive && kids.length > 0 ? (
				<div className="relative mt-0.5 flex flex-col items-center gap-0.5 pb-1">
					<span
						aria-hidden
						className="absolute top-0 bottom-3.5 left-1/2 w-px -translate-x-1/2 bg-[color:var(--af-blue-line)]"
					/>
					{kids.map((child) => {
						const ChildIcon = NAV_ICON_MAP[child.icon] ?? Layers;
						const on = pathname === child.path || pathname.startsWith(`${child.path}/`);
						return (
							<Link
								key={child.name}
								to={child.path}
								title={child.name}
								aria-label={child.name}
								aria-current={on ? "page" : undefined}
								className={cn(
									"relative z-10 flex size-7 items-center justify-center rounded-lg transition-[color,background-color] duration-150",
									on
										? "bg-[color:var(--af-blue-soft)] text-primary ring-1 ring-[color:var(--af-blue-line)]"
										: "text-muted-foreground hover:bg-background hover:text-foreground",
								)}
							>
								<ChildIcon className="size-3.5" />
							</Link>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
