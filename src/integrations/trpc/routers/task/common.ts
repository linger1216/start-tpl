import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import {
	sysFile,
	sysUser,
	taskActionTable,
	taskLogTable,
	taskMemberTable,
	taskReportTable,
	taskReportTemplateTable,
	taskTable,
} from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { cancelPendingNotifications, createNotification, publishNotice } from "#/lib/notification";
import { alive } from "#/lib/soft-delete";
import type { TaskLogEvent } from "#/lib/task/close-log";
import {
	isTerminalStatusOf,
	MAX_NAME_LENGTH,
	MAX_TEXT_LENGTH,
	statusesOf,
	taskPathOf,
	type WorkflowStatus,
} from "#/lib/task/close-spec";
import { taskReportSchema } from "#/lib/task/report-spec";
import { cancelActionReminders, rescheduleTaskReminders, scheduleNodeReminders } from "#/lib/task/scheduled-reminders";

/** 任务路由共用的授权、事务锁、通知及活动日志逻辑。 */

/** 通知的频道 / 事件名真源在 `lib/notification.ts`;这里转出,任务各 router 从 common 拿即可 */
export { publishNotice };

export type TaskRow = typeof taskTable.$inferSelect;

export type ActionRow = typeof taskActionTable.$inferSelect;

/** `db.transaction` 的回调参数类型 —— 事务里要用 `for update` 锁行 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 只需要 `select` 的读口:`isLocked` 在事务内外都要能调 */
type Reader = Pick<typeof db, "select">;

/** 状态图快照形状(`tc_workflow.payload` / `tc_task.workflow` 同一份 JSON) */
export type WorkflowPayload = {
	name?: string;
	/** 状态:`value` 落库 / 边引用,`label` 展示名 */
	statuses: WorkflowStatus[];
	initial: string;
	edges: { from: string; to: string; who: string[]; via: "direct" | "action" }[];
};

/** 还活着、占着锁的 action 状态(`active` = 待答复,`queued` = 串行链中排队):有这些就说明任务被锁 */
export const LIVE_ACTION_STATUS = ["active", "queued"] as const;

/** 任务 id / 动作 id 都是 varchar(191)(nanoid),入参统一按这个长度校验 */
export const ID = z.string().min(1).max(191);

/**
 * 各 id / 短枚举值的列宽 —— 与 `data-base-schema.ts` 一一对应。
 *
 * 之前这些 `z.string().min(1).max(N)` 在 10 个 router 里手抄了 20 多遍
 * (用户 id 36 / 文件 id 32 / 状态 value 32),改列宽要改一批地方且必然漏。
 */
/** 用户 id(`sys_user.id` = 36) */
export const USER_ID = z.string().min(1).max(36);
/** 文件 id(`sys_file.id` = 32) */
export const FILE_ID = z.string().min(1).max(32);
/**
 * 状态 value / 边端点 / 状态展示名 —— 都是 `varchar(32)` 的短串。
 *
 * label 存在 `tc_workflow.payload` 的 JSON 里(不占列宽),但编辑器一直按 32 卡,
 * 与 value 同宽最简单;两者**不做区分**,免得出现「value 能填 32 字、label 只能 20 字」这种没人记得的差异。
 */
export const STATUS_VALUE = z.string().min(1).max(32);

export const INVALID_DUE_AT_MESSAGE = "截止时间写成了一段没法解析的日期";
export const validDueAt = (value: string) => !Number.isNaN(new Date(value).getTime());
const dueAtField = z
	.string()
	.max(64)
	.nullish()
	.refine((value) => !value || validDueAt(value), { message: INVALID_DUE_AT_MESSAGE });
export const taskCoreFields = {
	name: z.string().min(1, "任务名称不能为空").max(MAX_NAME_LENGTH),
	description: z.string().max(MAX_TEXT_LENGTH).nullish(),
	dueAt: dueAtField,
	priority: z.number().int().min(0).max(2).nullish(),
};

// ────────────────────────────── 取行 / 判定 ──────────────────────────────

export const workflowOf = (task: TaskRow): WorkflowPayload => task.workflow as WorkflowPayload;

// ────────────────────────────── 授权 ──────────────────────────────

/** 管理员身份统一判据。 */
export const isAdminOf = (me: { id: string; isSuper?: boolean }) => isAdminUser(me.id, me.isSuper === true);

