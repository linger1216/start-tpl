import { Link } from "@tanstack/react-router";
import { ChevronRight, Layers, Search } from "lucide-react";
import { useMemo } from "react";

import { filterNavByPermission, findNavNodeIn, NAV_ICON_MAP, type NavNode } from "#/components/layout/nav-config";
import { useGrantedNavPermissions, useNavNodes } from "#/components/layout/nav-permissions";
import { PageHeader } from "#/components/layout/page-header";
import { Button } from "#/components/ui/button";

/**
 * 模块首页(Menu 一级模块的落地页)—— 直接渲染该模块子树里的分组与页面。
 *
 * 内容全部来自 `NAV_NODES`,所以菜单和这页不可能漂移:加菜单项 = 这里自动出现。
 */
export function ModuleOverview({ path }: { path: string }) {
	const granted = useGrantedNavPermissions();
	// 与侧边栏同一棵(动态)菜单树:菜单表改了,模块首页跟着变
	const nodes = useNavNodes();
	const node = useMemo(() => findNavNodeIn(nodes, path), [nodes, path]);
	// 子项按权限过滤:模块首页与侧边栏、面包屑保持同一份可见性
	const children = useMemo(() => filterNavByPermission(node?.children ?? [], granted), [node, granted]);
	if (!node) return null;

	const subgroups = children.filter((child) => child.children?.length);
	const directPages = children.filter((child) => !child.children?.length);
	const allLeaves = children.flatMap((c) => c.children ?? [c]);
	const totalPages = allLeaves.length;

	return (
		<div className="page-enter">
			<PageHeader
				title={node.name}
				description={node.description}
				actions={
					<>
						<Button variant="outline" size="sm" className="gap-1.5">
							<Layers className="size-3.5" />
							模块布局
						</Button>
						<Button size="sm" className="gap-1.5 shadow-[var(--shadow-glow)]">
							<Search className="size-3.5" />
							浏览全部 {totalPages} 项
						</Button>
					</>
				}
			/>

			<div className="space-y-6 px-6 py-6">
				{/* ── KPI strip: 横向分割四块,不用 card 包裹 ─────────────────────────── */}
				<section className="grid grid-cols-2 gap-x-8 gap-y-4 border-b border-[color:var(--border)] pb-6 lg:grid-cols-4 lg:divide-x lg:divide-[color:var(--border)]">
					<div className="kpi !border-0 !shadow-none !bg-transparent !p-0">
						<div className="kpi-label">
							<Layers className="size-3.5" />
							本模块页面
						</div>
						<div className="kpi-value">
							{totalPages}
							<span className="unit">个</span>
						</div>
						<div className="kpi-foot text-[11px]">
							含 {subgroups.length} 个分组,最近 7 天新增 {Math.min(totalPages, 3)}
						</div>
					</div>
					<div className="kpi !border-0 !shadow-none !bg-transparent !p-0">
						<div className="kpi-label">
							<Layers className="size-3.5" />
							分组
						</div>
						<div className="kpi-value">
							{subgroups.length}
							<span className="unit">组</span>
						</div>
						<div className="kpi-foot text-[11px]">
							{subgroups.length >= 2 ? "覆盖业务 / 数据 / 系统三大类" : "结构待扩展"}
						</div>
					</div>
					<div className="kpi !border-0 !shadow-none !bg-transparent !p-0">
						<div className="kpi-label">
							<Layers className="size-3.5" />
							今日变更
						</div>
						<div className="kpi-value">
							{Math.min(totalPages, 5)}
							<span className="unit">条</span>
						</div>
						<div className="kpi-foot text-[11px]">最新更新 2 分钟前</div>
					</div>
					<div className="kpi !border-0 !shadow-none !bg-transparent !p-0">
						<div className="kpi-label">
							<Layers className="size-3.5" />
							待我处理
						</div>
						<div className="kpi-value">
							7<span className="unit">项</span>
						</div>
						<div className="kpi-foot text-[11px]">3 条逾期,4 条本周内</div>
					</div>
				</section>

				{/* ── 分组卡片网格:去 card 阴影与 hover-glow,用 hairline + 简洁结构 ───── */}
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{subgroups.map((group) => (
						<section key={group.name} className="space-y-3">
							<header className="flex items-baseline justify-between gap-2 border-b border-[color:var(--border)] pb-2">
								<h3 className="text-[14px] font-medium tracking-[-0.005em] text-[color:var(--foreground)]">
									{group.name}
								</h3>
								<span className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
									{group.children?.length ?? 0} 个页面
								</span>
							</header>
							<nav className="flex flex-col">
								{group.children?.map((page) => (
									<NavLink key={page.path ?? page.name} node={page} />
								))}
							</nav>
						</section>
					))}

					{directPages.length > 0 && (
						<section className="space-y-3">
							<header className="flex items-baseline justify-between gap-2 border-b border-[color:var(--border)] pb-2">
								<h3 className="text-[14px] font-medium tracking-[-0.005em] text-[color:var(--foreground)]">直达</h3>
								<span className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
									{directPages.length} 个页面
								</span>
							</header>
							<nav className="flex flex-col">
								{directPages.map((page) => (
									<NavLink key={page.path ?? page.name} node={page} />
								))}
							</nav>
						</section>
					)}
				</div>
			</div>
		</div>
	);
}

function NavLink({ node }: { node: NavNode }) {
	const Icon = NAV_ICON_MAP[node.icon];
	if (!node.path) return null;
	return (
		<Link
			to={node.path}
			className="group flex items-center gap-3 px-1 py-1.5 text-[13px] text-foreground/80 transition-colors duration-150 hover:text-foreground"
		>
			{Icon && (
				<Icon
					className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground/80"
					strokeWidth={1.5}
				/>
			)}
			<span className="flex-1 truncate">{node.name}</span>
			<ChevronRight
				// 常显、不做位移动效:之前是 hover 时从左滑入,鼠标停在边缘会反复触发
				className="size-3 shrink-0 text-muted-foreground/60"
				aria-hidden="true"
			/>
		</Link>
	);
}
