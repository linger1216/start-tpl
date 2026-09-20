import { Link, useLocation } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Layers, Plus, Search } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { cn } from "#/lib/utils";
import { collectNavGroupIds, NAV_ICON_MAP, type NavNode, navGroupId, navNodeContains } from "./nav-config";
import { useVisibleNavNodes, useVisibleNavTrail } from "./nav-permissions";

/** Sidebar 分组折叠 Context(嵌套层级共享) */
interface SidebarCollapseContext {
	collapsed: Set<string>;
	toggle: (id: string) => void;
}
const SidebarCollapseCtx = createContext<SidebarCollapseContext | null>(null);

function useCollapse(): SidebarCollapseContext {
	const ctx = useContext(SidebarCollapseCtx);
	if (!ctx) {
		// 兜底:未在 Provider 下时返回静态空集 + noop(避免崩溃)
		return { collapsed: new Set(), toggle: () => {} };
	}
	return ctx;
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
	const { pathname } = useLocation();
	// 菜单树按权限过滤:未接权限服务时 = 全量 NAV_NODES(见 nav-permissions.tsx)
	const nodes = useVisibleNavNodes();

	// 当前路径命中的分组链(同样按权限过滤)—— 决定初始展开哪些分支
	const trail = useVisibleNavTrail(pathname);
	const trailIds = useMemo(() => trail.map(navGroupId), [trail]);
	const trailKey = trailIds.join("|");

	// 默认折叠:只展开当前路径所在分支。
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
		() => new Set(collectNavGroupIds(nodes).filter((id) => !trailIds.includes(id))),
	);

	// 客户端跳转后自动展开新分支;不强制收起用户手动展开过的分组
	useEffect(() => {
		const ids = trailKey ? trailKey.split("|") : [];
		if (ids.length === 0) return;
		setCollapsedIds((prev) => {
			if (ids.every((id) => !prev.has(id))) return prev;
			const next = new Set(prev);
			for (const id of ids) next.delete(id);
			return next;
		});
	}, [trailKey]);

	const collapseCtx = useMemo<SidebarCollapseContext>(
		() => ({
			collapsed: collapsedIds,
			toggle: (id: string) =>
				setCollapsedIds((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				}),
		}),
		[collapsedIds],
	);

	return (
		<aside
			className={cn(
				"flex shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground",
				"sticky top-0 h-screen transition-[width] duration-200",
				collapsed ? "w-0 overflow-hidden" : "w-60",
			)}
		>
			{/* ── Brand ──────────────────────────────────────────────── */}
			<div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
				<div
					style={{ background: "var(--af-blue)", boxShadow: "var(--shadow-glow)" }}
					className="flex size-7 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold text-white"
				>
					A
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">管理后台</div>
					<div className="flex items-center gap-1 truncate text-[10.5px] text-muted-foreground">
						<span style={{ background: "var(--af-green)" }} className="size-1.5 rounded-full" />
						<span>v3.2 · 已连接</span>
					</div>
				</div>
				<button
					type="button"
					aria-label="新建"
					style={{ color: "var(--muted-foreground)" }}
					className="flex size-7 items-center justify-center rounded-lg transition-colors hover:bg-[color-mix(in_oklch,var(--af-blue)_10%,transparent)] hover:text-[color:var(--af-blue)]"
				>
					<Plus className="size-4" />
				</button>
			</div>

			{/* ── Quick search ───────────────────────────────────────── */}
			<div className="px-2 pt-2">
				<button
					type="button"
					className="group flex w-full items-center gap-2 rounded-xl border border-border bg-[color:var(--af-surface)] px-2.5 py-1.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-[color:var(--af-border-strong)] hover:bg-background"
				>
					<Search className="size-3.5" />
					<span className="flex-1 truncate">搜索菜单 / 页面 / 主体</span>
					<kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] tracking-tight text-muted-foreground">
						⌘ K
					</kbd>
				</button>
			</div>

			{/* ── Nav ────────────────────────────────────────────────── */}
			<nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 pt-3">
				<SidebarCollapseCtx.Provider value={collapseCtx}>
					{nodes.map((node) => (
						<NavItem key={node.name} node={node} pathname={pathname} depth={0} />
					))}
				</SidebarCollapseCtx.Provider>
			</nav>

			{/* ── Footer user card ───────────────────────────────────── */}
			<div className="border-t border-border p-2">
				<div className="group flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-[color:var(--af-hover)]">
					<div className="relative shrink-0">
						<div
							style={{ background: "var(--af-surface)" }}
							className="flex size-7 items-center justify-center rounded-full text-[12px] font-medium text-foreground"
						>
							管
						</div>
						<span
							style={{
								background: "var(--af-green)",
								borderColor: "var(--sidebar, #ffffff)",
							}}
							className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2"
						/>
					</div>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[12.5px] font-medium">管理员</div>
						<div className="truncate text-[10.5px] text-muted-foreground">超级管理员</div>
					</div>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
						role="img"
						aria-label="展开菜单"
					>
						<title>展开菜单</title>
						<path d="m6 9 6 6 6-6" />
					</svg>
				</div>
			</div>
		</aside>
	);
}

