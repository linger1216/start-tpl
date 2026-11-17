/**
 * 日期选择器触发器的长相 —— **全站一份**。
 *
 * 单日期(`ui/date-picker`)与日期区间(`ui/date-range-picker`)共用同一段 class,
 * 两个控件才长得像同一个东西;也跟 `ui/input` 对齐:白底(`bg-card`)、细边(`border-input`)、
 * `h-8`、键盘聚焦有落点(`focus-visible` 环 —— 触发器不能吃掉默认焦点环)。
 */
export const DATE_TRIGGER_CLASS =
	"flex h-8 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm whitespace-nowrap transition-colors outline-none hover:border-border-strong focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-primary/20";
