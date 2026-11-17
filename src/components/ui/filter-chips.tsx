import { ChevronDown, Filter, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "#/lib/utils";

/**
 * 快速筛选胶囊组 —— 列表页「一排可选中的小圆片」。
 *
 * 为什么单独封装:此前每个页面都手写"一排圆角小按钮",选中态只有一种颜色、
 * 也分不清组内是**互斥单选**还是**可同时多选**。这里收成一个受控组件:
 * **组**是语义单位,组内要么单选(互斥)、要么多选(可同时开)。
 *
 * 状态留在编排壳(受控):组件只管长相与「点一下算出下一组选中值」。
 *
 * 颜色:选项可自带 `activeClassName`(语义色,如 P0 红 / 超期红),不传则用主题色 ——
 * **不写死颜色字面量**,用项目既有的 token(`bg-warn-soft` / `text-warn-fg` …)。
 */
export type FilterChipOption = {
	/** 值 —— `onChange` 回传它 */
	value: string;
	/** 显示名 */
	label: string;
	/** 选中态配色(语义色);不传用主题色 */
	activeClassName?: string;
};

export type FilterChipGroup = {
	/** 组 id —— `onChange` 用它回传 */
	key: string;
	/** 组名(显示在组内选项前面) */
	label: string;
	/** 组名前的图标 —— 一眼看出这组筛的是什么 */
	Icon?: LucideIcon;
	/** 多选组:组内可同时选多个;不传 = 单选(互斥,再点已选中的取消) */
	multiple?: boolean;
	options: readonly FilterChipOption[];
};

/** 选中态默认配色(主题色)—— 选项自带语义色时覆盖它 */
const DEFAULT_ACTIVE = "bg-primary/10 text-primary";

export function FilterChipBar({
	groups,
	active,
	onChange,
	orientation = "horizontal",
	title,
	collapsible = false,
	defaultExpanded = true,
	initialExpanded,
	onExpandedChange,
	className,
}: {
	groups: readonly FilterChipGroup[];
	/**
	 * 每组当前选中的值 —— **统一成数组**(单选组最多一个,多选组可多个)。
	 * 统一成数组是这份 API 的关键:两种组别才能共用一个 `active` / `onChange`。
	 */
	active: Readonly<Record<string, readonly string[]>>;
	/** 某一组的选中值变了 —— 回传该组新的**完整**选中值 */
	onChange: (groupKey: string, next: readonly string[]) => void;
	/** 组的排列:横向一排(默认,宽栏用)/ 竖向每组一行(窄栏、侧边用) */
	orientation?: "horizontal" | "vertical";
	/** 标题(带筛选图标);不传 = 只有胶囊组 */
	title?: string;
	/** 可折叠:收起时只留标题 + 「已选 N 项」+ 展开按钮 */
	collapsible?: boolean;
	/** 初始展开态(库里那个值还没到位时用这个) */
	defaultExpanded?: boolean;
	/** 库里记着的展开态 —— 只在它第一次有值时套用一次 */
	initialExpanded?: boolean;
	/** 展开 / 收起后回传,调用方拿去持久化 */
	onExpandedChange?: (expanded: boolean) => void;
	className?: string;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	/** 用户动过就别再被「库里那个值」覆盖 */
	const touchedRef = useRef(false);
	const appliedRef = useRef(false);

	// 库里那个展开态到位后只套用一次 —— 否则用户刚展开就被回读打回折叠
	useEffect(() => {
		if (appliedRef.current || initialExpanded === undefined || touchedRef.current) return;
		appliedRef.current = true;
		setExpanded(initialExpanded);
	}, [initialExpanded]);

	/** 点一下某个选项 → 该组新的选中值 */
	function nextOf(group: FilterChipGroup, selected: readonly string[], value: string): string[] {
		const on = selected.includes(value);
		if (group.multiple) return on ? selected.filter((item) => item !== value) : [...selected, value];
		return on ? [] : [value];
	}

	function toggleExpanded() {
		const next = !expanded;
		touchedRef.current = true;
		setExpanded(next);
		onExpandedChange?.(next);
	}

	const selectedCount = groups.reduce((sum, group) => sum + (active[group.key] ?? []).length, 0);

	const titleNode = title ? (
		<span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
			<Filter className="size-3.5 text-muted-foreground" />
			{title}
		</span>
	) : null;

	const summaryNode =
		collapsible && !expanded && selectedCount > 0 ? (
			<span className="text-xs text-muted-foreground">已选 {selectedCount} 项</span>
		) : null;

	const toggleNode = collapsible ? (
		<button
			type="button"
			aria-expanded={expanded}
			onClick={toggleExpanded}
			className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/20"
		>
			{expanded ? "收起" : "展开"}
			<ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
		</button>
	) : null;

	const groupNodes =
		!collapsible || expanded
			? groups.map((group) => {
					const selected = active[group.key] ?? [];
					const Icon = group.Icon;
					return (
						<div
							key={group.key}
							className={cn("flex flex-wrap items-center gap-1.5", orientation === "vertical" && "w-full")}
						>
							{Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
							<span className="text-xs text-muted-foreground">{group.label}</span>
							{group.options.map((option) => {
								const on = selected.includes(option.value);
								return (
									<button
										key={option.value}
										type="button"
										aria-pressed={on}
										onClick={() => onChange(group.key, nextOf(group, selected, option.value))}
										className={cn(
											"inline-flex h-6 cursor-pointer items-center rounded-full border px-2.5 text-xs transition-[color,background-color,border-color] duration-150 outline-none focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-primary/20",
											on
												? cn("border-transparent font-medium", option.activeClassName ?? DEFAULT_ACTIVE)
												: "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
										)}
									>
										{option.label}
									</button>
								);
							})}
						</div>
					);
				})
			: null;

	if (orientation === "vertical") {
		return (
			<div className={cn("flex flex-col items-start gap-2", className)}>
				<div className="flex items-center gap-2">
					{titleNode}
					{summaryNode}
					{toggleNode}
				</div>
				{groupNodes}
			</div>
		);
	}

	return (
		<div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
			{titleNode}
			{summaryNode}
			{groupNodes}
			{toggleNode}
		</div>
	);
}
