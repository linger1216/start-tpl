import { Check, ChevronDown, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { createPortal } from "react-dom";

import { Input } from "#/components/ui/input";
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
 *  - trigger:Button 形式,左图标预览 + 当前图标名 + 清空按钮 + 下拉箭头。
 *  - Popover(浮层):portal 到 body,fixed 定位;顶部搜索框(中文/英文都搜);
 *    主体为常用图标(PINNED_ICONS)+ 全部图标网格(按字母排序)。
 *
 * 定位逻辑(对齐 search-select.tsx):
 *   trigger.getBoundingClientRect() → top/bottom/left 写入 state,
 *   滚动/resize 不重定位(简化:滚动时让用户重新打开)。
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
	const [rect, setRect] = React.useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	const triggerRef = React.useRef<HTMLButtonElement>(null);
	const panelRef = React.useRef<HTMLDivElement>(null);

	function openPanel() {
		const el = triggerRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		setRect({ top: r.bottom, left: r.left, width: r.width });
		setOpen(true);
	}
	const closePanel = React.useCallback(() => {
		setOpen(false);
		setQuery("");
	}, []);

	// 点击外部关闭
	React.useEffect(() => {
		if (!open) return;
		function onDown(e: MouseEvent) {
			const target = e.target as Node;
			if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
				closePanel();
			}
		}
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open, closePanel]);

	// Esc 关闭
	React.useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") closePanel();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, closePanel]);

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
	 * 当前值解析成 PascalCase(库中存 kebab-case,网格中是 PascalCase),
	 * 用于网格选中态比较与搜索词归一。
	 */
	const resolvedCurrent = React.useMemo(() => resolveLucideIconKey(value), [value]);

	function pick(name: string) {
		// 按项目约定(见 icons-list 注释 / sidebar iconMap)持久化 kebab-case 名
		onChange(toKebabCase(name));
		closePanel();
	}

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => (open ? closePanel() : openPanel())}
				className={cn(
					"flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 text-sm",
					"hover:bg-accent/30 transition-colors",
					className,
				)}
				aria-haspopup="listbox"
				aria-expanded={open}
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
				<span className="flex items-center gap-1">
					{value && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onChange(null);
							}}
							className="text-muted-foreground hover:text-danger"
							aria-label="清空图标"
							title="清空图标"
						>
							<X className="size-3.5" />
						</button>
					)}
					<ChevronDown className="size-3.5 text-muted-foreground" />
				</span>
			</button>

			{open && rect
				? createPortal(
						<AnimatePresence>
							<motion.div
								ref={panelRef}
								role="listbox"
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -4 }}
								transition={{ duration: 0.12, ease: "easeOut" }}
								style={{
									position: "fixed",
									top: rect.top + 4,
									left: rect.left,
									width: Math.max(rect.width, 360),
									zIndex: 50,
								}}
								className="rounded-xl border border-border bg-popover shadow-lg"
							>
								<div className="flex flex-col overflow-hidden max-h-[420px]">
									{/* 搜索框(固定区) */}
									<div className="shrink-0 border-b border-border p-2">
										<div className="relative">
											<Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
											<Input
												autoFocus
												value={query}
												onChange={(e) => setQuery(e.target.value)}
												placeholder="搜索图标名 (Users / home / 用户)"
												className="h-8 pl-8 text-xs"
											/>
										</div>
									</div>

									{/* 滚动区 */}
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
							</motion.div>
						</AnimatePresence>,
						document.body,
					)
				: null}
		</>
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
			<div className="mb-2 px-1 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{title}</div>
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
