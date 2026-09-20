import { addYears, startOfMonth, startOfYear, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
	CalendarIcon,
	ChevronLeft as ChevronLeftIcon,
	ChevronRight as ChevronRightIcon,
	ChevronsLeft as ChevronsLeftIcon,
	ChevronsRight as ChevronsRightIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDayPicker } from "react-day-picker";
import { createPortal } from "react-dom";
import { Button, buttonVariants } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import { cn } from "#/lib/utils";

export interface DateRangeValue {
	from?: string; // yyyy-MM-dd
	to?: string; // yyyy-MM-dd
}

function toISO(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function parse(s?: string): Date | undefined {
	if (!s) return undefined;
	const d = new Date(`${s}T00:00:00`);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

/** 快捷范围:社区常见预设(今天 / 近7天 / 近30天 / 本月 / 本年) */
const PRESETS: { label: string; get: () => { from: Date; to: Date } }[] = [
	{
		label: "今天",
		get: () => {
			const t = new Date();
			return { from: t, to: t };
		},
	},
	{
		label: "近 7 天",
		get: () => {
			const t = new Date();
			return { from: subDays(t, 6), to: t };
		},
	},
	{
		label: "近 30 天",
		get: () => {
			const t = new Date();
			return { from: subDays(t, 29), to: t };
		},
	},
	{
		label: "本月",
		get: () => {
			const t = new Date();
			return { from: startOfMonth(t), to: t };
		},
	},
	{
		label: "本年",
		get: () => {
			const t = new Date();
			return { from: startOfYear(t), to: t };
		},
	},
];

/**
 * 自定义导航条:在「上一月 / 下一月」箭头两侧,再各加一个「上一年 / 下一年」按钮
 * (Chevrons 双箭头),满足一次性切换一整年的诉求。基于 react-day-picker 的
 * useDayPicker() 上下文调用 goToMonth 实现,复用日历既有的 ghost 按钮样式。
 */
function RangeYearNav({ className }: { className?: string }) {
	const { goToMonth, months, previousMonth, nextMonth, dayPickerProps } = useDayPicker();
	const base = months[0]?.date ?? new Date();
	const startMonth = dayPickerProps.startMonth;
	const endMonth = dayPickerProps.endMonth;
	const prevYear = startOfMonth(addYears(base, -1));
	const nextYear = startOfMonth(addYears(base, 1));
	const prevYearDisabled = startMonth ? prevYear < startMonth : false;
	const nextYearDisabled = endMonth ? nextYear > endMonth : false;

	// 按钮用 size-5(20px)而非 cell-size(28px):4 个导航按钮 + 2 个下拉标题需共处于
	// 一个约 196px 的月份行内,缩小按钮可腾出空间避免「月/年」下拉标题被挤到换行。
	const btn = "size-5 p-0 disabled:pointer-events-none disabled:opacity-50";

	return (
		<div
			className={cn(
				"absolute inset-x-0 top-0 flex h-(--cell-size) w-full items-center justify-between gap-0.5",
				className,
			)}
		>
			<div className="flex h-full items-center gap-0.5">
				<button
					type="button"
					aria-label="上一年"
					disabled={prevYearDisabled}
					onClick={() => goToMonth(prevYear)}
					className={cn(buttonVariants({ variant: "ghost" }), btn)}
				>
					<ChevronsLeftIcon className="size-4" />
				</button>
				<button
					type="button"
					aria-label="上一月"
					disabled={!previousMonth}
					onClick={() => previousMonth && goToMonth(previousMonth)}
					className={cn(buttonVariants({ variant: "ghost" }), btn)}
				>
					<ChevronLeftIcon className="size-4" />
				</button>
			</div>
			<div className="flex h-full items-center gap-0.5">
				<button
					type="button"
					aria-label="下一月"
					disabled={!nextMonth}
					onClick={() => nextMonth && goToMonth(nextMonth)}
					className={cn(buttonVariants({ variant: "ghost" }), btn)}
				>
					<ChevronRightIcon className="size-4" />
				</button>
				<button
					type="button"
					aria-label="下一年"
					disabled={nextYearDisabled}
					onClick={() => goToMonth(nextYear)}
					className={cn(buttonVariants({ variant: "ghost" }), btn)}
				>
					<ChevronsRightIcon className="size-4" />
				</button>
			</div>
		</div>
	);
}

/**
 * 日期范围选择器(开始 + 结束 在一个控件内,日历「日期视角」)。
 *
 * - 年份切换:react-day-picker 原生 `captionLayout="dropdown-buttons"` + `startMonth`/`endMonth`
 *   实现「年 + 月」下拉导航(社区最佳实践,无需额外依赖)。
 * - 快捷范围:左侧预设列(今天 / 近7天 / 近30天 / 本月 / 本年),点击即回填。
 *
 * 浮层用 createPortal 渲染到 <body> + fixed 定位,坐标来自 trigger 的
 * getBoundingClientRect(),彻底脱离父级 overflow/stacking context,避免被卡片或
 * 表格裁剪、遮盖(此前 absolute 定位会被祖先 overflow-hidden 遮住)。
 */
export function DateRangePicker({
	value,
	onChange,
	placeholder = "选择时间范围",
	className,
}: {
	value: DateRangeValue;
	onChange: (v: DateRangeValue) => void;
	placeholder?: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [rect, setRect] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popRef = useRef<HTMLDivElement>(null);

	function openList() {
		const el = triggerRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		setRect({ top: r.bottom, left: r.left, width: r.width });
		setOpen(true);
	}
	function closeList() {
		setOpen(false);
	}

	useEffect(() => {
		if (!open) return;
		function onDoc(e: MouseEvent) {
			const t = e.target as Node;
			if (!triggerRef.current?.contains(t) && !popRef.current?.contains(t)) {
				closeList();
			}
		}
		document.addEventListener("mousedown", onDoc);
		return () => document.removeEventListener("mousedown", onDoc);
	}, [open]);

	// 滚动/缩放时跟随 trigger 重新定位,而不是关闭
	useEffect(() => {
		if (!open) return;
		function reposition() {
			const el = triggerRef.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			setRect({ top: r.bottom, left: r.left, width: r.width });
		}
		function onResize() {
			closeList();
		}
		window.addEventListener("scroll", reposition, true);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("scroll", reposition, true);
			window.removeEventListener("resize", onResize);
		};
	}, [open]);

	const selected = value.from || value.to ? { from: parse(value.from), to: parse(value.to) } : undefined;

	// 下拉年份范围:当前年前后各留余量,覆盖历史诉件数据
	const now = new Date();
	const startMonth = new Date(now.getFullYear() - 10, 0, 1);
	const endMonth = new Date(now.getFullYear() + 1, 11, 31);

	function applyPreset(get: () => { from: Date; to: Date }) {
		const { from, to } = get();
		onChange({ from: toISO(from), to: toISO(to) });
	}

	return (
		<>
			<Button
				ref={triggerRef}
				type="button"
				variant="outline"
				onClick={() => (open ? closeList() : openList())}
				className={cn("h-9 w-64 justify-start text-left font-normal", className)}
			>
				<CalendarIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
				{value.from ? (
					<span className="truncate">
						{value.from}
						<span className="text-muted-foreground"> ~ </span>
						{value.to ?? "…"}
					</span>
				) : (
					<span className="text-muted-foreground">{placeholder}</span>
				)}
			</Button>

			{typeof document !== "undefined" &&
				createPortal(
					open && rect && (
						<div
							ref={popRef}
							style={{
								position: "fixed",
								top: rect.top + 4,
								left: rect.left,
								zIndex: 9999,
							}}
							className="flex gap-2 rounded-lg border bg-card p-2 shadow-(--shadow-card)"
						>
							{/* 左侧快捷范围 */}
							<div className="flex w-24 shrink-0 flex-col gap-1 border-r pr-2">
								{PRESETS.map((p) => (
									<Button
										key={p.label}
										type="button"
										variant="ghost"
										size="sm"
										className="justify-start"
										onClick={() => applyPreset(p.get)}
									>
										{p.label}
									</Button>
								))}
							</div>

							{/* 右侧日历 + 操作 */}
							<div className="flex flex-col">
								<Calendar
									mode="range"
									numberOfMonths={2}
									captionLayout="dropdown"
									startMonth={startMonth}
									endMonth={endMonth}
									locale={zhCN}
									selected={selected}
									defaultMonth={selected?.from ?? startOfMonth(now)}
									components={{ Nav: RangeYearNav }}
									classNames={{
										// 导航按钮缩为 size-5(20px):左右各 2 个 + 间距 ≈ 42px,
										// 故内边距用 *1.6(≈45px)清出按钮区,中部留给「月/年」下拉,
										// 避免标题因空间不足换行(之前 *2 把中部挤到 < 下拉所需宽度)。
										month_caption:
											"flex h-(--cell-size) w-full items-center justify-center px-[calc(var(--cell-size)*1.6)]",
										// 两个下拉标题不收缩,杜绝被挤成换行/截断
										dropdowns:
											"flex h-(--cell-size) w-full flex-nowrap items-center justify-center gap-1 whitespace-nowrap text-sm font-medium [&>*]:shrink-0",
									}}
									onSelect={(range) => {
										onChange({
											from: range?.from ? toISO(range.from) : undefined,
											to: range?.to ? toISO(range.to) : undefined,
										});
										// 选完结束日期(完整区间)后自动收起浮层。
										// 注意:react-day-picker 在 range 模式下单击即生成 {from,to}
										// 同日的单日区间(min 默认 0),若仅判断 from&&to 会在「点一次」时
										// 就关闭。必须起止为不同日(即第二次点击)才关闭,保证选 2 次才收起。
										if (range?.from && range?.to && range.from.getTime() !== range.to.getTime()) {
											closeList();
										}
									}}
								/>
								<div className="mt-2 flex justify-end gap-2">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => {
											onChange({});
											closeList();
										}}
									>
										清除
									</Button>
									<Button type="button" size="sm" onClick={closeList}>
										确定
									</Button>
								</div>
							</div>
						</div>
					),
					document.body,
				)}
		</>
	);
}