/**
 * 取一条活着的任务(取不到,含已软删,抛 `NOT_FOUND`)—— 读路径都要过 `alive()`。
 * `forUpdate` 给事务内的写路径:改状态 / 提交填报前不加锁,并发下会丢转移。
 */
async function selectTaskRow(reader: Reader, id: string, forUpdate: boolean): Promise<TaskRow> {
	const query = reader
		.select()
		.from(taskTable)
		.where(and(eq(taskTable.id, id), alive(taskTable)))
		.limit(1);
	const [row] = forUpdate ? await query.for("update") : await query;
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
	return row;
}

/** 读路径取任务(不加锁)。 */
export const getTaskRow = (id: string): Promise<TaskRow> => selectTaskRow(db, id, false);

/**
 * 这批 userId **必须都是活着的用户**,否则 `NOT_FOUND`。
 *
 * 与 `sys_user` 建立关联前都要过一道:不校验的话,脏 id 会静默写成「无主的成员 / 处理人」,
 * 那种数据最难查(列表里不显示,但权限判定又按它走)。
 *
 * `forUpdate` 给写路径:行锁住之后用户不会被并发软删,关联写完才放开。
 */
export async function assertUsersExist(
	tx: Tx,
	userIds: readonly string[],
	message: string,
	forUpdate = true,
): Promise<void> {
	if (!userIds.length) return;
	const query = tx
		.select({ id: sysUser.id })
		.from(sysUser)
		.where(and(inArray(sysUser.id, [...userIds]), alive(sysUser)));
	const rows = forUpdate ? await query.for("update") : await query;
	if (rows.length !== new Set(userIds).size) throw new TRPCError({ code: "NOT_FOUND", message });
}

/**
 * 评论 / 征询回复里挂的附件 id **必须真存在**:文件 id 只能从 `file.presign`/`file.confirm` 拿到
 * 是前端约定,不是权限边界 —— 不校验的话,`attachmentUrl` 的"挂在任务上才给 URL"守卫会被
 * `commentCreate([任意fileId])` 绕过(先看 attachment-ownership 要不要捶自己)。
 * 拿到不认识的 id 直接 BAD_REQUEST(不静默吞掉 —— 丢附件是用户自己发现的:) )。
 */
export async function assertAttachments(tx: Tx, attachIds: readonly string[]): Promise<void> {
	if (attachIds.length === 0) return;
	const hits = await tx
		.select({ id: sysFile.id })
		.from(sysFile)
		.where(and(inArray(sysFile.id, [...attachIds]), eq(sysFile.status, 1)));
	const seen = new Set(hits.map((row) => row.id));
	const missing = [...attachIds].filter((id) => !seen.has(id));
	if (missing.length > 0) {
		throw new TRPCError({ code: "BAD_REQUEST", message: `${missing.length} 个附件不存在或还没上传完成` });
	}
}

/** 文件元数据统一投影；历史 Excel 仍可显示已删除附件的原名。 */
export async function attachmentRows(reader: Reader, ids: readonly string[], includeInactive = false) {
	const uniq = [...new Set(ids.filter(Boolean))];
	if (!uniq.length) return [];
	return reader
		.select({ id: sysFile.id, name: sysFile.origin_name, size: sysFile.size, contentType: sysFile.content_type })
		.from(sysFile)
		.where(and(inArray(sysFile.id, uniq), includeInactive ? undefined : eq(sysFile.status, 1)));
}

/**
 * 任务的结构快照(`tc_task.report.schema`);**老任务没有快照** —— 回落到模板行的当前 payload
 * (模板是单版本,payload 即当前结构),否则老任务一打开就"无法加载填报"。
 */
export async function getTaskReportTemplate(task: { report: unknown }, reader: Pick<typeof db, "select"> = db) {
	const report = task.report as { reportId?: string; schema?: unknown } | null;
	const reportId = report?.reportId;
	if (!reportId) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报模板引用" });
	if (report?.schema != null) return { id: reportId, schema: taskReportSchema.parse(report.schema) };
	const [template] = await reader
		.select({ payload: taskReportTemplateTable.payload })
		.from(taskReportTemplateTable)
		.where(eq(taskReportTemplateTable.id, reportId))
		.limit(1);
	if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "填报模板不存在" });
	return { id: reportId, schema: taskReportSchema.parse(template.payload) };
}

