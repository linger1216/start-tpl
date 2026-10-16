import { addYears, startOfMonth } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react";
import * as React from "react";
import { type DayButton, DayPicker, getDefaultClassNames, type Locale, useDayPicker } from "react-day-picker";
import { Button, buttonVariants } from "#/components/ui/button";
import { cn } from "#/lib/utils";

/**
 * 月份导航条 —— 全项目**唯一**一份(单月日历与日期区间选择器共用同一个,风格才不会各走各的)。
 *
 * 在「上一月 / 下一月」两侧各加一个「上一年 / 下一年」(双箭头):一次跳一年是台账类页面的高频诉求。
 * 按钮用 `size-5`(20px)而不是 `--cell-size`(28px):一行里要并排放 4 个导航按钮 + 2 个下拉标题,
 * 缩小按钮才腾得出中部空间,否则「月 / 年」下拉会被挤到换行。
 */
export function CalendarNav({ className }: { className?: string }) {
	const { goToMonth, months, previousMonth, nextMonth, dayPickerProps } = useDayPicker();
	const base = months[0]?.date ?? new Date();
	const { startMonth, endMonth } = dayPickerProps;
	const prevYear = startOfMonth(addYears(base, -1));
	const nextYear = startOfMonth(addYears(base, 1));
	const prevYearDisabled = startMonth ? prevYear < startMonth : false;
	const nextYearDisabled = endMonth ? nextYear > endMonth : false;

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

/** 下拉年份的默认范围:往前 10 年、往后 1 年(台账数据的历史余量) */
function defaultMonthBounds() {
	const now = new Date();
	return {
		startMonth: new Date(now.getFullYear() - 10, 0, 1),
		endMonth: new Date(now.getFullYear() + 1, 11, 31),
	};
}

function Calendar({
	className,
	classNames,
	showOutsideDays = true,
	/**
	 * 默认与「日期区间选择器」保持一致:下拉式「年 + 月」标题 + 中文 + 四箭头导航。
	 * 之前默认是 `label`(纯英文月份、只有两个箭头),和区间选择器里那张日历判若两人 ——
	 * 同一天在页面上出现两种长相,是纯噪音。要单月标题的调用方显式传 `captionLayout="label"` 覆盖。
	 */
	captionLayout = "dropdown",
	buttonVariant = "ghost",
	locale = zhCN,
	formatters,
	components,
	startMonth,
	endMonth,
	...props
}: React.ComponentProps<typeof DayPicker> & {
	buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
	const defaultClassNames = getDefaultClassNames();
	const bounds = defaultMonthBounds();

	return (
		<DayPicker
			showOutsideDays={showOutsideDays}
			className={cn(
				"bg-background p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
				className,
			)}
			captionLayout={captionLayout}
			locale={locale}
			startMonth={startMonth ?? bounds.startMonth}
			endMonth={endMonth ?? bounds.endMonth}
			formatters={{
				formatMonthDropdown: (date) => date.toLocaleString(locale?.code, { month: "short" }),
				...formatters,
			}}
			classNames={{
				root: cn("w-fit", defaultClassNames.root),
				months: cn("relative flex flex-col gap-4 md:flex-row", defaultClassNames.months),
				month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
				nav: cn("absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1", defaultClassNames.nav),
				button_previous: cn(
					buttonVariants({ variant: buttonVariant }),
					"size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
					defaultClassNames.button_previous,
				),
				button_next: cn(
					buttonVariants({ variant: buttonVariant }),
					"size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
					defaultClassNames.button_next,
				),
				month_caption: cn(
					// 两侧各留 ≈1.6 个单元格:清出 4 个导航按钮的位置,中部留给「月 / 年」下拉
					"flex h-(--cell-size) w-full items-center justify-center px-11",
					defaultClassNames.month_caption,
				),
				dropdowns: cn(
					"flex h-(--cell-size) w-full flex-nowrap items-center justify-center gap-1 whitespace-nowrap text-sm font-medium [&>*]:shrink-0",
					defaultClassNames.dropdowns,
				),
				dropdown_root: cn("relative min-w-0 rounded-(--cell-radius)", defaultClassNames.dropdown_root),
				dropdown: cn("absolute inset-0 bg-popover opacity-0", defaultClassNames.dropdown),
				caption_label: cn(
					"font-medium select-none whitespace-nowrap",
					captionLayout === "label"
						? "text-sm"
						: "flex items-center gap-1 rounded-(--cell-radius) text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
					defaultClassNames.caption_label,
				),
				month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
				weekdays: cn("flex", defaultClassNames.weekdays),
				weekday: cn(
					"flex-1 rounded-(--cell-radius) text-xs font-normal text-muted-foreground select-none",
					defaultClassNames.weekday,
				),
				week: cn("mt-2 flex w-full", defaultClassNames.week),
				week_number_header: cn("w-(--cell-size) select-none", defaultClassNames.week_number_header),
				week_number: cn("text-xs text-muted-foreground select-none", defaultClassNames.week_number),
				day: cn(
					"relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
					props.showWeekNumber
						? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)"
						: "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
					defaultClassNames.day,
				),
				range_start: cn(
					"relative isolate z-0 rounded-l-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-muted",
					defaultClassNames.range_start,
				),
				range_middle: cn("rounded-none", defaultClassNames.range_middle),
				range_end: cn(
					"relative isolate z-0 rounded-r-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-muted",
					defaultClassNames.range_end,
				),
				today: cn(
					"rounded-(--cell-radius) bg-muted text-foreground data-[selected=true]:rounded-none",
					defaultClassNames.today,
				),
				outside: cn("text-muted-foreground aria-selected:text-muted-foreground", defaultClassNames.outside),
				disabled: cn("text-muted-foreground opacity-50", defaultClassNames.disabled),
				hidden: cn("invisible", defaultClassNames.hidden),
				...classNames,
			}}
			components={{
				// 默认就是共用导航条(年 / 月四箭头);调用方可整体覆盖
				Nav: CalendarNav,
				Root: ({ className, rootRef, ...props }) => {
					return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
				},
				Chevron: ({ className, orientation, ...props }) => {
					if (orientation === "left") {
						return <ChevronLeftIcon className={cn("size-4", className)} {...props} />;
					}

					if (orientation === "right") {
						return <ChevronRightIcon className={cn("size-4", className)} {...props} />;
					}

					return <ChevronDownIcon className={cn("size-4", className)} {...props} />;
				},
				DayButton: ({ ...props }) => <CalendarDayButton locale={locale} {...props} />,
				WeekNumber: ({ children, ...props }) => {
					return (
						<td {...props}>
							<div className="flex size-(--cell-size) items-center justify-center text-center">{children}</div>
						</td>
					);
				},
				...components,
			}}
			{...props}
		/>
	);
}

function CalendarDayButton({
	className,
	day,
	modifiers,
	locale,
	...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
	const defaultClassNames = getDefaultClassNames();

	const ref = React.useRef<HTMLButtonElement>(null);
	React.useEffect(() => {
		if (modifiers.focused) ref.current?.focus();
	}, [modifiers.focused]);

	return (
		<Button
			variant="ghost"
			size="icon"
			data-day={day.date.toLocaleDateString(locale?.code)}
			data-selected-single={
				modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle
			}
			data-range-start={modifiers.range_start}
			data-range-end={modifiers.range_end}
			data-range-middle={modifiers.range_middle}
			className={cn(
				"relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-1 group-data-[focused=true]/day:ring-ring/30 data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-foreground [&>span]:text-xs [&>span]:opacity-70",
				defaultClassNames.day,
				className,
			)}
			{...props}
		/>
	);
}

export { Calendar, CalendarDayButton };
