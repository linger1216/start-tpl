import { graphlib, layout } from "@dagrejs/dagre";
import { useId } from "react";
import type { WorkflowEdgeInput } from "#/components/modules/task-close/task-workflow-form";
import type { WorkflowStatus } from "#/lib/task/close-spec";

/** 布局只读流程图；文字清单另行提供完整角色和状态名称。 */
export function TaskWorkflowGraph({
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
	graph.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 90, marginx: 24, marginy: 24 });
	graph.setDefaultEdgeLabel(() => ({}));
	for (const status of statuses) graph.setNode(status.value, { width: 142, height: 58 });
	for (const [index, edge] of edges.entries()) {
		if (graph.hasNode(edge.from) && graph.hasNode(edge.to))
			graph.setEdge(edge.from, edge.to, { width: 60, height: 20 }, String(index));
	}
	layout(graph);
	const dimensions = graph.graph();
	return (
		<div className="max-h-80 overflow-auto rounded-lg border bg-muted/20">
			<svg
				role="img"
				aria-label="流程状态图"
				width={Math.max(200, dimensions.width ?? 0)}
				height={Math.max(106, dimensions.height ?? 0)}
				className="block text-foreground"
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
								{edge.via === "action" ? "审批" : "直接修改"}
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
