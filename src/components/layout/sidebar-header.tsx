import { Link } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

/**
 * 后台外壳的**品牌标题区** —— 顶部一个 icon + 一个标题 + 一个副标题。
 *
 * 刻意**不放进侧边栏组件**:标题区和菜单是两件事 ——
 *  · 菜单关心的是「有哪些页面、我在哪一页」,数据来自 `sys_menu`;
 *  · 标题区关心的是「这是哪个系统」,数据来自项目配置。
 * 一个派生项目换系统名,不该动菜单逻辑;反过来,菜单改造(拖拽排序 / 多级分组)也不该碰这个文件。
 * 所以它只收 props,不认识 `NavNode`,也不 import 任何菜单模块。
 *
 * 用法:
 * ```tsx
 * <SidebarHeader title="管理后台" subtitle="TanStack Start 模板" />
 * <SidebarHeader compact icon={<ShieldCheck />} title="风控台" subtitle="生产环境" />
 * ```
 *
 * 收起态(`compact`,60px 迷你图标栏)只留 icon,名字走**原生 `title`**:
 * 侧边栏是 `overflow-hidden` 的,自绘浮层必被裁掉(CSS 无法同时「纵向 auto + 横向可见」)。
 */
export function SidebarHeader({
	/** 默认仪表盘图标;换品牌图标直接传 lucide 组件 */
	icon,
	title,
	subtitle,
	/** 点击回到的路径;传 `null` 则不渲染成链接 */
	to = "/",
	/** 迷你图标栏形态:只有 icon,居中 */
	compact = false,
	className,
}: {
	icon?: ReactNode;
	title: string;
	subtitle?: string;
	to?: string | null;
	compact?: boolean;
	className?: string;
}) {
	const tile = (
		<span
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-seal/70 bg-seal/10 font-heading text-[13px] font-bold text-seal-fg",
			)}
		>
			{icon ?? (typeof title === "string" ? title.slice(0, 1) : null) ?? <LayoutDashboard />}
		</span>
	);

	// 两态都是 h-14:与顶栏同高,两栏的底部 hairline 落在同一条水平线上,外壳才不会"错行"
	const shell = "h-14 shrink-0 border-b border-border";

	/** 迷你态:只有方块,居中;名字靠原生 title 提示 */
	if (compact) {
		const name = subtitle ? `${title} · ${subtitle}` : title;
		return (
			<div className={cn(shell, "flex items-center justify-center", className)} data-slot="sidebar-header">
				{to ? (
					<Link to={to} aria-label={name} title={name} className="flex items-center justify-center">
						{tile}
					</Link>
				) : (
					<span title={name}>{tile}</span>
				)}
			</div>
		);
	}

	return (
		<div className={cn(shell, "flex items-center px-3.5", className)} data-slot="sidebar-header">
			{/* 整块可点回首页:文字本身就是可访问名,不再叠加 aria-label */}
			<LinkComponent to={to} className="flex min-w-0 flex-1 items-center gap-2.5">
				{tile}
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm leading-tight font-semibold text-foreground">{title}</div>
					{subtitle ? (
						<div className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">{subtitle}</div>
					) : null}
				</div>
			</LinkComponent>
		</div>
	);
}

/** `to` 为空时退化成普通容器,省得写两份 JSX */
function LinkComponent({ to, className, children }: { to?: string | null; className?: string; children: ReactNode }) {
	if (!to) return <div className={className}>{children}</div>;
	return (
		<Link to={to} className={className}>
			{children}
		</Link>
	);
}