function NavItem({ node, pathname, depth }: { node: NavNode; pathname: string; depth: number }) {
	const Icon = NAV_ICON_MAP[node.icon] ?? Layers;
	const hasChildren = !!node.children?.length;
	const { collapsed, toggle } = useCollapse();
	const nodeCollapsed = collapsed.has(navGroupId(node));
	const groupActive = !!node.path && navNodeContains(node, pathname);

	// 分组标题(无 path、无子级,对应 menu 表 path='-')：不可点击的区段头
	if (!node.path && !hasChildren) {
		return (
			<div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
				<span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
					{node.name}
				</span>
				<span style={{ background: "var(--border)" }} className="h-px flex-1 opacity-60" />
			</div>
		);
	}

	if (hasChildren) {
		// 含子菜单的一级菜单:整行就是「展开 / 收起」开关,点击不做任何导航。
		const isCollapsed = nodeCollapsed;
		const panelId = `nav-panel-${navGroupId(node)}`;
		const chevron = (
			<span
				aria-hidden
				className={cn(
					"flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150",
					!isCollapsed && "bg-[color:var(--af-surface)] text-foreground",
				)}
			>
				{isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
			</span>
		);

		return (
			<div>
				<button
					type="button"
					onClick={() => toggle(navGroupId(node))}
					aria-expanded={!isCollapsed}
					aria-controls={panelId}
					style={groupActive ? { background: "var(--af-blue-soft)", color: "var(--af-blue)" } : undefined}
					className={cn(
						"group relative flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors duration-150",
						groupActive ? "" : "hover:bg-[color:var(--af-hover)]",
					)}
				>
					<Icon
						className={cn(
							"size-4 shrink-0 transition-colors",
							groupActive ? "text-[color:var(--af-blue)]" : "text-muted-foreground group-hover:text-foreground",
						)}
					/>
					<span className="flex-1 truncate font-medium text-foreground">{node.name}</span>
					{chevron}
				</button>
				{!isCollapsed && (
					<div
						id={panelId}
						style={{ borderColor: "var(--border)" }}
						className="ml-3 flex flex-col gap-0.5 border-l py-1 pl-2.5"
					>
						{node.children?.map((c) => (
							<NavItem key={c.name} node={c} pathname={pathname} depth={depth + 1} />
						))}
					</div>
				)}
			</div>
		);
	}

	// 激活态只用「内容内高亮」(蓝底 + 蓝字 + 蓝图标),不额外插入任何图标 ——
	// 曾经在激活时插入一个右侧 chevron,插入即改变 flex 布局,勾选/跳转时菜单会抖一下。
	const active = !!node.path && (pathname === node.path || pathname.startsWith(`${node.path}/`));
	return (
		<Link
			to={node.path ?? "#"}
			className={cn(
				"group relative flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
				active ? "" : "hover:bg-[color:var(--af-hover)]",
			)}
			style={{
				paddingLeft: `${10 + depth * 8}px`,
				...(active ? { background: "var(--af-blue-soft)", color: "var(--af-blue)" } : {}),
			}}
		>
			<Icon
				className={cn(
					"size-4 shrink-0 transition-colors",
					active ? "text-[color:var(--af-blue)]" : "text-muted-foreground group-hover:text-foreground",
				)}
			/>
			<span className="flex-1 truncate font-medium text-foreground">{node.name}</span>
		</Link>
	);
}
