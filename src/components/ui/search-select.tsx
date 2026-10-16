import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { Spinner } from "#/components/ui/spinner";
import { cn } from "#/lib/utils";

export type SearchSelectOption<T extends string = string> = {
	value: T;
	label: string;
};

/**
 * 过滤引擎(唯一实现):label 与 value 都参与匹配。
 */
function useOptionSearch<T extends string>(
	options: readonly SearchSelectOption<T>[],
	query: string,
): SearchSelectOption<T>[] {
	return useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return options as SearchSelectOption<T>[];
		return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
	}, [options, query]);
}

/**
 * 带搜索框的可搜索下拉(Combobox)—— 选项多到 `Select` 不好翻时用它。
 *
 * 浮层用 `ui/popover`(Base UI 的 Portal + Positioner),**不再手搓** portal + `getBoundingClientRect`
 * + 点击外部 / Esc / 滚动重定位:那些原语已经处理好(而且滚动时是跟随重定位,不是关掉)。
 *
 * 为什么和 `Select` 并存:`Select` 是"从一小组里选一个"(无搜索、键盘按首字母跳),
 * 这里是"从几百个里搜一个"。两者的交互与可达性要求不同,合并会把 `Select` 拖重。
 */
export function SearchSelect<T extends string = string>({
	value,
	onValueChange,
	options,
	placeholder = "请选择",
	emptyText = "无匹配选项",
	align = "start",
	disabled = false,
	loading = false,
}: {
	value: T | undefined;
	onValueChange: (v: T) => void;
	options: SearchSelectOption<T>[];
	placeholder?: string;
	emptyText?: string;
	align?: "start" | "end";
	disabled?: boolean;
	loading?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [highlight, setHighlight] = useState(0);

	const filtered = useOptionSearch(options, query);
	const selected = options.find((o) => o.value === value);

	function pick(v: T) {
		onValueChange(v);
		setOpen(false);
		setQuery("");
		setHighlight(0);
	}

	function onInputKeyDown(e: React.KeyboardEvent) {
		if (filtered.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlight((h) => (h + 1) % filtered.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const target = filtered[highlight];
			if (target) pick(target.value);
		}
	}

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (disabled) return;
				setOpen(next);
				if (!next) {
					setQuery("");
					setHighlight(0);
				}
			}}
		>
			<PopoverTrigger
				disabled={disabled}
				aria-disabled={disabled}
				className={cn(
					// `w-full`:表单里它和 `Select` / `Input` 并排,三者都得占满字段列,否则宽度不一(实测踩过)
					"flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm hover:border-border-strong whitespace-nowrap transition-colors outline-none",
					disabled ? "cursor-not-allowed opacity-50" : "hover:border-ring/60 hover:text-foreground",
				)}
			>
				<span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
				{loading ? (
					<Spinner className="size-4 shrink-0 text-muted-foreground" />
				) : (
					<ChevronDown
						className={cn(
							"size-4 shrink-0 text-muted-foreground transition-transform duration-150",
							open && "rotate-180",
						)}
					/>
				)}
			</PopoverTrigger>

			<PopoverContent
				align={align}
				className="flex w-(--anchor-width) flex-col overflow-hidden p-0"
				style={{ maxHeight: 288 }}
			>
				<div className="relative shrink-0 border-b border-border p-1.5">
					<Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						// biome-ignore lint/a11y/noAutofocus: 打开浮层的目的就是搜索,不自动聚焦等于多一次点击
						autoFocus
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setHighlight(0);
						}}
						onKeyDown={onInputKeyDown}
						placeholder="搜索…"
						className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-sm outline-none"
					/>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-2.5 pt-1">
					{filtered.length === 0 ? (
						<div className="px-2.5 py-2 text-xs text-muted-foreground">{emptyText}</div>
					) : (
						filtered.map((o, i) => {
							const active = o.value === value;
							const highlighted = i === highlight;
							return (
								<button
									key={o.value}
									type="button"
									role="option"
									aria-selected={active}
									onClick={() => pick(o.value)}
									onMouseEnter={() => setHighlight(i)}
									className={cn(
										"flex w-full items-center gap-1 rounded-lg px-1.5 py-1.5 text-left text-sm text-foreground transition-colors",
										highlighted && "bg-muted",
										active && "font-medium",
									)}
								>
									<span className="flex-1 truncate">{o.label}</span>
									{active && <Check className="size-3.5 shrink-0" />}
								</button>
							);
						})
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
