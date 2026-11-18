import { ArrowRight } from "lucide-react";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import type { WorkflowEdgeInput } from "#/components/modules/task-close/task-workflow-form";
import { TaskWorkflowGraph } from "#/components/modules/task-close/task-workflow-graph";
import { DetailRow } from "#/components/ui/detail-row";
import { Tag } from "#/components/ui/tag";
import { TagList } from "#/components/ui/tag-list";
import { roleLabelOf, statusLabelOf, VIA_LABEL, type WorkflowStatus } from "#/lib/task/close-spec";

/** 流程模板列表的详情投影。 */
type WorkflowDetail = {
	id: string;
	name: string;
	statuses: WorkflowStatus[];
	initial: string;
	edges: WorkflowEdgeInput[];
	builtin: boolean;
	createdAt: string | null;
	updatedAt: string | null;
};

/**
 * 流程模板详情 —— 只读弹窗:状态集合 / 初始态 / 转移边一览。
 *
 * 数据来自流程模板列表，`meta` 走 `DetailDialog` 底部的创建 / 更新时间。
 */
export function TaskWorkflowDetail({
	open,
	onOpenChange,
	detail,
	onEdit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	detail: WorkflowDetail | null;
	/** 给了就在底部渲染「编辑」主操作 */
	onEdit?: () => void;
}) {
	return (
		<DetailDialog
			open={open}
			onOpenChange={onOpenChange}
			title={detail?.name ?? "流程模板"}
			tag={detail?.builtin ? <Tag variant="secondary">内置</Tag> : undefined}
			onEdit={onEdit}
			meta={detail ? { id: detail.id, createdAt: detail.createdAt, updatedAt: detail.updatedAt } : null}
		>
			{!detail ? (
				<p className="py-6 text-center text-sm text-muted-foreground">流程模板不存在。</p>
			) : (
				<>
					<div className="space-y-2">
						<h3 className="text-sm font-medium">状态图</h3>
						<TaskWorkflowGraph statuses={detail.statuses} initial={detail.initial} edges={detail.edges} />
					</div>
					<DetailRow label="状态">
						<TagList
							values={detail.statuses.map((status) => (status.terminal ? `${status.label}（结束）` : status.label))}
							layout="wrap"
							color="random"
						/>
					</DetailRow>
					<DetailRow label="初始态">
						<TagList
							values={detail.statuses
								.filter((status) => status.value === detail.initial)
								.map((status) => (status.terminal ? `${status.label}（结束）` : status.label))}
							layout="wrap"
							color="random"
						/>
					</DetailRow>
					<DetailRow label="转移边">
						{detail.edges.length === 0 ? (
							<span className="text-muted-foreground">没有转移边。</span>
						) : (
							<div className="max-w-full overflow-x-auto rounded-md border border-border">
								<ul className="min-w-full w-max divide-y divide-border">
									{detail.edges.map((edge) => (
										<li
											key={`${edge.from}-${edge.to}-${edge.via}`}
											className="flex items-center gap-3 whitespace-nowrap px-3 py-2.5"
										>
											<div className="flex items-center gap-2">
												<Tag variant="outline" className="bg-muted/50">
													{statusLabelOf(detail.statuses, edge.from)}
												</Tag>
												<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
												<Tag variant="outline" className="bg-muted/50">
													{statusLabelOf(detail.statuses, edge.to)}
												</Tag>
											</div>
											<div className="flex items-center gap-2 text-xs text-muted-foreground">
												<span className="font-medium text-foreground">{VIA_LABEL[edge.via] ?? edge.via}</span>
												<span aria-hidden>·</span>
												<span>{edge.who.map((who) => roleLabelOf(who)).join(" / ")} 可发起</span>
											</div>
										</li>
									))}
								</ul>
							</div>
						)}
					</DetailRow>
				</>
			)}
		</DetailDialog>
	);
}