/** 写路径取任务并**锁行**(`for update`)—— 事务内改状态 / 提交填报前必须走它。 */
export const lockTask = (tx: Tx, id: string): Promise<TaskRow> => selectTaskRow(tx, id, true);

/** 「创建者或管理员」的底层判据 —— 各守卫保留自己的消息,只共用这一句。 */
async function isCreatorOrAdmin(creatorId: string, meId: string): Promise<boolean> {
	return creatorId === meId || (await isAdminOf({ id: meId }));
}

/**
 * 只有**创建者或管理员**能做的写操作(`taskUpdate` / `taskRemove` / `memberRemove`)。
 *
 * 管理员判据是 `isAdminUser`(「系统管理员」角色)——「管理员什么都可以」是本模块的既定口径
 * ,与 `permissionsOf` 下发的 `isAdmin` 同一判据,
 * 免得出现「前端显示能点、后端 403」。
 */
export async function assertCanManage(task: TaskRow, meId: string, message = "只有任务创建者或管理员能做这个操作") {
	if (!(await isCreatorOrAdmin(task.creator_id, meId))) {
		throw new TRPCError({ code: "FORBIDDEN", message });
	}
}

/** 任务相关方:创建者 / 执行人 / 管理员 / 已在 `tc_member` 里的人。本模块「能看、能参与」的统一判据。 */
export async function isTaskParticipant(task: TaskRow, meId: string, reader: Reader = db): Promise<boolean> {
	if (task.creator_id === meId) return true;
	if (task.executor_id === meId) return true;
	if (await isAdminOf({ id: meId })) return true;
	return isParticipantOf(task.id, meId, reader);
}

/**
 * 「任务相关方」守卫 —— 用于**不是** `assertCanManage` 那档、但也不该对陌生人开放的操作
 * (加成员、看填报、导出)。各调用点自带消息,便于前端区分。
 *
 */
export async function assertTaskParticipant(task: TaskRow, meId: string, message: string): Promise<void> {
	if (!(await isTaskParticipant(task, meId))) throw new TRPCError({ code: "FORBIDDEN", message });
}

/**
 * 任务详情能不能看 —— 只对**任务相关方**开放:自己这条的创建人 / 成员 / 管理员;
 * 再加一条「**父任务的参与者**能看子任务」(任务树向下可见;子任务看不到父任务)。
 */
async function isTaskReadable(task: TaskRow, meId: string): Promise<boolean> {
	if (await isTaskParticipant(task, meId)) return true;
	if (!task.parent_id) return false;
	const [parent] = await db.select().from(taskTable).where(eq(taskTable.id, task.parent_id)).limit(1);
	return parent ? isTaskParticipant(parent, meId) : false;
}

export async function assertTaskReadable(task: TaskRow, meId: string): Promise<void> {
	if (!(await isTaskReadable(task, meId))) throw new TRPCError({ code: "FORBIDDEN", message: "无权查看这条任务" });
}

/** 这个人在这条任务上是不是**参与者**(`tc_member` 里有一行)—— 执行人是 `tc_task.executor_id`,不在本判据里 */
export async function isParticipantOf(taskId: string, userId: string, reader: Reader = db): Promise<boolean> {
	const [row] = await reader
		.select({ id: taskMemberTable.id })
		.from(taskMemberTable)
		.where(and(eq(taskMemberTable.task_id, taskId), eq(taskMemberTable.user_id, userId)))
		.limit(1);
	return Boolean(row);
}

/**
 * `who` 协议判定。
 *
 * - `who = []` → **false**:系统自带,前端不开(任何用户都不能据此发起);
 * - `"creator"` → 读 `tc_task.creator_id`,**不走 `tc_member`**;
 * - `"participant"` / `"executor"` → 查 `tc_member`;
 * - 数组 = OR。
 *
 * `memberRoles` 传已查到的角色可以省一次查询(详情页里要判很多条边)。
 */
export async function whoAllows(
	task: TaskRow,
	meId: string,
	who: readonly string[],
	options: { isMember?: boolean; reader?: Reader } = {},
): Promise<boolean> {
	if (who.length === 0) return false;
	if (who.includes("creator") && task.creator_id === meId) return true;
	if (who.includes("executor") && task.executor_id === meId) return true;
	if (who.includes("participant") && (options.isMember ?? (await isParticipantOf(task.id, meId, options.reader ?? db))))
		return true;
	return false;
}

// ────────────────────────────── 状态机 ──────────────────────────────

