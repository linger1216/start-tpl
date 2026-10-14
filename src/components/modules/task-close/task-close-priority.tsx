import { Badge } from "#/components/ui/badge";
import { priorityLabelOf, type TaskPriority } from "#/lib/task-close-spec";
import { cn } from "#/lib/utils";

/**
 * `tc_task.priority` 的展示 —— 三档 + 「未设置」。
 *
 * 色板遵循项目已有的 hue-* 软色调:
 *   P0(0 · 最高) → hue-rose(危机红)
 *   P1(1 · 高)   → hue-amber(琥珀)
 *   P2(2 · 普通) → hue-emerald(绿)
 *
 * 「未设置」走中性灰,与 StatusBadge 的 closed/archived 同形 —— **不靠颜色表意**,
 * 文字 label 一律在徽章里再确认。
 */
const PRIORITY_TONE: Record<TaskPriority, string> = {
	0: "border-transparent bg-hue-rose-soft text-hue-rose-fg",
	1: "border-transparent bg-hue-amber-soft text-hue-amber-fg",
	2: "border-transparent bg-hue-emerald-soft text-hue-emerald-fg",
};

const NONE_TONE = "border-transparent bg-muted text-muted-foreground";

/**
 * 优先级徽章 —— `priority` 为 null / 未知数字 → 「未设置」徽章,不抛错。
 *
 * `label` 通常由调用方从 `priorityLabelOf()` 取(数字 → "P0 · 最高" 等),
 * 也可自定义覆盖。
 */
export function PriorityBadge({
	priority,
	label,
	className,
}: {
	priority: number | null | undefined;
	label?: string;
	className?: string;
}) {
	const isKnown = priority === 0 || priority === 1 || priority === 2 ? (priority as TaskPriority) : null;
	const tone = isKnown !== null ? PRIORITY_TONE[isKnown] : NONE_TONE;
	const text = label ?? (isKnown !== null ? priorityLabelOf(priority) : "未设置");
	return (
		<Badge variant="outline" className={cn(tone, className)}>
			{text}
		</Badge>
	);
}
