import { startOfMonth, startOfYear, subDays } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Button, buttonVariants } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { formatLocalDate } from "#/lib/time";
import { cn } from "#/lib/utils";

export interface DateRangeValue {
	from?: string; // yyyy-MM-dd
	to?: string; // yyyy-MM-dd
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
 * 日期范围选择器(开始 + 结束 在一个控件内,日历「日期视角」)。
 *
 * - 年份切换:交给 `Calendar` 的默认导航条(上一年 / 上一月 / 下一月 / 下一年)+「年 + 月」下拉,
 *   本组件不自己实现 —— 单月日历与区间选择器共用同一份,风格才一致。
 * - 快捷范围:左侧预设列(今天 / 近7天 / 近30天 / 本月 / 本年),点击即回填。
 *
 * 浮层与单日期选择器共用 Popover,处理定位、焦点和关闭。
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
	const selected = value.from || value.to ? { from: parse(value.from), to: parse(value.to) } : undefined;

	// 只用于「默认展示哪个月」;下拉可选年份范围由 Calendar 的默认值给(见 calendar.tsx)
	const now = new Date();

	function applyPreset(get: () => { from: Date; to: Date }) {
		const { from, to } = get();
		onChange({ from: formatLocalDate(from), to: formatLocalDate(to) });
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				className={cn(
					buttonVariants({ variant: "outline" }),
					"h-9 w-64 justify-start text-left font-normal",
					className,
				)}
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
			</PopoverTrigger>

			<PopoverContent align="start" className="flex w-max max-w-screen gap-2 overflow-x-auto border bg-card p-2">
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
					{/*
					 * 这里**不再重复传** locale / captionLayout / startMonth / endMonth /
					 * Nav / classNames —— 全部是 `Calendar` 的默认值(四箭头年月导航、中文、
					 * 年+月下拉)。风格统一靠"只留一份默认值"实现:哪天要调日历长相,
					 * 改 calendar.tsx 一处,单月日历与区间选择器一起变。
					 */}
					<Calendar
						mode="range"
						numberOfMonths={2}
						selected={selected}
						defaultMonth={selected?.from ?? startOfMonth(now)}
						onSelect={(range) => {
							onChange({
								from: range?.from ? formatLocalDate(range.from) : undefined,
								to: range?.to ? formatLocalDate(range.to) : undefined,
							});
							// 选完结束日期(完整区间)后自动收起浮层。
							// 注意:react-day-picker 在 range 模式下单击即生成 {from,to}
							// 同日的单日区间(min 默认 0),若仅判断 from&&to 会在「点一次」时
							// 就关闭。必须起止为不同日(即第二次点击)才关闭,保证选 2 次才收起。
							if (range?.from && range?.to && range.from.getTime() !== range.to.getTime()) {
								setOpen(false);
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
								setOpen(false);
							}}
						>
							清除
						</Button>
						<Button type="button" size="sm" onClick={() => setOpen(false)}>
							确定
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
