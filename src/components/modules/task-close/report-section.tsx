import type { ReactNode } from "react";
import { BlockHeader } from "#/components/modules/task-close/block-header";

/** 区块标题 + 右侧动作;标题默认「结构化填报」,可换(如父任务详情里的「母版」)。 */
export function ReportSection({
	actions,
	children,
	compact = false,
	title = "结构化填报",
}: {
	actions?: ReactNode;
	children: ReactNode;
	/** 紧凑版用于任务详情内的可编辑填报区。 */
	compact?: boolean;
	title?: string;
}) {
	return (
		<section className={compact ? "grid gap-2 pt-4" : "grid gap-3 pt-6"}>
			<BlockHeader title={title} actions={actions} dashed />
			{children}
		</section>
	);
}
