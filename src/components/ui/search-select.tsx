import { Check, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "#/components/ui/spinner";
import { cn } from "#/lib/utils";

export type SearchSelectOption<T extends string = string> = {
	value: T;
	label: string;
};

/**
 * 过滤引擎(唯一实现):label 必搜,value 可选(matchValue)。
 */
function useOptionSearch<T extends string>(
	options: readonly SearchSelectOption<T>[],
	query: string,
	matchValue: boolean,
): SearchSelectOption<T>[] {
	return useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return options as SearchSelectOption<T>[];
		return options.filter(
			(o) => o.label.toLowerCase().includes(q) || (matchValue && o.value.toLowerCase().includes(q)),
		);
	}, [options, query, matchValue]);
}

/**
 * 带搜索框的可搜索下拉(Combobox)。
 *
 * 定位:浮层用 createPortal 渲染到 <body> + fixed 定位,
 * 坐标来自 trigger 的 getBoundingClientRect()。
 * 这样彻底脱离父级 stacking context / transform / overflow,
 * 不会被表格、sticky 表头或其它祖先裁剪或遮盖。
 *
 * 过滤:label + value 均可匹配(useOptionSearch)。
 */
export function SearchSelect<T extends string = string>({
	value,
	onValueChange,
	options,
	placeholder = "请选择",
	emptyText = "无匹配选项",
	triggerClassName,
	inputClassName,
	listClassName,
	align = "start",
	maxHeight = 288,
	disabled = false,
	loading = false,
}: {
	value: T | undefined;
	onValueChange: (v: T) => void;
	options: SearchSelectOption<T>[];
	placeholder?: string;
	emptyText?: string;
	triggerClassName?: string;
	inputClassName?: string;
	listClassName?: string;
	align?: "start" | "end";
	maxHeight?: number;
	disabled?: boolean;
	loading?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [highlight, setHighlight] = useState(0);
	// trigger 在视口中的位置(fixed 浮层需要)
	const [rect, setRect] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const filtered = useOptionSearch(options, query, true);
	const selected = options.find((o) => o.value === value);

	function openList() {
		const el = triggerRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		setRect({ top: r.bottom, left: r.left, width: r.width });
		setOpen(true);
	}

	const closeList = useCallback(() => {
		setOpen(false);
		setQuery("");
		setHighlight(0);
	}, []);

	function pick(v: T) {
		onValueChange(v);
		closeList();
	}

	// 点击外部关闭
	useEffect(() => {
		if (!open) return;
		function onDocDown(e: MouseEvent) {
			const target = e.target as Node;
			if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) {
				closeList();
			}
		}
		document.addEventListener("mousedown", onDocDown);
		return () => document.removeEventListener("mousedown", onDocDown);
	}, [open, closeList]);

	// 打开时聚焦搜索框
	useEffect(() => {
		if (open) {
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	// 滚动时重新定位,而不是关闭 —— fixed 浮层跟随 trigger 移动即可,
	// 不需要"滚一点就关"。这样选项列表内部滚动、外层 toolbar 滚动、页面滚动都不会误关。
	useEffect(() => {
		if (!open) return;
		function reposition() {
			const el = triggerRef.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			setRect({ top: r.bottom, left: r.left, width: r.width });
		}
		function onResize() {
			// resize 后浮层宽度可能失效,关闭让用户重新触发更稳妥
			closeList();
		}
		window.addEventListener("scroll", reposition, true);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("scroll", reposition, true);
			window.removeEventListener("resize", onResize);
		};
	}, [open, closeList]);

	function onKeyDown(e: React.KeyboardEvent) {
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
		} else if (e.key === "Escape") {
			closeList();
		}
	}

	return (
		<>
			{/* Trigger */}
			<button
				ref={triggerRef}
				type="button"
				onClick={() => {
					if (disabled) return;
					if (open) {
						closeList();
					} else {
						openList();
					}
				}}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-disabled={disabled}
				disabled={disabled}
				className={cn(
					"relative z-60 flex h-8 items-center justify-between gap-2 rounded-xl border border-input bg-card px-3 text-[13px] whitespace-nowrap transition-colors outline-none",
					disabled ? "cursor-not-allowed opacity-50" : "hover:border-foreground/50 hover:text-foreground",
					triggerClassName,
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
			</button>

			{/* 浮层:Portal 到 body, fixed 定位在 trigger 正下方,绝不遮盖 */}
			{typeof document !== "undefined" &&
				createPortal(
					<AnimatePresence>
						{open && rect && (
							<motion.div
								ref={listRef}
								role="listbox"
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -4 }}
								transition={{ duration: 0.12, ease: "easeOut" }}
								style={{
									position: "fixed",
									top: rect.top + 4,
									left: align === "start" ? rect.left : undefined,
									right: align === "end" ? window.innerWidth - rect.left - rect.width : undefined,
									width: rect.width,
									maxHeight, // 上限: 内容少时自适应收缩,内容多时被 overflow-hidden 截断
									zIndex: 9999,
								}}
								className={cn(
									// flex + overflow-hidden:在 maxHeight 处截断,
									// 让 flex-1 的选项区内部滚动而不是把浮层撑爆。
									"flex flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-(--shadow-card)",
									listClassName,
								)}
							>
								{/* 搜索框 */}
								<div className="relative shrink-0 border-b border-border p-1.5">
									<Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
									<input
										ref={inputRef}
										value={query}
										onChange={(e) => {
											setQuery(e.target.value);
											setHighlight(0);
										}}
										onKeyDown={onKeyDown}
										placeholder="搜索…"
										className={cn(
											"h-7 w-full rounded-lg border border-input bg-background pr-2 pl-7 text-[13px] outline-none",
											inputClassName,
										)}
									/>
								</div>

								{/* 选项列表 */}
								<div className="min-h-0 flex-1 overflow-y-auto p-2.5 pt-1">
									{filtered.length === 0 ? (
										<div className="px-2.5 py-2 text-[12.5px] text-muted-foreground">{emptyText}</div>
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
														"flex w-full items-center gap-1 rounded-lg px-1.5 py-1.5 text-left text-[13px] transition-colors",
														highlighted && "bg-muted/60",
														active && "font-medium text-foreground",
														!active && "text-foreground",
													)}
												>
													<span className="flex-1 truncate">{o.label}</span>
													{active && <Check className="size-3.5 shrink-0" />}
												</button>
											);
										})
									)}
								</div>
							</motion.div>
						)}
					</AnimatePresence>,
					document.body,
				)}
		</>
	);
}