/** 在流程快照中查找指定转移。 */
export function findEdge(
	workflow: WorkflowPayload,
	edge: { from: string | null | undefined; to: string | null | undefined; via: "direct" | "action" },
) {
	return (workflow.edges ?? []).find((item) => item.from === edge.from && item.to === edge.to && item.via === edge.via);
}

/** 边的角色守卫；管理员仍须满足边存在及锁定检查。 */
export async function assertEdgeWho(
	task: TaskRow,
	meId: string,
	edge: WorkflowPayload["edges"][number],
	admin: boolean,
	tx: Tx,
	message: string,
) {
	if (!admin && !(await whoAllows(task, meId, edge.who ?? [], { reader: tx })))
		throw new TRPCError({ code: "FORBIDDEN", message });
}

/** 统一拒绝锁定任务的状态变更。 */
export async function assertTaskUnlocked(taskId: string, reader: Reader = db) {
	if (await isLocked(taskId, reader))
		throw new TRPCError({ code: "BAD_REQUEST", message: "有未完成的审批动作,任务被锁定" });
}

/** 任务被锁 = 存在 `is_locking=1` 且状态还活着的 action */
export async function isLocked(taskId: string, reader: Reader = db): Promise<boolean> {
	const [row] = await reader
		.select({ id: taskActionTable.id })
		.from(taskActionTable)
		.where(
			and(
				eq(taskActionTable.task_id, taskId),
				eq(taskActionTable.is_locking, true),
				inArray(taskActionTable.status, [...LIVE_ACTION_STATUS]),
			),
		)
		.limit(1);
	return Boolean(row);
}

export async function cancelLiveTaskActions(tx: Tx, taskId: string, now: Date) {
	const actions = await tx
		.select({ id: taskActionTable.id })
		.from(taskActionTable)
		.where(and(eq(taskActionTable.task_id, taskId), inArray(taskActionTable.status, [...LIVE_ACTION_STATUS])))
		.for("update");
	if (!actions.length) return;
	const ids = actions.map((action) => action.id);
	await tx
		.update(taskActionTable)
		.set({ status: "cancelled", updated_at: now })
		.where(inArray(taskActionTable.id, ids));
	await cancelPendingNotifications(tx, "task_action", ids);
	await cancelActionReminders(tx, ids, now);
}

/**
 * 取动作并锁行 —— 先探 `task_id`(免全表锁),**先锁任务再锁动作**。
 * 锁顺序与 `taskTransit` 一致,互相之间不会等成死锁。
 */
export async function lockAction(tx: Tx, actionId: string): Promise<{ task: TaskRow; action: ActionRow }> {
	const [probe] = await tx
		.select({ taskId: taskActionTable.task_id })
		.from(taskActionTable)
		.where(eq(taskActionTable.id, actionId))
		.limit(1);
	if (!probe) throw new TRPCError({ code: "NOT_FOUND", message: "动作不存在" });
	const task = await lockTask(tx, probe.taskId);
	const [action] = await tx
		.select()
		.from(taskActionTable)
		.where(eq(taskActionTable.id, actionId))
		.limit(1)
		.for("update");
	if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "动作不存在" });
	return { task, action };
}

/** 模板列表的可见范围。历史任务快照回落不使用此过滤，软删后仍须可读。 */
export function visibleTemplateFilter(me: { id: string }, admin: boolean) {
	return admin
		? alive(taskReportTemplateTable)
		: and(
				alive(taskReportTemplateTable),
				or(eq(taskReportTemplateTable.shared, 1), eq(taskReportTemplateTable.creator_id, me.id)),
			);
}

/** 新绑定锁行；导入导出只读。两条路径保留各自的缺失错误。 */
export async function resolveReportTemplate(
	reader: Reader,
	options: { templateId: string; me: { id: string; isSuper?: boolean }; forUpdate?: boolean },
) {
	const query = reader
		.select()
		.from(taskReportTemplateTable)
		.where(and(eq(taskReportTemplateTable.id, options.templateId), alive(taskReportTemplateTable)))
		.limit(1);
	const [template] = options.forUpdate ? await query.for("update") : await query;
	if (!template) {
		if (options.forUpdate) throw new TRPCError({ code: "NOT_FOUND", message: "填报模板已删除，无法用于新任务" });
		throw new TRPCError({ code: "FORBIDDEN", message: "无权使用该填报模板" });
	}
	if (!template.shared && template.creator_id !== options.me.id && !(await isAdminOf(options.me)))
		throw new TRPCError({ code: "FORBIDDEN", message: "无权使用该填报模板" });
	return { ...template, schema: taskReportSchema.parse(template.payload) };
}

