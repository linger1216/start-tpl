import { createFileRoute } from "@tanstack/react-router";

import { TaskCloseWorkflowsPage } from "#/components/modules/task-close/task-close-workflows-page";

/**
 * 「流程模板」卡片页 —— 任务闭环的状态图模板管理。
 *
 * 列表页数据在 loader 里预取(模板不多,一次拉全),首屏直出;写操作用户在页面内自己拉。
 */
export const Route = createFileRoute("/(main)/task-close/workflows")({
	loader: ({ context }) => context.queryClient.ensureQueryData(context.trpc.taskClose.workflowList.queryOptions()),
	component: TaskCloseWorkflowsPage,
});
