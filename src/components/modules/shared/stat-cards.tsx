import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "#/components/ui/badge";
import { cn } from "#/lib/utils";

export type StatItem = {
	key: string;
	label: string;
	value: number | string;
	description?: string;
	Icon: LucideIcon;
	/** 图标底色 + 文字色,如 "bg-secondary text-foreground" */
	tone: string;
	/** 趋势:正/负/平,对应色 chip */
	trend?: "up" | "down" | "flat";
	/** 趋势百分比文本,如 "12.4%" */
	delta?: string;
	/** sparkline 颜色:对应 .spark.{color} */
	spark?: "blue" | "green" | "red" | "amber";
	/** sparkline 多边形点序列,SVG points 字符串 */
	sparkPoints?: string;
	/** 单位后缀,如 "家"、"次"、"条" */
	unit?: string;
};

/**
 * 顶部指标条 —— 一格一个指标,边界与悬浮跟 `ui/card.tsx` **同一套语言**:
 * 静止是 1px `border-border` 的细边,悬停这条边刷成亮蓝(`primary`)。
 * 于是"指标格子"和页面上的卡片在视觉上是一家,不需要为它单独记一套规则。
 *
 * `variant` 现在**只决定外层怎么排**:
 *   · `strip`(默认)—— 一行铺开(`flex`,格与格 8px 间距),适合作页面顶部指标条;
 *   · `cards` —— 网格(`grid-cols-2` / `lg:grid-cols-4`),适合作网格里的指标区。
 * 格子本身**只有一套实现**,两种排法长得一样 —— 不再各写一份(以前那两份除了这几个类几乎逐字重复,
 * 还漏了 `description` 的渲染)。
 *
 * `tone` 是**类名字符串**(不是色相名):调用方传 `"bg-hue-violet-soft text-hue-violet-fg"`
 * 这类组合,组件层不解释颜色语义 —— 同一张表里不同口径可以配不同色相。
 */
export function StatCards({
	items,
	className,
	variant = "strip",
}: {
	items: StatItem[];
	className?: string;
	/** 只影响外层排列:`strip` 一行铺开(默认);`cards` 网格 */
	variant?: "strip" | "cards";
}) {
	const wrapperClass =
		variant === "strip" ? "stagger flex flex-row gap-2" : "stagger grid grid-cols-2 gap-2 lg:grid-cols-4";
	return (
		<div className={cn(wrapperClass, className)}>
			{items.map(({ key, label, value, description, Icon, tone, trend, delta, spark, sparkPoints, unit }) => (
				<StatCell
					key={key}
					label={label}
					value={value}
					unit={unit}
					description={description}
					Icon={Icon}
					tone={tone}
					trend={trend}
					delta={delta}
					spark={spark}
					sparkPoints={sparkPoints}
				/>
			))}
		</div>
	);
}

function StatCell({
	label,
	value,
	unit,
	description,
	Icon,
	tone,
	trend,
	delta,
	spark,
	sparkPoints,
}: {
	label: ReactNode;
	value: number | string;
	unit?: string;
	description?: string;
	Icon: LucideIcon;
	tone: string;
	trend?: "up" | "down" | "flat";
	delta?: string;
	spark?: "blue" | "green" | "red" | "amber";
	sparkPoints?: string;
}) {
	/** 趋势配色:上升 = 绿、下降 = 红、持平 = 灰 */
	const trendColor = trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-muted-foreground";
	const trendBg = trend === "up" ? "bg-success/8" : trend === "down" ? "bg-danger/8" : "bg-muted";

	return (
		<div
			className={cn(
				"flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5",
				"transition-colors duration-200 ease-brand",
				// 悬浮:这条 1px 边框刷成亮蓝 —— 与 `ui/card.tsx` 完全一致
				"hover:border-primary",
			)}
		>
			<div className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", tone)}>
				<Icon className="size-3.5" />
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-px">
				<div className="flex items-baseline gap-1">
					<span className="font-heading text-[20px] leading-none font-medium tracking-[-0.01em] tabular-nums text-foreground">
						{typeof value === "number" ? value.toLocaleString() : value}
					</span>
					{unit ? <span className="text-[11px] text-muted-foreground">{unit}</span> : null}
				</div>
				<div className="flex min-w-0 items-center justify-between gap-2">
					<span className="truncate text-[11.5px] text-muted-foreground">
						{label}
						{description ? <span className="ml-1 opacity-70">· {description}</span> : null}
					</span>
					{delta && trend ? (
						// 增减百分比是显示值 → 用 Badge(形状照旧靠 className 覆盖)
						<Badge
							variant="secondary"
							className={cn(
								"h-4 shrink-0 rounded-md px-1 py-px text-[10.5px] font-medium tabular-nums",
								trendColor,
								trendBg,
							)}
						>
							{delta}
						</Badge>
					) : null}
				</div>
			</div>
			{spark && sparkPoints ? (
				<svg className={cn("spark shrink-0", spark)} viewBox="0 0 56 18" preserveAspectRatio="none" aria-hidden="true">
					<polyline points={sparkPoints} />
				</svg>
			) : null}
		</div>
	);
}