/** 填报的「数据范围」:子任务按 `tc_task.report.filter` 过滤;父任务(无 filter)= 全部行。 */
export type ScopeFilter = Array<{ field: string; value: unknown }>;

/** 一批 user_id → 姓名(空 / null 自动滤掉)。分批查 + 内存拼(项目现有风格,不引入 leftJoin) */
export async function nameMapOf(ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
	const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
	if (unique.length === 0) return new Map();
	const rows = await db.select({ id: sysUser.id, name: sysUser.name }).from(sysUser).where(inArray(sysUser.id, unique));
	return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * 一批 task_id → 执行人姓名 —— 卡面「发给谁」的来源。
 *
 * 执行人是 `tc_task.executor_id`(一个任务至多一名):fan-out 时一条子任务 = 一名执行人,
 * 光看 `creator_id` 全都一样(都是派活的人),分不出发给谁。
 */
export async function executorNamesOf(taskIds: readonly string[]): Promise<Map<string, string>> {
	if (taskIds.length === 0) return new Map();
	const rows = await db
		.select({ taskId: taskTable.id, executorId: taskTable.executor_id })
		.from(taskTable)
		.where(inArray(taskTable.id, [...taskIds]));
	const names = await nameMapOf(rows.map((row) => row.executorId));
	const map = new Map<string, string>();
	for (const row of rows) {
		const name = row.executorId ? names.get(row.executorId) : undefined;
		if (name) map.set(row.taskId, name);
	}
	return map;
}

// ────────────────────────────── 通知 ──────────────────────────────

/** 只接收任务成员的结构化 ID；评论与通知同事务提交。 */
export async function createMentionNotifications(
	tx: Tx,
	task: TaskRow,
	content: string,
	author: { id: string; name: string },
	mentionIds: readonly string[],
	commentId: string,
): Promise<string[]> {
	const receivers = [...new Set(mentionIds)].filter((id) => id !== author.id);
	if (!receivers.length) return [];
	const members = await tx
		.select({ userId: taskMemberTable.user_id })
		.from(taskMemberTable)
		.where(eq(taskMemberTable.task_id, task.id));
	const roster = new Set([task.creator_id, ...members.map((row) => row.userId)]);
	if (receivers.some((id) => !roster.has(id))) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "只能提及任务成员" });
	}
	await createNotification(tx, {
		type: "comment.mentioned",
		source: { type: "task", id: task.id },
		title: `${author.name || "有人"} 在「${task.name}」的讨论里 @ 你`,
		content: content.slice(0, 120),
		payload: { path: taskPathOf(task.id), level: "info", commentId },
		dedupeKey: `comment.mentioned:${commentId}`,
		recipients: receivers.map((userId) => ({ userId, channel: "in_app" })),
	});
	return receivers;
}

/** 催办 / 看催办记录 / 撤回动作:动作发起人、任务创建人或管理员 */
export async function isActionCreatorOrAdmin(
	action: { creator_id: string },
	task: { creator_id: string },
	meId: string,
): Promise<boolean> {
	return meId === action.creator_id || meId === task.creator_id || (await isAdminOf({ id: meId }));
}

/** 指派通知共用信封；初次发起和串行推进保留各自的说明。 */
export function notifyActionAssigned(
	tx: Tx,
	options: { actionId: string; assigneeId: string; task: TaskRow; content: string },
) {
	return createNotification(tx, {
		type: "action.assigned",
		source: { type: "task_action", id: options.actionId },
		title: `轮到你:${options.task.name}`,
		content: options.content,
		path: taskPathOf(options.task.id),
		level: "info",
		payload: { actionId: options.actionId },
		dedupeKey: `action.assigned:${options.actionId}`,
		recipients: [{ userId: options.assigneeId, channel: "in_app" }],
	});
}

