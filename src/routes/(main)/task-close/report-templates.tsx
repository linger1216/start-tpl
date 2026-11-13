import { createFileRoute } from "@tanstack/react-router";

import { TaskReportTemplatesPage } from "#/components/modules/task-close/task-report-templates-page";

/**
 * 「填报模板」台账页 —— 任务闭环的填报表单结构管理(原「管理填报模板」弹窗独立成页)。
 *
 * 列表页数据在 loader 里预取(模板不多,一次拉全),首屏直出;写操作用户在页面内自己拉。
 */
export const Route = createFileRoute("/(main)/task-close/report-templates")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(context.trpc.taskClose.reportTemplateList.queryOptions()),
	component: TaskReportTemplatesPage,
});
