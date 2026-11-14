import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import {
	sysFile,
	sysUser,
	taskActionTable,
	taskLogTable,
	taskMemberTable,
	taskReportTemplateTable,
	taskTable,
} from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { cancelPendingNotifications, createNotification } from "#/lib/notification";
import { alive } from "#/lib/soft-delete";
import { publish } from "#/lib/sse-bus";
import type { TaskLogEvent } from "#/lib/task/close-log";
import { taskPathOf, type WorkflowStatus } from "#/lib/task/close-spec";
import { taskReportSchema } from "#/lib/task/report-spec";
import { cancelActionReminders, scheduleNodeReminders } from "#/lib/task/scheduled-reminders";

/** 任务路由共用的授权、事务锁、通知及活动日志逻辑。 */

export type TaskRow = typeof taskTable.$inferSelect;

export type ActionRow = typeof taskActionTable.$inferSelect;

/** `db.transaction` 的回调参数类型 —— 事务里要用 `for update` 锁行 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 只需要 `select` 的读口:`isLocked` 在事务内外都要能调 */
type Reader = Pick<typeof db, "select">;

/** 状态图快照形状(`tc_workflow.payload` / `tc_task.workflow`,见文档「JSON 字段形状」) */
export type WorkflowPayload = {
	name?: string;
	/** 状态:`value` 落库 / 边引用,`label` 展示名 */
	statuses: WorkflowStatus[];
	initial: string;
	edges: { from: string; to: string; who: string[]; via: "direct" | "action" }[];
};

/** 成员角色 —— `tc_member.role` 的两种取值 */
const MEMBER_ROLES = ["participant", "executor"] as const;

/** 还活着、占着锁的 action 状态(`active` = 待答复,`queued` = 串行链中排队):有这些就说明任务被锁 */
export const LIVE_ACTION_STATUS = ["active", "queued"] as const;

/** 成员角色入参(`MEMBER_ROLES` 的 zod 形态) */
export const ROLE_ENUM = z.enum(MEMBER_ROLES);

/** 任务 id / 动作 id 都是 varchar(191)(nanoid),入参统一按这个长度校验 */
export const ID = z.string().min(1).max(191);

// ────────────────────────────── 取行 / 判定 ──────────────────────────────

export const workflowOf = (task: TaskRow): WorkflowPayload => task.workflow as WorkflowPayload;

/** 取一条活着的任务;取不到(含已软删)抛 `NOT_FOUND` —— 读路径都要过 `alive()` */
export async function getTaskRow(id: string): Promise<TaskRow> {
	const [row] = await db
		.select()
		.from(taskTable)
		.where(and(eq(taskTable.id, id), alive(taskTable)))
		.limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
	return row;
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

/** 取任务并**锁行**(`for update`)—— 事务内改状态前必须走它,否则并发下会丢转移 */
export async function lockTask(tx: Tx, id: string): Promise<TaskRow> {
	const [row] = await tx
		.select()
		.from(taskTable)
		.where(and(eq(taskTable.id, id), alive(taskTable)))
		.limit(1)
		.for("update");
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
	return row;
}

/**
 * 只有**创建者或管理员**能做的写操作(`taskUpdate` / `taskRemove` / `memberRemove`)。
 *
 * 管理员判据是 `isAdminUser`(「系统管理员」角色)——「管理员什么都可以」是本模块的既定口径
 * (见 `doc/task-close.md` 权限矩阵),与 `permissionsOf` 下发的 `isAdmin` 同一判据,
 * 免得出现「前端显示能点、后端 403」。
 */
export async function assertCanManage(task: TaskRow, meId: string) {
	if (task.creator_id !== meId && !(await isAdminUser(meId))) {
		throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建者或管理员能做这个操作" });
	}
}

/**
 * 删除任务 —— 破坏性动作,判据与 `assertCanManage` 相同(创建者或管理员),但**单独一条**、
 * 单独的消息:口径要能被人一眼读出来,也不跟「编辑 / 成员管理」绑在一起被顺手放宽。
 */
export async function assertCanRemoveTask(task: TaskRow, meId: string) {
	if (task.creator_id !== meId && !(await isAdminUser(meId))) {
		throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建者或管理员可以删除任务" });
	}
}

/** 任务相关方:创建者 / 管理员 / 已在 `tc_member` 里的人。本模块「能看、能参与」的统一判据。 */
export async function isTaskParticipant(task: TaskRow, meId: string, reader: Reader = db): Promise<boolean> {
	if (task.creator_id === meId) return true;
	if (await isAdminUser(meId)) return true;
	return (await memberRolesOf(task.id, meId, reader)).length > 0;
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

/** 这个人在这条任务上通过 `tc_member` 拿到的角色(不含 creator —— 那个是 `tc_task` 固有列) */
export async function memberRolesOf(taskId: string, userId: string, reader: Reader = db): Promise<string[]> {
	const rows = await reader
		.select({ role: taskMemberTable.role })
		.from(taskMemberTable)
		.where(and(eq(taskMemberTable.task_id, taskId), eq(taskMemberTable.user_id, userId)));
	return rows.map((row) => row.role);
}

/**
 * `who` 协议判定(文档「who 协议」)。
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
	memberRoles?: readonly string[],
	reader: Reader = db,
): Promise<boolean> {
	if (who.length === 0) return false;
	if (who.includes("creator") && task.creator_id === meId) return true;
	const wanted = MEMBER_ROLES.filter((role) => who.includes(role));
	if (wanted.length === 0) return false;
	const roles = memberRoles ?? (await memberRolesOf(task.id, meId, reader));
	return wanted.some((role) => roles.includes(role));
}

/** 任务被锁 = 存在 `is_locking=1` 且状态还活着的 action(文档「锁语义」) */
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

/** 新绑定与模板删除串行，并校验模板可见性。 */
export async function getAvailableReportTemplate(tx: Tx, templateId: string, me: { id: string; isSuper?: boolean }) {
	const [template] = await tx
		.select()
		.from(taskReportTemplateTable)
		.where(and(eq(taskReportTemplateTable.id, templateId), alive(taskReportTemplateTable)))
		.limit(1)
		.for("update");
	if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "填报模板已删除，无法用于新任务" });
	if (!template.shared && template.creator_id !== me.id && !me.isSuper && !(await isAdminUser(me.id)))
		throw new TRPCError({ code: "FORBIDDEN", message: "无权使用该填报模板" });
	return { ...template, schema: taskReportSchema.parse(template.payload) };
}

