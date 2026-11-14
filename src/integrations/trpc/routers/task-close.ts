import { mergeTRPCRouters } from "../init";
import { taskActionRouter } from "./task-action";
import { taskCommentRouter } from "./task-comment";
import { taskMemberRouter } from "./task-member";
import { taskQueryRouter } from "./task-query";
import { taskRecordRouter } from "./task-record";
import { taskReportRouter } from "./task-report";
import { taskWorkflowRouter } from "./task-workflow";

/** 保持 taskClose.* 接口路径，按职责组合任务路由。 */
export const taskCloseRouter = mergeTRPCRouters(
	taskReportRouter,
	taskWorkflowRouter,
	taskQueryRouter,
	taskRecordRouter,
	taskMemberRouter,
	taskActionRouter,
	taskCommentRouter,
);
