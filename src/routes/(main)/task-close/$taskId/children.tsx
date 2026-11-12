import { createFileRoute } from "@tanstack/react-router";

import { TaskCloseChildrenPage } from "#/components/modules/task-close/task-close-children-page";

/**
 * 子任务卡片页 —— 点「有子任务」的任务卡片进这里(不是详情页)。
 * 叶子任务没有这一层,直接进详情页。
 */
export const Route = createFileRoute("/(main)/task-close/$taskId/children")({
	component: TaskCloseChildrenRoute,
});

function TaskCloseChildrenRoute() {
	const { taskId } = Route.useParams();
	return <TaskCloseChildrenPage taskId={taskId} />;
}
