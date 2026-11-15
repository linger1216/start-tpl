import type { ReactNode } from "react";
import { BlockHeader } from "#/components/modules/task-close/block-header";

/** 「结构化填报」区块:虚线标题 + 右侧动作,正文由调用方给。 */
export function ReportSection({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
	return (
		<section className="grid gap-3 pt-6">
			<BlockHeader title="结构化填报" actions={actions} dashed />
			{children}
		</section>
	);
}
