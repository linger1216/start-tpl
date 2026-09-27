import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

export type StatItem = {
	key: string;
	label: string;
	value: number | string;
	description?: string;
	Icon: LucideIcon;
	/** 图标底色 + 文字色,如 "bg-secondary text-foreground" */
	tone: string;
	/** 单位后缀,如 "家"、"次"、"条" */
	unit?: string;
};

/**
 * 顶部指标条 —— 一格一个指标,边界与悬浮跟 `ui/card.tsx` **同一套语言**:
 * 静止是 1px `border-border` 的细边,悬停这条边刷成亮蓝(`primary`)。
 * 于是"指标格子"和页面上的卡片在视觉上是一家,不需要为它单独记一套规则。
 *
 * 布局**只有一种**:一行铺开(`flex`,格与格 8px 间距),适合作页面顶部指标条。
 *
 * `tone` 是**类名字符串**(不是色相名):调用方传 `"bg-hue-violet-soft text-hue-violet-fg"`
 * 这类组合,组件层不解释颜色语义 —— 同一张表里不同口径可以配不同色相。
 */
export function StatCards({ items, className }: { items: StatItem[]; className?: string }) {
	return (
		<div className={cn("stagger flex flex-row gap-2", className)}>
			{items.map(({ key, label, value, description, Icon, tone, unit }) => (
				<StatCell key={key} label={label} value={value} unit={unit} description={description} Icon={Icon} tone={tone} />
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
}: {
	label: ReactNode;
	value: number | string;
	unit?: string;
	description?: string;
	Icon: LucideIcon;
	tone: string;
}) {
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
					<span className="font-heading text-xl leading-none font-medium tracking-[-0.01em] tabular-nums text-foreground">
						{typeof value === "number" ? value.toLocaleString() : value}
					</span>
					{unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
				</div>
				<span className="truncate text-xs text-muted-foreground">
					{label}
					{description ? <span className="ml-1 opacity-70">· {description}</span> : null}
				</span>
			</div>
		</div>
	);
}
