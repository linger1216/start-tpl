import type { LucideIcon } from "lucide-react";

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
 * 顶部指标条 —— 紧凑横向一行,细边、轻量。
 *
 * 视觉规则:
 *   · flex 横向铺开,每张卡 `flex: 1 1 0`,min-width 控死避免挤压
 *   · 1px hairline 分隔(0.5px 在 retina 上呈现为 1px),不用 box-shadow
 *   · 大数字 20px / 500 / -0.01em 字距,tabular-nums
 *   · 趋势 chip + sparkline 同行靠右
 *   · hover:整格换成 hover 底色(不用粗边框,避免整条指标条都在"闪边")
 *   · 入场:整条错落入场(stagger,每格 22ms)—— 四格指标一次性浮入比硬出现更稳
 *
 * `tone` 是**类名字符串**(不是色相名):调用方传 `"bg-hue-violet-soft text-hue-violet-fg"`
 * 这类组合,组件层不解释颜色语义 —— 于是同一张表里不同口径可以配不同色相。
 */
export function StatCards({
	items,
	className,
	variant = "strip",
}: {
	items: StatItem[];
	className?: string;
	/** `strip` 横向铺开(默认);`cards` 每张独立小卡片 */
	variant?: "strip" | "cards";
}) {
	const wrapperClass =
		variant === "strip"
			? "stagger flex flex-row divide-x divide-border rounded-xl border border-border bg-background shadow-raise-1 overflow-hidden"
			: "stagger grid grid-cols-2 gap-2 lg:grid-cols-4";
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
					variant={variant}
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
	variant,
}: {
	label: React.ReactNode;
	value: number | string;
	unit?: string;
	description?: string;
	Icon: LucideIcon;
	tone: string;
	trend?: "up" | "down" | "flat";
	delta?: string;
	spark?: "blue" | "green" | "red" | "amber";
	sparkPoints?: string;
	variant: "strip" | "cards";
}) {
	/** 趋势配色:上升 = 绿、下降 = 红、持平 = 灰 */
	const trendColor = trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-muted-foreground";
	const trendBg = trend === "up" ? "bg-success/8" : trend === "down" ? "bg-danger/8" : "bg-muted";

	if (variant === "strip") {
		return (
			<div className="group/stat-cell flex min-w-0 flex-1 items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-hover">
				<div
					className={cn(
						"flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-border ring-inset transition-shadow duration-200 group-hover/stat-cell:ring-border-strong",
						tone,
					)}
				>
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
							<span
								className={cn(
									"shrink-0 rounded-md px-1 py-px text-[10.5px] font-medium tabular-nums",
									trendColor,
									trendBg,
								)}
							>
								{delta}
							</span>
						) : null}
					</div>
				</div>
				{spark && sparkPoints ? (
					<svg
						className={cn("spark shrink-0", spark)}
						viewBox="0 0 56 18"
						preserveAspectRatio="none"
						aria-hidden="true"
					>
						<polyline points={sparkPoints} />
					</svg>
				) : null}
			</div>
		);
	}

	// ── cards variant: 小卡片 ──
	return (
		<div className="group relative flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 shadow-raise-1 transition-[border-color,box-shadow] duration-200 ease-brand hover:border-border-strong hover:shadow-raise-2">
			<div
				className={cn(
					"flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-border ring-inset",
					tone,
				)}
			>
				<Icon className="size-3.5" />
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-px">
				<div className="flex items-baseline gap-1">
					<span className="font-heading text-[18px] leading-none font-medium tracking-[-0.01em] tabular-nums text-foreground">
						{typeof value === "number" ? value.toLocaleString() : value}
					</span>
					{unit ? <span className="text-[11px] text-muted-foreground">{unit}</span> : null}
				</div>
				<div className="flex min-w-0 items-center justify-between gap-2">
					<span className="truncate text-[11.5px] text-muted-foreground">{label}</span>
					{delta && trend ? (
						<span
							className={cn(
								"shrink-0 rounded-md px-1 py-px text-[10.5px] font-medium tabular-nums",
								trendColor,
								trendBg,
							)}
						>
							{delta}
						</span>
					) : null}
				</div>
			</div>
		</div>
	);
}
