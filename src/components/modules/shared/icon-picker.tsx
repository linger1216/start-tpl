import { Check, ChevronDown, Search, X } from "lucide-react";
import * as React from "react";

import { Input } from "#/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { cn } from "#/lib/utils";
import {
	ALL_LUCIDE_ICONS,
	iconToLabel,
	LucideIcon,
	PINNED_ICONS,
	resolveLucideIconKey,
	toKebabCase,
} from "./use-lucide-icons";

/**
 * IconPicker —— 菜单图标选取器。
 *
 * 行为:
 *  - 触发器:图标预览 + 当前图标名 + 清空按钮 + 下拉箭头;
 *  - 浮层:顶部搜索框(中文 / 英文都能搜),主体是常用图标 + 全部图标网格。
 *
 * 浮层用 `ui/popover`(Base UI 的 Portal + Positioner),**不再手搓**
 * `createPortal` + `getBoundingClientRect` + 点击外部 / Esc 监听 —— 那套自己实现的定位
 * 在滚动、窗口缩放、浮层贴边时都要各自处理,而原语已经处理好了。
 */
export function IconPicker({
	value,
	onChange,
	placeholder = "选择图标",
	className,
}: {
	value: string | null;
	onChange: (next: string | null) => void;
	placeholder?: string;
	className?: string;
}) {
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState("");

	const filteredPinned = React.useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return PINNED_ICONS;
		return PINNED_ICONS.filter((n) => n.toLowerCase().includes(q) || iconToLabel(n).includes(q));
	}, [query]);

	const filteredAll = React.useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return ALL_LUCIDE_ICONS.slice(0, 60); // 首屏默认渲染 60 个
		return ALL_LUCIDE_ICONS.filter((n) => n.toLowerCase().includes(q) || iconToLabel(n).includes(q)).slice(0, 200);
	}, [query]);

	/**
	 * 当前值解析成 PascalCase(库中存 kebab-case,网格里是 PascalCase),
	 * 用于网格选中态比较与搜索词归一。
	 */
	const resolvedCurrent = React.useMemo(() => resolveLucideIconKey(value), [value]);

	function pick(name: string) {
		// 按项目约定(见 icons-list 注释)持久化 kebab-case 名
		onChange(toKebabCase(name));
		setOpen(false);
		setQuery("");
	}

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setQuery("");
			}}
		>
			{/* 清空按钮**不能**放进触发器里(button 套 button 是非法结构),所以用相对定位贴在右侧 */}
			<div className={cn("relative", className)}>
				<PopoverTrigger
					className={cn(
						"flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 hover:border-border-strong text-sm",
						"transition-colors hover:bg-accent/30",
						value && "pr-12",
					)}
				>
					<span className="flex min-w-0 items-center gap-2">
						{value ? (
							<>
								<LucideIcon name={value} className="size-4 shrink-0" />
								<span className="truncate font-mono text-xs">{value}</span>
							</>
						) : (
							<span className="text-muted-foreground">{placeholder}</span>
						)}
					</span>
					<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
				</PopoverTrigger>
				{value ? (
					<button
						type="button"
						onClick={() => onChange(null)}
						className="absolute top-1/2 right-7 -translate-y-1/2 text-muted-foreground hover:text-danger"
						aria-label="清空图标"
						title="清空图标"
					>
						<X className="size-3.5" />
					</button>
				) : null}
			</div>

			<PopoverContent align="start" className="w-80 p-0">
				<div className="flex max-h-[26rem] flex-col overflow-hidden">
					<div className="shrink-0 border-b border-border p-2">
						<div className="relative">
							<Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="搜索图标名 (Users / home / 用户)"
								className="h-8 pl-8 text-xs"
							/>
						</div>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto p-3">
						{filteredPinned.length > 0 && (
							<Section title="常用" icons={filteredPinned} current={resolvedCurrent} onPick={pick} />
						)}
						<Section
							title={query ? `搜索结果 (${filteredAll.length})` : "全部"}
							icons={filteredAll}
							current={resolvedCurrent}
							onPick={pick}
							emptyText="无匹配图标"
						/>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** 一组图标网格 */
function Section({
	title,
	icons,
	current,
	onPick,
	emptyText,
}: {
	title: string;
	icons: readonly string[];
	current: string | null;
	onPick: (name: string) => void;
	emptyText?: string;
}) {
	return (
		<div className="mb-3 last:mb-0">
			<div className="mb-2 px-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">{title}</div>
			{icons.length === 0 && emptyText ? (
				<div className="py-6 text-center text-xs text-muted-foreground">{emptyText}</div>
			) : (
				<div className="grid grid-cols-8 gap-1">
					{icons.map((name) => {
						const selected = name === current;
						return (
							<button
								key={name}
								type="button"
								title={name}
								aria-label={`选择 ${name} 图标`}
								aria-pressed={selected}
								onClick={() => onPick(name)}
								className={cn(
									"group relative flex aspect-square items-center justify-center rounded-lg border border-transparent",
									"hover:border-border hover:bg-accent/50",
									selected && "border-primary bg-primary/10 text-primary",
								)}
							>
								<LucideIcon name={name} className="size-4" />
								{selected && <Check className="absolute right-0.5 bottom-0.5 size-2.5 text-primary" />}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
