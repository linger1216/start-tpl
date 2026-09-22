import type { LucideIcon } from "lucide-react";
import { Check, Filter, X } from "lucide-react";
import type { ReactNode } from "react";

import { BADGE_THEMES } from "#/components/ui/badge-list";
import { cn } from "#/lib/utils";

/**
 * 列表页快速筛选条 —— 领域无关形状的展示件(见 `doc/前端结构与组件约定.md` §3.3)。
 *
 * 为什么单独封装:此前每个页面都手写"一排圆角小按钮",既像 badge 又没有选中态、配色也只有一种。
 * 这里把它收成一个受控组件:配色统一取自项目既有的分类色板 `BADGE_THEMES`
 * (见 `components/ui/badge-list.tsx`,不新造颜色字面量),组内选项按调色板轮转上色。
 *
 * 用法(受控,状态留在编排壳):
 *   <FilterChipBar groups={GROUPS} active={active} onSelect={handleSelect} onClearAll={clearAll} />
 */

export type FilterChipTone = keyof typeof BADGE_THEMES;

/** 组图标的着色:与 `BADGE_THEMES` 同一色系(走点缀色 token,不再是高饱和的 `*-600`) */
const GROUP_ICON_TONE: Record<FilterChipTone, string> = {
	brand: "text-primary",
	rainbow: "text-hue-violet-fg",
	ocean: "text-hue-teal-fg",
	forest: "text-hue-emerald-fg",
	sunset: "text-hue-amber-fg",
	lavender: "text-hue-violet-fg",
	stone: "text-muted-foreground",
};

export type FilterChipOption = {
	value: string;
	/** 命中条数(由调用方按真实数据算好;不传则不显示计数) */
	count?: number;
};

export type FilterChipGroup = {
	/** 列 id,`onSelect` 用它回传 */
	key: string;
	label: string;
	Icon?: LucideIcon;
	/** 调色板:组内选项按 `BADGE_THEMES[tone]` 轮转取色 */
	tone: FilterChipTone;
	options: readonly FilterChipOption[];
};

/** 组内第 i 个选项的"选中态"配色 */
const activeChipClass = (tone: FilterChipTone, index: number) => {
	const palette = BADGE_THEMES[tone];
	return palette[index % palette.length];
};

export function FilterChipBar({
	groups,
	active,
	onSelect,
	onClearAll,
	className,
	note,
}: {
	groups: readonly FilterChipGroup[];
	/** 每个组当前选中的值(单值;未选为 undefined) */
	active: Record<string, string | undefined>;
	onSelect: (groupKey: string, value: string | undefined) => void;
	/** 存在任一选中项时才显示右上角「清除全部」 */
	onClearAll?: () => void;
	className?: string;
	/** 标题右侧的口径说明 —— 各域标签来源不同,由调用方给出;不传则只显示「快速筛选」 */
	note?: ReactNode;
}) {
	const hasActive = Object.values(active).some(Boolean);

	return (
		<section
			aria-label="快速筛选"
			className={cn("rounded-xl border border-border bg-card px-3.5 py-3 shadow-raise-1", className)}
		>
			<div className="mb-2.5 flex items-center justify-between gap-3">
				<div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
					<Filter className="size-3.5 text-muted-foreground" />
					快速筛选
					{note ? <span className="font-normal text-muted-foreground">· {note}</span> : null}
				</div>
				{hasActive && onClearAll ? (
					<button
						type="button"
						onClick={onClearAll}
						className="cursor-pointer text-[12px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
					>
						清除全部
					</button>
				) : null}
			</div>

			<div className="space-y-2">
				{groups.map((group) => {
					const Icon = group.Icon;
					const current = active[group.key];
					return (
						<div key={group.key} className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
							<div className="flex w-32 shrink-0 items-center gap-1.5 pt-1 text-[12px] text-muted-foreground">
								{Icon ? <Icon className={cn("size-3.5", GROUP_ICON_TONE[group.tone])} /> : null}
								<span className="font-medium text-foreground/80">{group.label}</span>
							</div>

							<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
								{group.options.map((option, index) => {
									const on = current === option.value;
									return (
										<button
											key={option.value}
											type="button"
											aria-pressed={on}
											onClick={() => onSelect(group.key, on ? undefined : option.value)}
											className={cn(
												"inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-[color,background-color,border-color,box-shadow] duration-150",
												on
													? cn("border-transparent font-medium shadow-soft", activeChipClass(group.tone, index))
													: "border-border bg-background text-muted-foreground hover:border-hue-blue-line hover:bg-secondary hover:text-foreground",
											)}
										>
											{on ? <Check className="size-3" /> : null}
											{option.value}
											{typeof option.count === "number" ? (
												<span
													className={cn(
														"ml-0.5 rounded-full px-1.5 text-[10.5px] tabular-nums",
														on ? "bg-black/10" : "bg-muted text-muted-foreground",
													)}
												>
													{option.count}
												</span>
											) : null}
										</button>
									);
								})}

								{current ? (
									<button
										type="button"
										onClick={() => onSelect(group.key, undefined)}
										className="ml-0.5 inline-flex cursor-pointer items-center gap-0.5 rounded-full px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
									>
										<X className="size-3" />
										清除
									</button>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

/** 已选筛选 pills —— 独占一行(见 `DESIGN.md` §5.3「Active filter pills」) */
export function ActiveFilterPills({
	items,
	onRemove,
	onClearAll,
	className,
}: {
	items: readonly { key: string; groupLabel: string; value: string; tone: FilterChipTone }[];
	onRemove: (groupKey: string) => void;
	onClearAll: () => void;
	className?: string;
}) {
	if (items.length === 0) return null;

	return (
		<div className={cn("flex flex-wrap items-center gap-1.5", className)}>
			<span className="text-[12px] text-muted-foreground">已选筛选</span>
			{items.map((item) => (
				<span
					key={item.key}
					className={cn(
						"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium",
						BADGE_THEMES[item.tone][0],
					)}
				>
					<span className="opacity-70">{item.groupLabel}</span>
					{item.value}
					<button
						type="button"
						aria-label={`移除「${item.groupLabel}:${item.value}」`}
						onClick={() => onRemove(item.key)}
						className="cursor-pointer rounded-full p-0.5 transition-colors hover:bg-black/10"
					>
						<X className="size-3" />
					</button>
				</span>
			))}
			<button
				type="button"
				onClick={onClearAll}
				className="ml-1 cursor-pointer text-[12px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
			>
				清除全部
			</button>
		</div>
	);
}
