import { Badge } from "#/components/ui/badge";
import { priorityLabelOf, type TaskPriority } from "#/lib/task-close-spec";
import { cn } from "#/lib/utils";

/**
 * `tc_task` 状态 / 优先级的**展示徽章** —— 两个同构件(描边胶囊 + 一颗圆点 + 灰字)的合流。
 *
 * 造型与颜色语义:
 *  - `label` 由调用方从**模板定义**(`statuses: { value, label }[]` / `priorityLabelOf()`)取 ——
 *    展示一律用 `label`,本文件不维护中文映射表;识别不靠颜色,色相只落在 6px 小圆点上。
 *  - `primary` = 在跑、`warn` = 等你答复(与流程脊的锁定节点同色)、其余走中性;
 *    优先级:P0 玫 / P1 琥 / P2 翠,「未设置」中性。
 */

/** 描边胶囊 + 圆点的共用形状(两个域徽章只差色表) */
function DotBadge({ dot, label, className }: { dot: string; label: string; className?: string }) {
	return (
		<Badge variant="outline" className={cn("gap-1.5 text-muted-foreground", className)}>
			<span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot)} />
			{label}
		</Badge>
	);
}

const STATUS_DOT: Record<string, string> = {
	open: "bg-primary",
	pending: "bg-warn",
	done: "bg-foreground/40",
	closed: "bg-muted-foreground/40",
	archived: "bg-muted-foreground/40",
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
	0: "bg-hue-rose",
	1: "bg-hue-amber",
	2: "bg-hue-emerald",
};

/** `tc_task.status` 徽章 —— `label` 不传就退化成 `status` 原值 */
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
	return (
		<DotBadge dot={STATUS_DOT[status] ?? "bg-muted-foreground/40"} label={label ?? status} className={className} />
	);
}

/** `tc_task.priority` 徽章 —— `priority` 为 null / 未知数字 → 「未设置」,不抛错 */
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
	return (
		<DotBadge
			dot={isKnown !== null ? PRIORITY_DOT[isKnown] : "bg-muted-foreground/40"}
			label={label ?? (isKnown !== null ? priorityLabelOf(priority) : "未设置")}
			className={className}
		/>
	);
}
