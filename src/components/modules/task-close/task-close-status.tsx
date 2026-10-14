import { Badge } from "#/components/ui/badge";
import { cn } from "#/lib/utils";

/**
 * `tc_task.status` 的**展示**。
 *
 * 状态名由**模板**定义(`statuses: { value, label }[]`)—— 展示一律用 `label`(取不到回退 `value`),
 * 本文件**不再维护任何中文映射表**。
 *
 * 造型:中性描边胶囊 + 一颗**状态圆点**(不再是整块软色底)。
 * 颜色只做辅助 —— 文字 label 永远在,识别不靠色相;色相也只在三种含义上各用一次:
 * `primary` = 在跑、`warn` = 等你答复(与流程脊的锁定节点同色)、其余走中性。
 */
const STATUS_DOT: Record<string, string> = {
	open: "bg-primary",
	pending: "bg-warn",
	done: "bg-foreground/40",
	closed: "bg-muted-foreground/40",
	archived: "bg-muted-foreground/40",
};

/**
 * 状态徽章 —— `label` 由调用方从模板状态清单里取(`statusLabelOf(task.workflow.statuses, status)`);
 * 不传就退化成 `status` 原值。
 */
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
	return (
		<Badge variant="outline" className={cn("gap-1.5 text-muted-foreground", className)}>
			<span
				aria-hidden
				className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[status] ?? "bg-muted-foreground/40")}
			/>
			{label ?? status}
		</Badge>
	);
}

/** `tc_action.status` 的中文名(动作自身状态,与模板状态无关) */
export const actionStatusText = (status: string) =>
	({ active: "待答复", queued: "排队中", done: "已通过", rejected: "已驳回" })[status] ?? status;
