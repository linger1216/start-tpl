import { Badge } from "#/components/ui/badge";
import { priorityLabelOf, type TaskPriority } from "#/lib/task-close-spec";
import { cn } from "#/lib/utils";

/**
 * `tc_task.priority` 的展示 —— 三档 + 「未设置」。
 *
 * 造型与 `StatusBadge` 同构:中性描边胶囊 + 一颗**优先级圆点**。
 * 色相沿用项目已有的 hue-*(P0 玫 / P1 琥 / P2 翠),但只落在 6px 的小圆点上 ——
 * 「未设置」走中性,文字 label 一律在徽章里再确认,不靠颜色表意。
 */
const PRIORITY_DOT: Record<TaskPriority, string> = {
	0: "bg-hue-rose",
	1: "bg-hue-amber",
	2: "bg-hue-emerald",
};

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
	const dot = isKnown !== null ? PRIORITY_DOT[isKnown] : "bg-muted-foreground/40";
	const text = label ?? (isKnown !== null ? priorityLabelOf(priority) : "未设置");
	return (
		<Badge variant="outline" className={cn("gap-1.5 text-muted-foreground", className)}>
			<span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot)} />
			{text}
		</Badge>
	);
}
