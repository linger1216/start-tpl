import { createFileRoute } from "@tanstack/react-router";

import { TaskCloseDetailPage } from "#/components/modules/task-close/task-close-detail-page";

/**
 * 任务详情 —— 不进菜单(`sys_menu` 里没有这条路径),按 `canViewPath` 的口径只要求登录;
 * 能不能**推进**由服务端的 `permissions` 说了算,不由路由拦。
 */
export const Route = createFileRoute("/(main)/task-close/$taskId")({
	component: TaskCloseDetailRoute,
});

function TaskCloseDetailRoute() {
	const { taskId } = Route.useParams();
	return <TaskCloseDetailPage taskId={taskId} />;
}
