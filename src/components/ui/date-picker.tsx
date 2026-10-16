import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Calendar } from "#/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { formatLocalDate } from "#/lib/time";
import { cn } from "#/lib/utils";

/**
 * 单日期选择器 —— 点触发器直接弹出「单月日历」,粒度只到**天**,没有时分秒。
 *
 * 值统一是本地 `YYYY-MM-DD` 字符串(空串 = 未选),**不做时区换算** —— 落库时由调用方
 * 把它当"本地这一天的 0 点"处理(见 `TaskCloseForm` 的 `fromDateInput`)。
 *
 * 触发器外观与 `Input` / `SearchSelect` 对齐(`h-8` / `rounded-xl` / `border-input`),
 * 同一张表单里几个字段才长得一样。浮层走 Base UI 的 Popover 原语(与 `SearchSelect` 同款)——
 * **在 Dialog 里可用**(search-select 已在多处弹窗里验证过)。
 */
export function DatePicker({
	value,
	onChange,
	placeholder = "选择日期",
	id,
	className,
}: {
	/** 本地 `YYYY-MM-DD`;空串 = 未选 */
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	id?: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	// `YYYY-MM-DDT00:00:00` 按**本地**时区解析(直接 new Date("YYYY-MM-DD") 会当 UTC,差一天)
	const selected = value ? new Date(`${value}T00:00:00`) : undefined;

	function pick(date: Date | undefined) {
		onChange(date ? formatLocalDate(date) : "");
		setOpen(false);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				id={id}
				className={cn(
					"flex h-8 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 hover:border-border-strong text-sm whitespace-nowrap transition-colors outline-none",
					"hover:border-ring/60",
					className,
				)}
			>
				<span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
				<CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-3">
				<Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={pick} />
				<div className="mt-2 flex justify-end gap-3 border-t border-border pt-2 text-xs">
					<button
						type="button"
						className="text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => pick(new Date())}
					>
						今天
					</button>
					{value ? (
						<button
							type="button"
							className="text-muted-foreground transition-colors hover:text-foreground"
							onClick={() => pick(undefined)}
						>
							清除
						</button>
					) : null}
				</div>
			</PopoverContent>
		</Popover>
	);
}