/** 在任务行锁内推进串行节点；未激活节点不会产生待办或通知。 */
export async function activateNextAction(tx: Tx, task: TaskRow, action: ActionRow, now: Date) {
	const [next] = await tx
		.select()
		.from(taskActionTable)
		.where(
			and(
				eq(taskActionTable.task_id, task.id),
				eq(taskActionTable.parent_action_id, action.id),
				eq(taskActionTable.is_locking, action.is_locking),
				eq(taskActionTable.status, "queued"),
			),
		)
		.orderBy(asc(taskActionTable.sequence))
		.limit(1)
		.for("update");
	if (!next) return null;
	await tx
		.update(taskActionTable)
		.set({ status: "active", activated_at: now, updated_at: now })
		.where(and(eq(taskActionTable.id, next.id), eq(taskActionTable.status, "queued")));
	await scheduleNodeReminders(tx, task, { ...next, activated_at: now }, now);
	await notifyActionAssigned(tx, {
		actionId: next.id,
		assigneeId: next.assignee_id,
		task,
		content: `串行${action.is_locking ? "审批" : "征询"}轮到你处理 —— 到「我的任务」查看`,
	});
	return next;
}

/**
 * 写一行活动日志(`tc_log`)—— **必须传当前事务的 `tx`**:它与业务同生共死。
 *
 * ⚠️ 与 `lib/global-audit.ts` 的 `writeGlobalAudit` **故意相反**:那个是 fire-and-forget、"审计绝不拖累业务";
 * 这个**不吞错、不旁路** —— 业务成功就一定有历史,业务回滚历史也一起没(状态变了却没有留痕,
 * 正是本需求要消灭的东西)。别"顺手"改成 `void`。
 *
 * 两个状态列的口径:**事件前后的任务状态**,没动状态就传 null(「想去哪」放 `detail.intendedTo`)。
 */
// ────────────────────────────── 日志 ──────────────────────────────

type TaskEventEntry = {
	taskId: string;
	event: TaskLogEvent;
	actor: { id: string; name: string };
	fromStatus?: string | null;
	toStatus?: string | null;
	targetId?: string | null;
	detail?: unknown;
	at?: Date;
};

/** 一批活动日志必须与业务同事务，任何插入失败都回滚。 */
export async function writeTaskEvents(tx: Tx, entries: readonly TaskEventEntry[]): Promise<void> {
	if (!entries.length) return;
	await tx.insert(taskLogTable).values(
		entries.map((entry) => ({
			id: newId(),
			task_id: entry.taskId,
			event: entry.event,
			from_status: entry.fromStatus ?? null,
			to_status: entry.toStatus ?? null,
			target_id: entry.targetId ?? null,
			actor_id: entry.actor.id,
			actor_name: entry.actor.name.slice(0, 64),
			detail: entry.detail ?? null,
			created_at: entry.at ?? new Date(),
		})),
	);
}

export async function writeTaskEvent(tx: Tx, entry: TaskEventEntry): Promise<void> {
	await writeTaskEvents(tx, [entry]);
}

/** 取任务的填报表行(一任务一行);读口可传事务。事务内要锁行就带 `forUpdate`。 */
export async function reportRowOf(reader: Reader, taskId: string, forUpdate = false) {
	const query = reader.select().from(taskReportTable).where(eq(taskReportTable.task_id, taskId)).limit(1);
	const [row] = forUpdate ? await query.for("update") : await query;
	return row ?? null;
}

/** 这条任务下面还有没有活着的子任务 —— 父任务是「分派容器」时用它挡下对母版的写入。 */
export async function hasChildTasks(reader: Reader, taskId: string): Promise<boolean> {
	const [row] = await reader
		.select({ id: taskTable.id })
		.from(taskTable)
		.where(and(eq(taskTable.parent_id, taskId), alive(taskTable)))
		.limit(1);
	return Boolean(row);
}

/**
 * 推进任务状态(事务内):进终态先取消未完成动作;终态进出时重排提醒。
 * `taskTransit`(直接改)与 `actionRespond`(审批通过)共用。
 */
export async function applyStatusMove(tx: Tx, task: TaskRow, next: string, now: Date): Promise<void> {
	const statuses = statusesOf(task.workflow);
	if (isTerminalStatusOf(statuses, next)) await cancelLiveTaskActions(tx, task.id, now);
	await tx.update(taskTable).set({ status: next, updated_at: now }).where(eq(taskTable.id, task.id));
	if (isTerminalStatusOf(statuses, task.status) || isTerminalStatusOf(statuses, next))
		await rescheduleTaskReminders(tx, { ...task, status: next }, now);
}

export const pageInput = {
	page: z.number().int().min(1).optional(),
	pageSize: z.number().int().min(1).max(100).optional(),
};