/** 填报的「数据范围」:子任务按 `tc_task.report.filter` 过滤;父任务(无 filter)= 全部行。 */
export type ScopeFilter = Array<{ field: string; value: unknown }>;

/** 一批 user_id → 姓名。分批查 + 内存拼(项目现有风格,不引入 leftJoin) */
export async function nameMapOf(ids: readonly string[]): Promise<Map<string, string>> {
	const unique = [...new Set(ids.filter(Boolean))];
	if (unique.length === 0) return new Map();
	const rows = await db.select({ id: sysUser.id, name: sysUser.name }).from(sysUser).where(inArray(sysUser.id, unique));
	return new Map(rows.map((row) => [row.id, row.name]));
}

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

export function publishMentions(receivers: readonly string[]) {
	for (const userId of receivers) publish({ channel: `notice:${userId}`, name: "notice.new", data: {} });
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
	await createNotification(tx, {
		type: "action.assigned",
		source: { type: "task_action", id: next.id },
		title: `轮到你:${task.name}`,
		content: `串行${action.is_locking ? "审批" : "征询"}轮到你处理 —— 到「我的任务」查看`,
		payload: { path: taskPathOf(task.id), level: "info", actionId: next.id },
		dedupeKey: `action.assigned:${next.id}`,
		recipients: [{ userId: next.assignee_id, channel: "in_app" }],
	});
	return next;
}

/** 稳定序列化(键排序)—— **只用来比**「内容区 / 附件有没有变」,别拿去存库 */
export function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	const bag = value as Record<string, unknown>;
	const body = Object.keys(bag)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(bag[key])}`)
		.join(",");
	return `{${body}}`;
}

export const hashReportRows = (rows: unknown) => createHash("sha256").update(stableJson(rows)).digest("hex");

/** `tc_log.detail` 是 JSON 列,读出来可能是任何东西 —— 当袋子读,读不到就当空(绝不抛) */
export function detailOf(detail: unknown): Record<string, unknown> {
	return detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {};
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
export async function writeTaskEvent(
	tx: Tx,
	entry: {
		taskId: string;
		event: TaskLogEvent;
		actor: { id: string; name: string };
		fromStatus?: string | null;
		toStatus?: string | null;
		targetId?: string | null;
		detail?: unknown;
		at?: Date;
	},
): Promise<void> {
	await tx.insert(taskLogTable).values({
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
	});
}

export const pageInput = {
	page: z.number().int().min(1).optional(),
	pageSize: z.number().int().min(1).max(100).optional(),
};
