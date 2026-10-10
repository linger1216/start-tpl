import { Badge } from "#/components/ui/badge";
import { cn } from "#/lib/utils";

/**
 * `tc_task.status` 的**展示**。
 *
 * 状态名由**模板**定义(`statuses: { value, label }[]`)—— 展示一律用 `label`(取不到回退 `value`),
 * 本文件**不再维护任何中文映射表**。这里只留"按 `value` 上色"这一层软映射(认不出的走中性色)。
 */
const STATUS_TONE: Record<string, string> = {
	open: "border-transparent bg-hue-blue-soft text-hue-blue-fg",
	pending: "border-transparent bg-hue-amber-soft text-hue-amber-fg",
	done: "border-transparent bg-hue-violet-soft text-hue-violet-fg",
	closed: "border-transparent bg-muted text-muted-foreground",
	archived: "border-transparent bg-muted text-muted-foreground",
};

/**
 * 状态徽章 —— `label` 由调用方从模板状态清单里取(`statusLabelOf(task.workflow.statuses, status)`);
 * 不传就退化成 `status` 原值。
 */
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
	return (
		<Badge variant="outline" className={cn(STATUS_TONE[status] ?? "text-muted-foreground", className)}>
			{label ?? status}
		</Badge>
	);
}

/** `tc_action.status` 的中文名(动作自身状态,与模板状态无关) */
export const actionStatusText = (status: string) =>
	({ active: "待答复", queued: "排队中", done: "已通过", rejected: "已驳回" })[status] ?? status;
