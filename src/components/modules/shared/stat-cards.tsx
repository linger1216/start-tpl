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
 *   · hover:`bg-muted/40` 轻微高亮,无粗边框
 *   · 微动效:每张卡 staggered 入场(40ms 间隔),hover 时 1px 上浮,优先 transform/opacity
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
			? "flex flex-row divide-x divide-[color:var(--border)] rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] overflow-hidden"
			: "grid grid-cols-2 gap-2 lg:grid-cols-4";
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
	const trendColor =
		trend === "up"
			? "text-[color:var(--success)]"
			: trend === "down"
				? "text-[color:var(--danger)]"
				: "text-[color:var(--muted-foreground)]";
	const trendBg =
		trend === "up"
			? "bg-[color:var(--success)]/8"
			: trend === "down"
				? "bg-[color:var(--danger)]/8"
				: "bg-[color:var(--muted)]";

	if (variant === "strip") {
		return (
			<div className="group/stat-cell flex flex-1 min-w-0 items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[color:var(--muted)]/40">
				<div
					className={cn(
						"flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
						tone,
					)}
				>
					<Icon className="size-3.5" />
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-px">
					<div className="flex items-baseline gap-1">
						<span className="font-heading text-[20px] font-medium leading-none tracking-[-0.01em] tabular-nums text-[color:var(--foreground)]">
							{typeof value === "number" ? value.toLocaleString() : value}
						</span>
						{unit ? <span className="text-[11px] text-[color:var(--muted-foreground)]">{unit}</span> : null}
					</div>
					<div className="flex min-w-0 items-center justify-between gap-2">
						<span className="truncate text-[11.5px] text-[color:var(--muted-foreground)]">
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
		<div className="group relative flex min-w-0 items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2.5 transition-colors duration-150 hover:border-[color:var(--af-blue)] hover:bg-[color:var(--muted)]/30">
			<div className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", tone)}>
				<Icon className="size-3.5" />
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-px">
				<div className="flex items-baseline gap-1">
					<span className="font-heading text-[18px] font-medium leading-none tracking-[-0.01em] tabular-nums text-[color:var(--foreground)]">
						{typeof value === "number" ? value.toLocaleString() : value}
					</span>
					{unit ? <span className="text-[11px] text-[color:var(--muted-foreground)]">{unit}</span> : null}
				</div>
				<div className="flex min-w-0 items-center justify-between gap-2">
					<span className="truncate text-[11.5px] text-[color:var(--muted-foreground)]">{label}</span>
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
