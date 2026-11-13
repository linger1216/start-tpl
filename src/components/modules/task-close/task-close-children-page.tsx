import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { TaskCardLink, TaskCloseTaskCard } from "#/components/modules/task-close/task-close-task-card";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button, buttonVariants } from "#/components/ui/button";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { statusLabelOf, type WorkflowStatus } from "#/lib/task-close-spec";

/**
 * 子任务卡片页 —— 点「有子任务」的任务卡片进这里,而不是它的详情页。
 *
 * 形态照抄「我的任务」:同一张卡片、同样的栅格。差别只有两处:
 *   · 页头是**父任务**本身(标题 + 「N 个子任务」),右上角给一个「查看本任务详情」入口
 *     —— 父任务的链接 / 附件 / 填报 / 评论都挂在详情页上,这里只是入口;
 *   · 卡片列表是父任务的**子任务**,点子任务仍按同一规则分流(还有子任务 → 再一层卡片页,叶子 → 详情页)。
 */
export function TaskCloseChildrenPage({ taskId }: { taskId: string }) {
	const trpc = useTRPC();
	const detailQuery = useQuery(trpc.taskClose.taskGet.queryOptions({ id: taskId }));

	if (detailQuery.isPending) {
		return (
			<PageFrame>
				<div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>
			</PageFrame>
		);
	}

	if (detailQuery.isError || !detailQuery.data) {
		return (
			<PageFrame>
				<div className="grid justify-items-center gap-3 py-12 text-center text-sm text-muted-foreground">
					<p>{toApiError(detailQuery.error).message}</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" disabled={detailQuery.isFetching} onClick={() => detailQuery.refetch()}>
							{detailQuery.isFetching ? "重试中…" : "重试"}
						</Button>
						<Link to="/task-close" className={buttonVariants({ variant: "ghost", size: "sm" })}>
							返回我的任务
						</Link>
					</div>
				</div>
			</PageFrame>
		);
	}

	const { task, children } = detailQuery.data;
	// 状态展示名取父任务的工作流快照(子任务与父任务同一条流程)
	const workflow = task.workflow as { statuses?: WorkflowStatus[] } | null;
	const statuses = workflow?.statuses ?? [];
	const labelOf = (value: string) => statusLabelOf(statuses, value);

	return (
		<PageFrame>
			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink render={<Link to="/task-close" />}>我的任务</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>{task.name}</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			<PageHeader
				title={task.name}
				description={`父任务 · ${children.length} 个子任务`}
				descriptionInline
				actions={
					<>
						<RefreshButton busy={detailQuery.isFetching} onClick={() => detailQuery.refetch()} />
						{/* 真锚点 + 按钮样式 —— `Button render={<Link/>}` 在 Base UI 里会把 `<a>` 当按钮(开发态直接报错) */}
						<Link to="/task-close/$taskId" params={{ taskId }} className={buttonVariants()}>
							查看本任务详情
						</Link>
					</>
				}
			/>

			{children.length === 0 ? (
				<div className="py-12 text-center text-sm text-muted-foreground">这条任务没有子任务。</div>
			) : (
				<div className="flex flex-wrap gap-3">
					{children.map((child) => (
						<TaskCardLink key={child.id} task={child} className="block w-full max-w-sm">
							<TaskCloseTaskCard task={child} statusLabel={labelOf} />
						</TaskCardLink>
					))}
				</div>
			)}
		</PageFrame>
	);
}
