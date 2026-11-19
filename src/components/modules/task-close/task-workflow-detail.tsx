import { graphlib, layout } from "@dagrejs/dagre";
import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import type { WorkflowEdgeInput } from "#/components/modules/task-close/task-workflow-form";
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

/** 布局只读流程图；文字清单另行提供完整角色和状态名称。 */
function TaskWorkflowGraph({
	statuses,
	initial,
	edges,
}: {
	statuses: WorkflowStatus[];
	initial: string;
	edges: WorkflowEdgeInput[];
}) {
	const markerId = `workflow-arrow-${useId().replace(/:/g, "")}`;
	const graph = new graphlib.Graph({ multigraph: true });
	graph.setGraph({ rankdir: "TB", nodesep: 36, ranksep: 60, marginx: 24, marginy: 24 });
	graph.setDefaultEdgeLabel(() => ({}));
	for (const status of statuses) graph.setNode(status.value, { width: 142, height: 58 });
	for (const [index, edge] of edges.entries()) {
		if (graph.hasNode(edge.from) && graph.hasNode(edge.to))
			graph.setEdge(edge.from, edge.to, { width: 60, height: 20 }, String(index));
	}
	layout(graph);
	const dimensions = graph.graph();
	const width = Math.max(200, dimensions.width ?? 0);
	const height = Math.max(106, dimensions.height ?? 0);
	return (
		<div className="flex min-w-0 justify-center rounded-lg border bg-muted/20">
			<svg
				role="img"
				aria-label="流程状态图"
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				className="block h-auto max-w-full text-foreground"
			>
				<defs>
					<marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
						<path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
					</marker>
				</defs>
				{graph.edges().map((key) => {
					const route = graph.edge(key);
					const edge = edges[Number(key.name)];
					const points = route.points as { x: number; y: number }[];
					return (
						<g key={key.name} className="text-muted-foreground">
							<path
								d={points.map((point, i) => `${i ? "L" : "M"}${point.x},${point.y}`).join(" ")}
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeDasharray={edge.via === "action" ? "5 4" : undefined}
								markerEnd={`url(#${markerId})`}
							/>
							<rect x={route.x - 27} y={route.y - 10} width="54" height="20" rx="4" className="fill-background" />
							<text x={route.x} y={route.y + 4} textAnchor="middle" className="fill-muted-foreground text-[11px]">
								{VIA_LABEL[edge.via]}
							</text>
						</g>
					);
				})}
				{statuses.map((status) => {
					const node = graph.node(status.value);
					return (
						<g key={status.value}>
							<rect
								x={node.x - 71}
								y={node.y - 29}
								width="142"
								height="58"
								rx="8"
								className="fill-background stroke-border"
								strokeWidth={status.terminal ? 2 : 1}
							/>
							<text x={node.x} y={node.y - 2} textAnchor="middle" className="fill-foreground text-[13px] font-medium">
								<title>{status.label}</title>
								{status.label.length > 10 ? `${status.label.slice(0, 10)}…` : status.label}
							</text>
							<text x={node.x} y={node.y + 17} textAnchor="middle" className="fill-muted-foreground text-[11px]">
								{[status.value === initial ? "初始状态" : "", status.terminal ? "结束状态" : ""]
									.filter(Boolean)
									.join(" · ")}
							</text>
						</g>
					);
				})}
			</svg>
		</div>
	);
}
