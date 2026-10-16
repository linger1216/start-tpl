import { ArrowRight } from "lucide-react";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import type { WorkflowEdgeInput } from "#/components/modules/task-close/task-close-workflow-form";
import { DetailRow } from "#/components/ui/detail-row";
import { Tag } from "#/components/ui/tag";
import { TagList } from "#/components/ui/tag-list";
import { statusLabelOf, type WorkflowStatus } from "#/lib/task-close-spec";

/** `workflowGet` 的返回形状(详情弹窗的数据源) */
export type WorkflowDetail = {
	id: string;
	name: string;
	statuses: WorkflowStatus[];
	initial: string;
	edges: WorkflowEdgeInput[];
	builtin: boolean;
	createdAt: string | null;
	updatedAt: string | null;
};

const WHO_TEXT: Record<string, string> = {
	creator: "创建者",
	participant: "参与者",
	executor: "执行者",
	any: "任意",
};

const VIA_TEXT: Record<string, string> = { direct: "直接改", action: "审批动作" };

/**
 * 流程模板详情 —— 只读弹窗:状态集合 / 初始态 / 转移边一览。
 *
 * 数据来自 `workflowGet`(点「详情」时才拉),`meta` 走 `DetailDialog` 底部的创建 / 更新时间。
 */
export function TaskCloseWorkflowDetail({
	open,
	onOpenChange,
	detail,
	isPending,
	onEdit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	detail: WorkflowDetail | null;
	isPending: boolean;
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
			{isPending || !detail ? (
				<p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
			) : (
				<>
					<DetailRow label="状态">
						<TagList values={detail.statuses.map((status) => status.label)} layout="wrap" color="stable" />
					</DetailRow>
					<DetailRow label="初始态">{statusLabelOf(detail.statuses, detail.initial)}</DetailRow>
					<DetailRow label="转移边">
						{detail.edges.length === 0 ? (
							<span className="text-muted-foreground">没有转移边。</span>
						) : (
							<ul className="space-y-1.5">
								{detail.edges.map((edge) => (
									<li
										// 边没有 id;`from->to->via` 在一份模板里唯一(服务端会拒重复边),足够当 key
										key={`${edge.from}-${edge.to}-${edge.via}`}
										className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
									>
										<span className="font-medium">{statusLabelOf(detail.statuses, edge.from)}</span>
										<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
										{/* 审批边会先经系统锁态 `pending` —— 把它画出来;有声明就显示它的 label */}
										{edge.via === "action" ? (
											<>
												<Tag variant="outline" className="border-dashed text-muted-foreground">
													{statusLabelOf(detail.statuses, "pending")}
												</Tag>
												<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
											</>
										) : null}
										<span className="font-medium">{statusLabelOf(detail.statuses, edge.to)}</span>
										<Tag variant="outline">{VIA_TEXT[edge.via] ?? edge.via}</Tag>
										<span className="text-xs text-muted-foreground">
											{edge.who.map((who) => WHO_TEXT[who] ?? who).join(" / ")} 可发起
										</span>
									</li>
								))}
							</ul>
						)}
					</DetailRow>
				</>
			)}
		</DetailDialog>
	);
}
