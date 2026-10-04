import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { findNavNodeIn, NAV_ICON_MAP, type NavNode } from "#/components/layout/nav-config";
import { useNavNodes } from "#/components/layout/nav-data";
import { PageHeader } from "#/components/layout/page-header";

/**
 * 模块首页(Menu 一级模块的落地页)—— 直接渲染该模块子树里的分组与页面。
 *
 * 内容全部来自 `useNavNodes()`(`menu.mine`,与侧边栏同源),所以菜单和这页不可能漂移:加菜单项 = 这里自动出现。
 */
export function ModuleOverview({ path }: { path: string }) {
	// 与侧边栏同一棵(动态)菜单树:菜单表改了,模块首页跟着变
	const nodes = useNavNodes();
	const node = useMemo(() => findNavNodeIn(nodes, path), [nodes, path]);
	const children = node?.children ?? [];
	if (!node) return null;

	const subgroups = children.filter((child) => child.children?.length);
	const directPages = children.filter((child) => !child.children?.length);

	return (
		<div className="page-enter">
			<PageHeader title={node.name} description={node.description} />

			<div className="space-y-6 px-6 py-6">
				{/* ── 分组卡片网格:去 card 阴影与 hover-glow,用 hairline + 简洁结构 ───── */}
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{subgroups.map((group) => (
						<section key={group.name} className="space-y-3">
							<header className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
								<h3 className="text-sm font-medium text-foreground">{group.name}</h3>
								<span className="text-xs tabular-nums text-muted-foreground">{group.children?.length ?? 0} 个页面</span>
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
							<header className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
								<h3 className="text-sm font-medium text-foreground">直达</h3>
								<span className="text-xs tabular-nums text-muted-foreground">{directPages.length} 个页面</span>
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
			className="group flex items-center gap-3 px-1 py-1.5 text-sm text-foreground/80 transition-colors duration-150 hover:text-foreground"
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
