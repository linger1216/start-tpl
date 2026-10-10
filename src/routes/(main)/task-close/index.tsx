import { createFileRoute } from "@tanstack/react-router";

import { TaskCloseCardsPage } from "#/components/modules/task-close/task-close-cards-page";

/**
 * 「我的任务」卡片页。
 *
 * 与其它列表页不同,**这里不在 loader 里预取**:`taskList` 是服务端分页,
 * 入参含筛选与页码,预取的那一份和组件首帧要的那一份不一定一致(每页条数还取决于 `page.size` 参数),
 * 预取错了反而多打一次接口。所以交给组件自己拉。
 */
export const Route = createFileRoute("/(main)/task-close/")({
	component: TaskCloseCardsPage,
});
