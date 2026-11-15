import type { ReactNode } from "react";
import { BlockHeader } from "#/components/modules/task-close/block-header";

/** 区块标题 + 右侧动作;标题默认「结构化填报」,可换(如父任务详情里的「母版」)。 */
export function ReportSection({
	actions,
	children,
	title = "结构化填报",
}: {
	actions?: ReactNode;
	children: ReactNode;
	title?: string;
}) {
	return (
		<section className="grid gap-3 pt-6">
			<BlockHeader title={title} actions={actions} dashed />
			{children}
		</section>
	);
}
