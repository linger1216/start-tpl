import { mergeTRPCRouters } from "../../init";
import { taskActionRouter } from "./action";
import { taskCommentRouter } from "./comment";
import { taskMemberRouter } from "./member";
import { taskQueryRouter } from "./query";
import { taskRecordRouter } from "./record";
import { taskReminderRouter } from "./reminder";
import { taskReportRouter } from "./report";
import { taskWorkflowRouter } from "./workflow";

/** 保持 taskClose.* 接口路径，按职责组合任务路由。 */
export const taskCloseRouter = mergeTRPCRouters(
	taskReportRouter,
	taskWorkflowRouter,
	taskQueryRouter,
	taskRecordRouter,
	taskReminderRouter,
	taskMemberRouter,
	taskActionRouter,
	taskCommentRouter,
);
