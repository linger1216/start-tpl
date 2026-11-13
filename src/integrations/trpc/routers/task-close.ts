import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	min,
	or,
	type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import {
	sysFile,
	sysNotification,
	sysNotificationDelivery,
	sysUser,
	taskActionTable,
	taskCommentTable,
	taskLogTable,
	taskMemberTable,
	taskReportTable,
	taskReportTemplateTable,
	taskTable,
	taskWorkflowTable,
} from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { cancelPendingNotifications, createNotification } from "#/lib/notification";
import { alive, softDeleted } from "#/lib/soft-delete";
import { publish } from "#/lib/sse-bus";
import { getObjectUrl } from "#/lib/storage";
import type { TaskLogEvent } from "#/lib/task-close-log";
import {
	DEFAULT_WORKFLOW_ID,
	TASK_URGE_COOLDOWN_MINUTES,
	taskPathOf,
	type WorkflowStatus,
} from "#/lib/task-close-spec";
import { normalizePayload, parseBlocks, taskPayloadSchema } from "#/lib/task-payload";
import { createReportWorkbook, previewReportWorkbook } from "#/lib/task-report-excel";
import { reportRowSchema, taskReportSchema, validateTaskReport } from "#/lib/task-report-spec";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../init";

/**
 * 任务闭环(tc_close 模块)—— 「甲发任务给乙 → 处置 → 审批 → 关闭归档」。
 *
 * 表 / 状态机 / `who` 协议的设计真源是 `doc/task-close.md`,这里只写接口。
 *
 * **授权 双轨**:任务推进类接口(19 个)的 `who` / 边 / 角色判定在 resolver 内做
 * (`whoAllows`),结果全部登记在 `UNMAPPED_MUTATIONS` / `UNMAPPED_QUERIES`;
 * 流程模板的 4 个接口(`workflowGet/Create/Update/Remove`)走页面合成码
 * `pagePermOf("/task-close/workflows")`(`PERM_BY_PATH`),按钮级另配 `sys:tcWorkflow:*` 权限点。
 *
 * 任务与其评论、动作、日志和附件由同一任务可见性判据保护。
 *
 * **管理员旁路**:「系统管理员」角色(`isAdminUser`)在本模块**什么都可以** —— 读路径由
 * `permissionsOf` 下发 `isAdmin`,写路径的 `assertCanManage` / `whoAllows` / `commentRemove` 一并放行,
 * 三处判据同源。仍受状态机完整性约束(边必须存在),只是不受 `who` 限制。
 */

type TaskRow = typeof taskTable.$inferSelect;
type ActionRow = typeof taskActionTable.$inferSelect;
type MemberRow = typeof taskMemberTable.$inferSelect;
type WorkflowRow = typeof taskWorkflowTable.$inferSelect;

/** `db.transaction` 的回调参数类型 —— 事务里要用 `for update` 锁行 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** 只需要 `select` 的读口:`isLocked` 在事务内外都要能调 */
type Reader = Pick<typeof db, "select">;

/** 状态图快照形状(`tc_workflow.payload` / `tc_task.workflow`,见文档「JSON 字段形状」) */
type WorkflowPayload = {
	name?: string;
	/** 状态:`value` 落库 / 边引用,`label` 展示名 */
	statuses: WorkflowStatus[];
	initial: string;
	edges: { from: string; to: string; who: string[]; via: "direct" | "action" }[];
};

/** 成员角色 —— `tc_member.role` 的两种取值 */
const MEMBER_ROLES = ["participant", "executor"] as const;
/** 还活着、占着锁的 action 状态(`active` = 待答复,`queued` = 串行链中排队):有这些就说明任务被锁 */
const LIVE_ACTION_STATUS = ["active", "queued"] as const;
/** 成员角色入参(`MEMBER_ROLES` 的 zod 形态) */
const ROLE_ENUM = z.enum(MEMBER_ROLES);
/** 任务 id / 动作 id 都是 varchar(191)(nanoid),入参统一按这个长度校验 */
const ID = z.string().min(1).max(191);

/** `who` 协议合法值(`creator` / `participant` / `executor`)—— 编辑模板时的可选项 */
const WHO_ENUM = z.enum(["creator", "participant", "executor"]);

/** 状态图模板的编辑入参(`name` 与三个结构一起进 `tc_workflow.payload`) */
const workflowInput = z.object({
	name: z.string().min(1, "模板名称不能为空").max(100),
	statuses: z
		.array(
			z.object({
				value: z.string().min(1).max(32),
				label: z.string().min(1).max(32),
				terminal: z.boolean().optional(),
			}),
		)
		.min(1, "至少要有 1 个状态")
		.max(30),
	initial: z.string().min(1).max(32),
	edges: z
		.array(
			z.object({
				from: z.string().min(1).max(32),
				to: z.string().min(1).max(32),
				who: z.array(WHO_ENUM).min(1, "每条边至少选 1 个可发起角色").max(3),
				via: z.enum(["direct", "action"]),
			}),
		)
		.max(200),
});

/**
 * 校验并规范化模板定义 —— 返回可整份写进 `payload` 的 `WorkflowPayload`。
 *
 * 三道校验与前端编辑器同一套口径(服务端为准):初始态必须在状态集合里、每条边两端都要是已知状态。
 * 状态去空去重、边的顺序保留,`name` 去掉首尾空格。
 */
function normalizeWorkflow(input: z.infer<typeof workflowInput>): WorkflowPayload {
	// 状态按 `value` 去重(保留首次出现的顺序与 label);同一 value 重复只留第一条
	const values = new Set<string>();
	const statuses: WorkflowStatus[] = [];
	for (const item of input.statuses) {
		const value = item.value.trim();
		if (!value || values.has(value)) continue;
		values.add(value);
		statuses.push({ value, label: item.label.trim(), ...(item.terminal ? { terminal: true } : {}) });
	}
	if (statuses.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "至少要有 1 个状态" });
	const initial = input.initial.trim();
	if (!values.has(initial)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: `初始态「${initial}」不在状态集合里` });
	}
	const seen = new Map<string, "direct" | "action">();
	const edges = input.edges.map((edge) => {
		const from = edge.from.trim();
		const to = edge.to.trim();
		if (!values.has(from)) throw new TRPCError({ code: "BAD_REQUEST", message: `转移边引用了未知状态:${from}` });
		if (!values.has(to)) throw new TRPCError({ code: "BAD_REQUEST", message: `转移边引用了未知状态:${to}` });
		// 唯一键是**状态对**(不含 via):同一对 (from,to) 只能一条边 ——
		// 否则 direct + action 并存时两条路都通,「必须经 action」就名存实亡(见 doc/task-close.md)。
		const key = `${from}->${to}`;
		const prev = seen.get(key);
		if (prev) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `同一对状态只能有一条边:${from} → ${to} 已经有一条「${prev === "action" ? "审批动作" : "直接改"}」的边`,
			});
		}
		seen.set(key, edge.via);
		return { from, to, who: [...edge.who], via: edge.via };
	});
	const name = input.name.trim();
	if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "模板名称不能为空" });
	return { name, statuses, initial, edges };
}

// ────────────────────────────── 投影 ──────────────────────────────

/** 列表用的瘦投影 —— **不带 `workflow`**(整份快照,列表里没用) */
const toTaskBrief = (row: TaskRow, creatorName: string | null) => ({
	id: row.id,
	name: row.name,
	/** 卡片页要显示两行摘要;详情与列表共用这一份投影,不另开接口 */
	description: row.description,
	status: row.status,
	creatorId: row.creator_id,
	creatorName,
	dueAt: row.due_at ? row.due_at.toISOString() : null,
	createdAt: row.created_at ? row.created_at.toISOString() : null,
	/** `0` = P0 / `1` = P1 / `2` = P2;老数据为 null,前端兜底 "未设置" */
	priority: row.priority ?? null,
});

/** 详情用的全量投影(含 `workflow` 快照,前端要靠它渲染状态图) */
const toTaskDetail = (row: TaskRow, creatorName: string | null) => ({
	...toTaskBrief(row, creatorName),
	/** 非空 = 这条是子任务,值是父任务 id */
	parentId: row.parent_id ?? null,
	description: row.description,
	payload: row.payload,
	workflow: row.workflow as WorkflowPayload,
	updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
});

const toMember = (row: MemberRow, nameOf: Map<string, string>) => ({
	userId: row.user_id,
	name: nameOf.get(row.user_id) ?? null,
	role: row.role,
});

const toAction = (row: ActionRow, nameOf: Map<string, string>) => ({
	id: row.id,
	taskId: row.task_id,
	rootActionId: row.root_action_id,
	parentActionId: row.parent_action_id,
	isLocking: row.is_locking,
	fromStatus: row.from_status,
	toStatus: row.to_status,
	sequence: row.sequence,
	creatorId: row.creator_id,
	creatorName: nameOf.get(row.creator_id) ?? null,
	assigneeId: row.assignee_id,
	assigneeName: nameOf.get(row.assignee_id) ?? null,
	status: row.status,
	viewedAt: row.viewed_at?.toISOString() ?? null,
	activatedAt: row.activated_at?.toISOString() ?? null,
	lastUrgedAt: row.last_urged_at?.toISOString() ?? null,
	createdAt: row.created_at ? row.created_at.toISOString() : null,
	updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
});

// ────────────────────────────── 取行 / 判定 ──────────────────────────────

const workflowOf = (task: TaskRow): WorkflowPayload => task.workflow as WorkflowPayload;

/** 取一条活着的任务;取不到(含已软删)抛 `NOT_FOUND` —— 读路径都要过 `alive()` */
async function getTaskRow(id: string): Promise<TaskRow> {
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
async function assertAttachments(tx: Tx, attachIds: readonly string[]): Promise<void> {
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

/** 取任务并**锁行**(`for update`)—— 事务内改状态前必须走它,否则并发下会丢转移 */
async function lockTask(tx: Tx, id: string): Promise<TaskRow> {
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
async function assertCanManage(task: TaskRow, meId: string) {
	if (task.creator_id !== meId && !(await isAdminUser(meId))) {
		throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建者或管理员能做这个操作" });
	}
}

/** 任务相关方:创建者 / 管理员 / 已在 `tc_member` 里的人。本模块「能看、能参与」的统一判据。 */
async function isTaskParticipant(task: TaskRow, meId: string, reader: Reader = db): Promise<boolean> {
	if (task.creator_id === meId) return true;
	if (await isAdminUser(meId)) return true;
	return (await memberRolesOf(task.id, meId, reader)).length > 0;
}

/**
 * 「任务相关方」守卫 —— 用于**不是** `assertCanManage` 那档、但也不该对陌生人开放的操作
 * (加成员、看填报、导出)。各调用点自带消息,便于前端区分。
 *
 */
async function assertTaskParticipant(task: TaskRow, meId: string, message: string): Promise<void> {
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

async function assertTaskReadable(task: TaskRow, meId: string): Promise<void> {
	if (!(await isTaskReadable(task, meId))) throw new TRPCError({ code: "FORBIDDEN", message: "无权查看这条任务" });
}

/** 这个人在这条任务上通过 `tc_member` 拿到的角色(不含 creator —— 那个是 `tc_task` 固有列) */
async function memberRolesOf(taskId: string, userId: string, reader: Reader = db): Promise<string[]> {
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
async function whoAllows(
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
async function isLocked(taskId: string, reader: Reader = db): Promise<boolean> {
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

async function cancelLiveTaskActions(tx: Tx, taskId: string, now: Date) {
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
}

/**
 * 取动作并锁行 —— 先探 `task_id`(免全表锁),**先锁任务再锁动作**。
 * 锁顺序与 `taskTransit` 一致,互相之间不会等成死锁。
 */
async function lockAction(tx: Tx, actionId: string): Promise<{ task: TaskRow; action: ActionRow }> {
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
async function getAvailableReportTemplate(tx: Tx, templateId: string, me: { id: string; isSuper?: boolean }) {
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

/** 任务始终使用绑定时的结构快照。 */
async function getTaskReportTemplate(reader: Reader | Tx, task: { report: unknown }) {
	const report = task.report as { reportId?: string; schema?: unknown } | null;
	const reportId = report?.reportId;
	if (!reportId) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报模板引用" });
	const [template] = await reader
		.select({ id: taskReportTemplateTable.id })
		.from(taskReportTemplateTable)
		.where(eq(taskReportTemplateTable.id, reportId))
		.limit(1);
	if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "填报模板不存在" });
	const schema = taskReportSchema.parse(report?.schema);
	return { id: template.id, schema };
}

/** 填报的「数据范围」:子任务按 `tc_task.report.filter` 过滤;父任务(无 filter)= 全部行。 */
type ScopeFilter = Array<{ field: string; value: unknown }>;

/** 任务行上的数据范围。子任务带 filter,父任务没有(没有就是全部行)。 */
function scopeFilterOf(task: { report: unknown }): ScopeFilter {
	const report = (task.report ?? null) as { filter?: ScopeFilter } | null;
	return Array.isArray(report?.filter) ? report.filter : [];
}

/** 一行是否落在范围内(规则 = 一组 field=value 的 AND;无规则 = 全部行)。 */
function rowInScope(row: unknown, filter: ScopeFilter): boolean {
	if (filter.length === 0) return true;
	if (!row || typeof row !== "object") return false;
	const record = row as Record<string, unknown>;
	return filter.every((condition) => (record[condition.field] ?? null) === condition.value);
}

/** 两组 AND 条件只有在同一字段要求不同值时才互斥。 */
function scopesOverlap(a: ScopeFilter, b: ScopeFilter): boolean {
	return !a.some((left) => b.some((right) => left.field === right.field && left.value !== right.value));
}

/**
 * 任务树(根 + 它的全部子任务)。
 *
 * 内容区只合并当前用户可读的任务，避免子任务成员看到父任务或兄弟任务的私有内容。
 */
async function familyTasks(task: TaskRow, userId: string): Promise<TaskRow[]> {
	const rootId = task.parent_id ?? task.id;
	const rows = await db
		.select()
		.from(taskTable)
		.where(and(or(eq(taskTable.id, rootId), eq(taskTable.parent_id, rootId)), alive(taskTable)))
		.orderBy(asc(taskTable.created_at));
	if (await isAdminUser(userId)) return rows;
	const memberships = await db
		.select({ taskId: taskMemberTable.task_id })
		.from(taskMemberTable)
		.where(
			and(
				eq(taskMemberTable.user_id, userId),
				inArray(
					taskMemberTable.task_id,
					rows.map((row) => row.id),
				),
			),
		);
	const memberIds = new Set(memberships.map((row) => row.taskId));
	const root = rows.find((row) => row.id === rootId);
	const canReadRoot = root && (root.creator_id === userId || memberIds.has(root.id));
	return rows.filter(
		(row) => row.creator_id === userId || memberIds.has(row.id) || (row.parent_id === rootId && canReadRoot),
	);
}

/** 一批 user_id → 姓名。分批查 + 内存拼(项目现有风格,不引入 leftJoin) */
async function nameMapOf(ids: readonly string[]): Promise<Map<string, string>> {
	const unique = [...new Set(ids.filter(Boolean))];
	if (unique.length === 0) return new Map();
	const rows = await db.select({ id: sysUser.id, name: sysUser.name }).from(sysUser).where(inArray(sysUser.id, unique));
	return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * 一批 task_id → 执行人姓名 —— **卡面「发给谁」的来源**。
 *
 * 执行人挂在 `tc_member`(role=executor),不在任务行上:fan-out 时一条子任务 = 一名执行人,
 * 光看 `creator_id` 全都一样(都是派活的人),分不出发给谁。每个任务至多一名执行人。
 */
async function executorNamesOf(taskIds: readonly string[]): Promise<Map<string, string>> {
	if (taskIds.length === 0) return new Map();
	const rows = await db
		.select({
			taskId: taskMemberTable.task_id,
			userId: taskMemberTable.user_id,
		})
		.from(taskMemberTable)
		.where(and(inArray(taskMemberTable.task_id, taskIds), eq(taskMemberTable.role, "executor")))
		.orderBy(asc(taskMemberTable.created_at));
	const names = await nameMapOf(rows.map((row) => row.userId));
	const map = new Map<string, string>();
	for (const row of rows) {
		const name = names.get(row.userId);
		if (name && !map.has(row.taskId)) map.set(row.taskId, name);
	}
	return map;
}

/** 只接收任务成员的结构化 ID；评论与通知同事务提交。 */
async function createMentionNotifications(
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

function publishMentions(receivers: readonly string[]) {
	for (const userId of receivers) publish({ channel: `notice:${userId}`, name: "notice.new", data: {} });
}

/** 在任务行锁内推进串行节点；未激活节点不会产生待办或通知。 */
async function activateNextAction(tx: Tx, task: TaskRow, action: ActionRow, now: Date) {
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
function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	const bag = value as Record<string, unknown>;
	const body = Object.keys(bag)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(bag[key])}`)
		.join(",");
	return `{${body}}`;
}

const hashReportRows = (rows: unknown) => createHash("sha256").update(stableJson(rows)).digest("hex");

/** `tc_log.detail` 是 JSON 列,读出来可能是任何东西 —— 当袋子读,读不到就当空(绝不抛) */
function detailOf(detail: unknown): Record<string, unknown> {
	return detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {};
}

/**
 * 写一行活动日志(`tc_log`)—— **必须传当前事务的 `tx`**:它与业务同生共死。
 *
 * ⚠️ 与 `lib/audit.ts` 的 `writeAudit` **故意相反**:那个是 fire-and-forget、"审计绝不拖累业务";
 * 这个**不吞错、不旁路** —— 业务成功就一定有历史,业务回滚历史也一起没(状态变了却没有留痕,
 * 正是本需求要消灭的东西)。别"顺手"改成 `void`。
 *
 * 两个状态列的口径:**事件前后的任务状态**,没动状态就传 null(「想去哪」放 `detail.intendedTo`)。
 */
async function logTaskEvent(
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

/**
 * `tc_task.payload` 写入前的统一闸口:规范化 + **附件 id 必须真存在且已确认**。
 *
 * 与 `assertAttachments` 同判据(`sys_file.status = 1`,待确认 / 已删除都不算)。
 * 为什么创建 / 编辑路径也要验:`attachmentUrl` 的归属守卫是「fileId 出现在任务 payload 或评论里」——
 * 只要 payload 能塞任意 id,任何人就能靠 `commentCreate([任意fileId])` 之外再开一扇门。
 */
async function prepareTaskPayload(
	tx: Tx,
	payload: Parameters<typeof normalizePayload>[0],
): Promise<ReturnType<typeof normalizePayload>> {
	const normalized = normalizePayload(payload);
	await assertAttachments(tx, normalized?.attachments ?? []);
	return normalized;
}

/** 独立任务的共同创建路径；父任务 / 子任务(fan-out)与单任务共享快照、成员与日志语义。 */
async function insertTask(
	tx: Tx,
	input: {
		id: string;
		name: string;
		description?: string | null;
		dueAt?: Date | null;
		priority?: number | null;
		workflowId: string;
		workflow: WorkflowPayload;
		payload?: Parameters<typeof normalizePayload>[0];
		members: Array<{ userId: string; role: "participant" | "executor" }>;
		/** 父子填报:父任务传 `{ reportId }`,子任务传 `{ reportId, filter }` */
		report?: {
			reportId: string;
			schema: z.infer<typeof taskReportSchema>;
			filter?: ScopeFilter;
			baseHash?: string;
		} | null;
		/** 父任务 id(fan-out 时子任务指向父) */
		parentId?: string | null;
		/** 母版表格行(父任务 / 单任务);为空数组或未传 = 空表 */
		masterRows?: Array<Record<string, unknown>>;
	},
	actor: { id: string; name: string },
) {
	const now = new Date();
	const payload = await prepareTaskPayload(tx, input.payload);
	await tx.insert(taskTable).values({
		id: input.id,
		name: input.name.trim(),
		description: input.description?.trim() || null,
		status: input.workflow.initial,
		creator_id: actor.id,
		due_at: input.dueAt ?? null,
		priority: input.priority ?? null,
		payload,
		workflow: input.workflow,
		// 模板来源,「我的任务」按流程筛选用;旧任务(v1 前)没有这一列的值
		workflow_id: input.workflowId,
		parent_id: input.parentId ?? null,
		report: input.report ?? null,
		created_at: now,
		updated_at: now,
	});
	const members = input.members.map((member) => ({
		id: newId(),
		task_id: input.id,
		user_id: member.userId,
		role: member.role,
		created_at: now,
		updated_at: now,
	}));
	if (members.length) await tx.insert(taskMemberTable).values(members);
	await logTaskEvent(tx, {
		taskId: input.id,
		event: "task.create",
		actor,
		toStatus: input.workflow.initial,
		detail: {
			workflowId: input.workflowId,
			members: members.map((member) => ({
				userId: member.user_id,
				role: member.role,
			})),
		},
		at: now,
	});
}

/** 从 JSON 列里取附件 id 列表(容错:脏数据 / 老形状都退化成空数组,不抛) */
function attachmentIdsOf(payload: unknown): string[] {
	const attachments = (payload as { attachments?: unknown } | null)?.attachments;
	return Array.isArray(attachments) ? attachments.filter((id): id is string => typeof id === "string") : [];
}

/**
 * 附件 id 列表 → 详情(join `sys_file`)。
 *
 * 与 `commentList` 同一口径:**只取还活着的文件**(`status = 1`),拿不到的 id 直接丢掉(不留空行);
 * 顺序按入参排(附件是有序的)。字节在 MinIO,这里只回元数据。
 */
async function resolveAttachments(ids: readonly string[]) {
	const uniq = [...new Set(ids.filter(Boolean))];
	if (uniq.length === 0) return [];
	const rows = await db
		.select({
			id: sysFile.id,
			name: sysFile.origin_name,
			size: sysFile.size,
			contentType: sysFile.content_type,
		})
		.from(sysFile)
		.where(and(inArray(sysFile.id, uniq), eq(sysFile.status, 1)));
	const byId = new Map(rows.map((row) => [row.id, row]));
	return uniq.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => row !== undefined);
}

/**
 * 「我能做什么」—— **服务端算好下发**,前端不再自己解释 `who` / `edges`。
 *
 * 这是把授权口径收在一处的关键:同一份判定,详情页 / 按钮禁用 / 后端拒绝三处用同一段代码,
 * 不会出现「前端显示能点、后端 403」。
 */
async function permissionsOf(task: TaskRow, meId: string) {
	const isCreator = task.creator_id === meId;
	/** 「系统管理员」—— 什么都可以(见 `doc/task-close.md` 权限矩阵);与写路径的 `assertCanManage` 同判据 */
	const isAdmin = await isAdminUser(meId);
	const memberRoles = await memberRolesOf(task.id, meId);
	const myRoles = [...(isAdmin ? ["admin"] : []), ...(isCreator ? ["creator"] : []), ...memberRoles];

	const transitions: string[] = [];
	/** 我能发起的「改状态」action 的目标状态(前端「发起审批」弹窗的候选项)—— 模板里枚举好的 `via=action` 边 */
	const actionTargets: string[] = [];
	let canInitiateStatusAction = false;
	const locked = await isLocked(task.id);
	for (const edge of workflowOf(task).edges ?? []) {
		if (locked) break;
		if (edge.from !== task.status) continue;
		// 管理员不受 `who` 限制:当前状态能走的边他都能走
		if (!isAdmin && !(await whoAllows(task, meId, edge.who ?? [], memberRoles))) continue;
		if (edge.via === "direct") transitions.push(edge.to);
		else {
			canInitiateStatusAction = true;
			actionTargets.push(edge.to);
		}
	}

	return {
		/** 是否「系统管理员」—— 前端按钮矩阵的最高一档 */
		isAdmin,
		isCreator,
		myRoles,
		/** 任务当前是否被未完成的审批动作锁住 —— 锁定期谁都改不了状态(前端据此把按钮禁掉) */
		locked,
		/** 我能**直接**改到的状态 */
		transitions,
		/** 我能发起「改状态」action 的目标状态(可空;多个时前端让用户选) */
		actionTargets,
		/** 我能发起「改状态」的 action */
		canInitiateStatusAction,
		/** 我能发起「不改状态」的 action(征询)—— creator / participant / executor / admin */
		canInitiateConsult:
			myRoles.length > 0 &&
			!workflowOf(task).statuses.some((status) => status.value === task.status && status.terminal),
		/** 加成员:创建者 / 管理员 / 当前成员 —— 与 `memberAdd` 的 `assertTaskParticipant` 同一判据 */
		canAddMember: isAdmin || isCreator || memberRoles.length > 0,
		/** 移出成员:创建者或管理员 */
		canManageMembers: isAdmin || isCreator,
		canUpdate: isAdmin || isCreator,
		canRemove: isAdmin || isCreator,
	};
}

/**
 * 取一个**当前用户可见**的填报模板(建任务前按模板下载 / 解析 Excel 用)。
 * 可见性与 `reportTemplateList` 同口径:shared = 1 或本人创建;管理员全量;软删的不可用。
 */
async function getVisibleReportTemplate(me: { id: string; isSuper?: boolean }, templateId: string) {
	const isAdmin = me.isSuper === true || (await isAdminUser(me.id));
	const [template] = await db
		.select()
		.from(taskReportTemplateTable)
		.where(
			and(
				eq(taskReportTemplateTable.id, templateId),
				alive(taskReportTemplateTable),
				...(isAdmin ? [] : [or(eq(taskReportTemplateTable.shared, 1), eq(taskReportTemplateTable.creator_id, me.id))]),
			),
		)
		.limit(1);
	if (!template) throw new TRPCError({ code: "FORBIDDEN", message: "无权使用该填报模板" });
	return { ...template, schema: taskReportSchema.parse(template.payload) };
}

const pageInput = {
	page: z.number().int().min(1).optional(),
	pageSize: z.number().int().min(1).max(100).optional(),
};

export const taskCloseRouter = createTRPCRouter({
	/**
	 * 生成 Excel:任务视角(`taskId`)导出该任务填报的模版 / 数据;
	 * 模板视角(`reportId`)在建任务前先拿模版填数据(只出空模版)。
	 */
	reportExcelDownload: protectedProcedure
		.input(
			z.object({
				taskId: ID.optional(),
				reportId: ID.optional(),
				templateOnly: z.boolean().default(true),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			if (!!input.taskId === !!input.reportId)
				throw new TRPCError({ code: "BAD_REQUEST", message: "必须且只能指定任务或填报模板" });
			if (input.reportId) {
				const template = await getVisibleReportTemplate(me, input.reportId);
				return { fileBase64: createReportWorkbook(template.schema).toString("base64") };
			}
			const task = await getTaskRow(input.taskId ?? "");
			await assertTaskParticipant(task, me.id, "无权导出填报");
			const [own] = await db.select().from(taskReportTable).where(eq(taskReportTable.task_id, task.id)).limit(1);
			if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报" });
			const template = await getTaskReportTemplate(db, task);
			// 每个任务导出自己那份草稿(子任务是下发时复制出来的那份)
			return {
				fileBase64: createReportWorkbook(template.schema, input.templateOnly ? undefined : own.draft).toString(
					"base64",
				),
			};
		}),
	/** 解析上传的 Excel:任务视角校验填报可编辑;模板视角只校验模板可见(建任务前用)。 */
	reportExcelPreview: protectedProcedure
		.input(
			z.object({
				taskId: ID.optional(),
				reportId: ID.optional(),
				fileBase64: z.string().max(7_000_000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			if (!!input.taskId === !!input.reportId)
				throw new TRPCError({ code: "BAD_REQUEST", message: "必须且只能指定任务或填报模板" });
			try {
				if (input.reportId) {
					const template = await getVisibleReportTemplate(me, input.reportId);
					return await previewReportWorkbook(template.schema, input.fileBase64);
				}
				const task = await getTaskRow(input.taskId ?? "");
				const members = await db
					.select({ userId: taskMemberTable.user_id, role: taskMemberTable.role })
					.from(taskMemberTable)
					.where(eq(taskMemberTable.task_id, task.id));
				const executor = members.some((member) => member.userId === me.id && member.role === "executor");
				const isCreator = task.creator_id === me.id;
				if (!executor && !isCreator)
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以导入" });
				const [report] = await db.select().from(taskReportTable).where(eq(taskReportTable.task_id, task.id)).limit(1);
				if (!report) throw new TRPCError({ code: "BAD_REQUEST", message: "没有可编辑的填报" });
				const template = await getTaskReportTemplate(db, task);
				return await previewReportWorkbook(template.schema, input.fileBase64);
			} catch (error) {
				if (error instanceof TRPCError) throw error;
				throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "文件格式无效" });
			}
		}),
	/** 填报模板:创建即发布(单版本,编辑即覆盖 payload)。 */
	reportTemplateCreate: protectedProcedure
		.input(
			z.object({
				name: z.string().trim().min(1).max(255),
				payload: taskReportSchema,
				shared: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const id = newId();
			await db.insert(taskReportTemplateTable).values({
				id,
				name: input.name,
				creator_id: me.id,
				payload: input.payload,
				shared: input.shared ? 1 : 0,
			});
			return { id };
		}),
	reportTemplatePublish: protectedProcedure
		.input(
			z.object({
				id: ID,
				name: z.string().trim().min(1).max(255).optional(),
				payload: taskReportSchema,
				shared: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const admin = await isAdminUser(me.id);
			return db.transaction(async (tx) => {
				const [template] = await tx
					.select()
					.from(taskReportTemplateTable)
					.where(and(eq(taskReportTemplateTable.id, input.id), alive(taskReportTemplateTable)))
					.limit(1)
					.for("update");
				if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "模板不存在" });
				if (template.creator_id !== me.id && !admin)
					throw new TRPCError({ code: "FORBIDDEN", message: "只有模板创建人或管理员可以发布" });
				await tx
					.update(taskReportTemplateTable)
					.set({
						name: input.name ?? template.name,
						payload: input.payload,
						shared: input.shared === undefined ? template.shared : input.shared ? 1 : 0,
						updated_at: new Date(),
					})
					.where(eq(taskReportTemplateTable.id, input.id));
				return { id: input.id };
			});
		}),
	reportTemplateRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const admin = await isAdminUser(me.id);
		await db.transaction(async (tx) => {
			const [template] = await tx
				.select()
				.from(taskReportTemplateTable)
				.where(and(eq(taskReportTemplateTable.id, input.id), alive(taskReportTemplateTable)))
				.limit(1)
				.for("update");
			if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "模板不存在" });
			if (template.creator_id !== me.id && !admin)
				throw new TRPCError({ code: "FORBIDDEN", message: "只有模板创建人或管理员可以删除" });
			// 软删:已绑定任务的历史填报仍读得到 payload,只是不能再用于新任务/绑定
			await tx.update(taskReportTemplateTable).set(softDeleted()).where(eq(taskReportTemplateTable.id, input.id));
		});
		return { ok: true };
	}),
	reportTemplateList: protectedProcedure.query(async ({ ctx }) => {
		const me = requireCurrentUser(ctx);
		const isAdmin = me.isSuper === true || (await isAdminUser(me.id));
		// 可见性:shared = 1 全员可见,0 仅创建人;管理员始终全量;软删的不出现
		const templates = await db
			.select()
			.from(taskReportTemplateTable)
			.where(
				isAdmin
					? alive(taskReportTemplateTable)
					: and(
							alive(taskReportTemplateTable),
							or(eq(taskReportTemplateTable.shared, 1), eq(taskReportTemplateTable.creator_id, me.id)),
						),
			)
			.orderBy(desc(taskReportTemplateTable.created_at));
		return templates.map((template) => ({
			...template,
			canManage: isAdmin || template.creator_id === me.id,
		}));
	}),
	/**
	 * 给**还没有填报**的任务首次绑定模板。
	 *
	 * 模板在创建任务时就定了:已绑定(或已有填报行)的任务一律不能再换、也不能移除 ——
	 * 「结构化填报实时保存」意味着换模板等于丢数据,不做这种入口。
	 */
	reportBind: protectedProcedure.input(z.object({ taskId: ID, reportId: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const admin = await isAdminUser(me.id);
		return db.transaction(async (tx) => {
			const task = await lockTask(tx, input.taskId);
			if (task.creator_id !== me.id && !admin)
				throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或管理员可以配置填报" });
			if (task.parent_id) throw new TRPCError({ code: "BAD_REQUEST", message: "子任务不能单独绑定填报模板" });
			const [child] = await tx
				.select({ id: taskTable.id })
				.from(taskTable)
				.where(and(eq(taskTable.parent_id, task.id), alive(taskTable)))
				.limit(1);
			if (child) throw new TRPCError({ code: "BAD_REQUEST", message: "已分派的任务不能再绑定填报模板" });
			const [existing] = await tx
				.select()
				.from(taskReportTable)
				.where(eq(taskReportTable.task_id, task.id))
				.limit(1)
				.for("update");
			if (existing)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "填报模板在创建任务时确定，不能更换或移除",
				});
			const template = await getAvailableReportTemplate(tx, input.reportId, me);
			const schema = template.schema;
			const initial =
				schema.kind === "OBJECT"
					? Object.fromEntries(
							schema.fields
								.filter((field) => field.defaultValue !== undefined)
								.map((field) => [field.id, field.defaultValue]),
						)
					: [];
			const id = newId();
			await tx.insert(taskReportTable).values({ id, task_id: task.id, draft: initial, revision: 0 });
			await tx
				.update(taskTable)
				.set({ report: { reportId: template.id, schema: template.schema }, updated_at: new Date() })
				.where(eq(taskTable.id, task.id));
			await logTaskEvent(tx, {
				taskId: task.id,
				event: "report.bind",
				actor: me,
				targetId: id,
				detail: { reportId: template.id },
			});
			return { id };
		});
	}),
	reportGet: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.taskId);
		await assertTaskParticipant(task, me.id, "无权查看填报");
		const [own] = await db.select().from(taskReportTable).where(eq(taskReportTable.task_id, task.id)).limit(1);
		if (!own) return null;
		// 模板引用在任务的 report 规则里(单版本:模板 payload 即当前结构)
		const template = await getTaskReportTemplate(db, task);
		const members = await db
			.select({ userId: taskMemberTable.user_id, role: taskMemberTable.role })
			.from(taskMemberTable)
			.where(eq(taskMemberTable.task_id, task.id));
		const executor = members.some((member) => member.userId === me.id && member.role === "executor");
		const isCreator = task.creator_id === me.id;
		return {
			/** 每个任务读**自己那份**草稿(子任务是下发时复制出来的),互不加锁 */
			report: own,
			template,
			canEdit: executor || isCreator,
			/** 子任务才能把本任务的行同步回父任务;父任务自己就是数据源 */
			canSyncToParent: task.parent_id !== null && template.schema.kind === "TABLE",
		};
	}),
	reportSaveDraft: protectedProcedure
		.input(z.object({ taskId: ID, revision: z.number().int().min(0), draft: z.json() }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			if (JSON.stringify(input.draft).length > 2_000_000)
				throw new TRPCError({ code: "BAD_REQUEST", message: "填报数据过大" });
			return db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				const members = await tx
					.select({ userId: taskMemberTable.user_id, role: taskMemberTable.role })
					.from(taskMemberTable)
					.where(eq(taskMemberTable.task_id, task.id));
				const executor = members.some((member) => member.userId === me.id && member.role === "executor");
				const isCreator = task.creator_id === me.id;
				if (!executor && !isCreator)
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以填写" });
				// 每个任务只写**自己那一行**:子任务是下发时复制出来的独立副本,父子互不加锁
				const [own] = await tx
					.select()
					.from(taskReportTable)
					.where(eq(taskReportTable.task_id, task.id))
					.limit(1)
					.for("update");
				if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报" });
				if (own.revision !== input.revision)
					throw new TRPCError({ code: "CONFLICT", message: "填报已被修改，请刷新后重试" });
				const template = await getTaskReportTemplate(tx, task);
				const schema = template.schema;
				const rows = schema.kind === "TABLE" ? input.draft : [input.draft];
				if (
					!Array.isArray(rows) ||
					rows.length > 10000 ||
					rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
				)
					throw new TRPCError({ code: "BAD_REQUEST", message: "填报格式无效" });
				const issues = schema.kind === "TABLE" && rows.length === 0 ? [] : validateTaskReport(schema, input.draft);
				if (issues.length) throw new TRPCError({ code: "BAD_REQUEST", message: `填报数据无效: ${issues[0].message}` });
				if (task.parent_id && schema.kind === "TABLE" && rows.some((row) => !rowInScope(row, scopeFilterOf(task))))
					throw new TRPCError({ code: "BAD_REQUEST", message: "填报数据不能超出分派范围" });
				for (const row of rows)
					for (const field of schema.fields.filter((f) => f.readOnly)) {
						if (
							stableJson((row as Record<string, unknown>)[field.id] ?? null) !== stableJson(field.defaultValue ?? null)
						)
							throw new TRPCError({ code: "BAD_REQUEST", message: `只读字段不可修改:${field.label}` });
					}
				const next: unknown = schema.kind === "TABLE" ? rows : rows[0];
				await tx
					.update(taskReportTable)
					.set({ draft: next, revision: own.revision + 1, updated_at: new Date() })
					.where(eq(taskReportTable.id, own.id));
				return { revision: own.revision + 1 };
			});
		}),

	/**
	 * **把本子任务的行同步到父任务**(手动「保存」才触发)。
	 *
	 * 父子各存一份副本。确认父任务对应范围没有变化后，用子任务数据替换该范围。
	 */
	reportSyncToParent: protectedProcedure.input(z.object({ taskId: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		return db.transaction(async (tx) => {
			const task = await lockTask(tx, input.taskId);
			if (!task.parent_id) throw new TRPCError({ code: "BAD_REQUEST", message: "只有子任务可以同步到父任务" });
			const members = await tx
				.select({ userId: taskMemberTable.user_id, role: taskMemberTable.role })
				.from(taskMemberTable)
				.where(eq(taskMemberTable.task_id, task.id));
			const executor = members.some((member) => member.userId === me.id && member.role === "executor");
			if (task.creator_id !== me.id && !executor)
				throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以同步" });
			const template = await getTaskReportTemplate(tx, task);
			if (template.schema.kind !== "TABLE")
				throw new TRPCError({ code: "BAD_REQUEST", message: "只有表格形式填报可以同步到父任务" });

			// 锁两行,先子后父(固定顺序,避免和别的写路径互相等)
			const [own] = await tx
				.select()
				.from(taskReportTable)
				.where(eq(taskReportTable.task_id, task.id))
				.limit(1)
				.for("update");
			if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报" });
			const [parent] = await tx
				.select()
				.from(taskReportTable)
				.where(eq(taskReportTable.task_id, task.parent_id))
				.limit(1)
				.for("update");
			if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "父任务没有填报" });

			const filter = scopeFilterOf(task);
			const mine = Array.isArray(own.draft) ? own.draft : [];
			const parentRows = Array.isArray(parent.draft) ? parent.draft : [];
			// 父任务:先拿掉我这份切片(我原来范围里的行),再把我现在的行接上去
			const reportConfig = task.report as { baseHash?: string } | null;
			const parentSlice = parentRows.filter((row) => rowInScope(row, filter));
			if (reportConfig?.baseHash !== hashReportRows(parentSlice))
				throw new TRPCError({ code: "CONFLICT", message: "父任务的对应数据已修改，请重新载入后再填写" });
			if (mine.some((row) => !rowInScope(row, filter)))
				throw new TRPCError({ code: "BAD_REQUEST", message: "填报数据不能超出分派范围" });
			const nextParentRows = [...parentRows.filter((row) => !rowInScope(row, filter)), ...mine];
			const now = new Date();
			await tx
				.update(taskReportTable)
				.set({ draft: nextParentRows, revision: parent.revision + 1, updated_at: now })
				.where(eq(taskReportTable.id, parent.id));
			await tx
				.update(taskTable)
				.set({ report: { ...(task.report as object), baseHash: hashReportRows(mine) } })
				.where(eq(taskTable.id, task.id));
			await logTaskEvent(tx, {
				taskId: task.id,
				event: "report.sync",
				actor: me,
				detail: {
					parentTaskId: task.parent_id,
					pushed: mine.length,
					summary: `同步 ${mine.length} 行到父任务`,
				},
			});
			return { pushed: mine.length };
		});
	}),
	reportResetFromParent: protectedProcedure
		.input(z.object({ taskId: ID, revision: z.number().int().min(0) }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			return db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				if (!task.parent_id) throw new TRPCError({ code: "BAD_REQUEST", message: "只有子任务可以重新载入" });
				const roles = await memberRolesOf(task.id, me.id, tx);
				if (task.creator_id !== me.id && !roles.includes("executor"))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以重新载入" });
				if ((await getTaskReportTemplate(tx, task)).schema.kind !== "TABLE")
					throw new TRPCError({ code: "BAD_REQUEST", message: "只有表格填报可以重新载入" });
				const [own] = await tx
					.select()
					.from(taskReportTable)
					.where(eq(taskReportTable.task_id, task.id))
					.limit(1)
					.for("update");
				if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报" });
				if (own.revision !== input.revision)
					throw new TRPCError({ code: "CONFLICT", message: "填报已被修改，请刷新后重试" });
				const [parent] = await tx
					.select()
					.from(taskReportTable)
					.where(eq(taskReportTable.task_id, task.parent_id))
					.limit(1)
					.for("update");
				if (!parent || !Array.isArray(parent.draft))
					throw new TRPCError({ code: "NOT_FOUND", message: "父任务没有表格填报" });
				const draft = parent.draft.filter((row) => rowInScope(row, scopeFilterOf(task)));
				const revision = own.revision + 1;
				await tx
					.update(taskReportTable)
					.set({ draft, revision, updated_at: new Date() })
					.where(eq(taskReportTable.id, own.id));
				await tx
					.update(taskTable)
					.set({ report: { ...(task.report as object), baseHash: hashReportRows(draft) } })
					.where(eq(taskTable.id, task.id));
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "report.reset",
					actor: me,
					detail: { parentTaskId: task.parent_id },
				});
				return { draft, revision };
			});
		}),
	// ────────────────────────────── 状态图模板 ──────────────────────────────

	/**
	 * 模板清单(`tc_workflow`)—— 既给「建任务」选模板,也给「流程模板」卡片页。
	 *
	 * **刻意不锁到流程模板页面码**:建任务弹窗与「我的任务」卡片页都在用它,锁到 `/task-close/workflows`
	 * 会把「有任务页、没模板页」的人拦死(见 `lib/rbac.ts` 的 `UNMAPPED_QUERIES` 说明)。
	 * `builtin` 由服务端标好(内置模板前端不出「删除」),省得前端认 id。
	 */
	workflowList: protectedProcedure.query(async () => {
		const rows = await db
			.select()
			.from(taskWorkflowTable)
			.where(alive(taskWorkflowTable))
			.orderBy(asc(taskWorkflowTable.created_at));
		return rows.map((row: WorkflowRow) => ({
			id: row.id,
			name: (row.payload as WorkflowPayload).name ?? row.id,
			payload: row.payload as WorkflowPayload,
			builtin: row.id === DEFAULT_WORKFLOW_ID,
			createdAt: row.created_at ? row.created_at.toISOString() : null,
			updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
		}));
	}),

	/** 模板详情(流程模板页的「详情」弹窗)—— 结构与 `payload` 摊平,前端不必再解 JSON */
	workflowGet: protectedProcedure.input(z.object({ id: ID })).query(async ({ input }) => {
		const [row] = await db
			.select()
			.from(taskWorkflowTable)
			.where(and(eq(taskWorkflowTable.id, input.id), alive(taskWorkflowTable)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "流程模板不存在" });
		const payload = row.payload as WorkflowPayload;
		return {
			id: row.id,
			name: payload.name ?? row.id,
			statuses: payload.statuses ?? [],
			initial: payload.initial,
			edges: payload.edges ?? [],
			builtin: row.id === DEFAULT_WORKFLOW_ID,
			createdAt: row.created_at ? row.created_at.toISOString() : null,
			updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
		};
	}),

	/** 新建模板 —— 校验后整份写进 `payload` */
	workflowCreate: protectedProcedure.input(workflowInput).mutation(async ({ input }) => {
		const id = newId();
		const now = new Date();
		await db.insert(taskWorkflowTable).values({
			id,
			payload: normalizeWorkflow(input),
			created_at: now,
			updated_at: now,
		});
		return { id };
	}),

	/**
	 * 编辑模板 —— 整份替换 `payload`。
	 *
	 * **已建任务不受影响**:它们的状态图是创建时从 `payload` 复制的快照(`tc_task.workflow`)。
	 */
	workflowUpdate: protectedProcedure.input(workflowInput.extend({ id: ID })).mutation(async ({ input }) => {
		const [row] = await db
			.select({ id: taskWorkflowTable.id })
			.from(taskWorkflowTable)
			.where(and(eq(taskWorkflowTable.id, input.id), alive(taskWorkflowTable)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "流程模板不存在" });
		await db
			.update(taskWorkflowTable)
			.set({ payload: normalizeWorkflow(input), updated_at: new Date() })
			.where(eq(taskWorkflowTable.id, row.id));
		return { ok: true };
	}),

	/**
	 * 软删模板 —— **内置默认模板不允许删**(删光了建任务就没模板可选)。
	 * 已建任务存的是快照,删模板不影响它们推进。
	 */
	workflowRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ input }) => {
		if (input.id === DEFAULT_WORKFLOW_ID) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "内置默认模板不能删除" });
		}
		const [row] = await db
			.select({ id: taskWorkflowTable.id })
			.from(taskWorkflowTable)
			.where(and(eq(taskWorkflowTable.id, input.id), alive(taskWorkflowTable)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "流程模板不存在" });
		await db
			.update(taskWorkflowTable)
			.set({ ...softDeleted(), updated_at: new Date() })
			.where(eq(taskWorkflowTable.id, row.id));
		return { ok: true };
	}),

	// ────────────────────────────── 任务 ──────────────────────────────

	/**
	 * 任务列表。
	 *
	 * `mine = true` 只看「我创建 + 我是成员」的(走 `tc_task.creator_id` ∪ `tc_member`);
	 * 不传就是全部 —— v1 没有菜单授权,任何登录用户可见(见文件头「可见性 v1 口径」)。
	 */
	taskList: protectedProcedure
		.input(
			z
				.object({
					status: z.string().max(32).optional(),
					/** 按流程模板筛 —— 各模板的状态互不相同,界面用它替代了全局状态筛选 */
					workflowId: z.string().max(191).optional(),
					/** 只看这一时刻之后创建的(页面的时间筛选,开始日按当天零点传入) */
					createdAfter: z.coerce.date().optional(),
					/** 只看这一时刻之前创建的(页面的时间筛选,结束日按当天 23:59:59.999 传入) */
					createdBefore: z.coerce.date().optional(),
					keyword: z.string().max(64).optional(),
					mine: z.boolean().optional(),
					/** 只看「有动作正轮到我处理」的(审批 / 征询的当前处理人是我) */
					pending: z.boolean().optional(),
					...pageInput,
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const page = input?.page ?? 1;
			const pageSize = input?.pageSize ?? 20;

			const conds: (SQL | undefined)[] = [alive(taskTable)];
			if (!(await isAdminUser(me.id))) {
				const memberTaskIds = db
					.select({ id: taskMemberTable.task_id })
					.from(taskMemberTable)
					.where(eq(taskMemberTable.user_id, me.id));
				conds.push(
					or(
						eq(taskTable.creator_id, me.id),
						inArray(taskTable.id, memberTaskIds),
						inArray(taskTable.parent_id, memberTaskIds),
					),
				);
			}
			if (input?.status) conds.push(eq(taskTable.status, input.status));
			if (input?.workflowId) conds.push(eq(taskTable.workflow_id, input.workflowId));
			if (input?.createdAfter) conds.push(gte(taskTable.created_at, input.createdAfter));
			if (input?.createdBefore) conds.push(lte(taskTable.created_at, input.createdBefore));
			if (input?.keyword) conds.push(like(taskTable.name, `%${input.keyword}%`));
			if (input?.mine) {
				conds.push(
					or(
						eq(taskTable.creator_id, me.id),
						inArray(
							taskTable.id,
							db
								.select({ id: taskMemberTable.task_id })
								.from(taskMemberTable)
								.where(eq(taskMemberTable.user_id, me.id)),
						),
					),
				);
			}
			// 「轮到我处理」= 有 active 动作的处理人是我。
			// 前端不再另算一套权限。
			const myPendingTaskIds = () =>
				db
					.select({ id: taskActionTable.task_id })
					.from(taskActionTable)
					.where(and(eq(taskActionTable.assignee_id, me.id), eq(taskActionTable.status, "active")));
			if (input?.pending) conds.push(inArray(taskTable.id, myPendingTaskIds()));
			// 子任务不单独占一行 —— 挂在父任务里(详情页的「子任务」区);
			// 例外:**我在那条子任务里有角色(执行人 / 参与者)**就必须列出来,
			// 否则"参与了却看不到"—— 参与者也要能进自己的活。
			conds.push(
				or(
					isNull(taskTable.parent_id),
					inArray(
						taskTable.id,
						db.select({ id: taskMemberTable.task_id }).from(taskMemberTable).where(eq(taskMemberTable.user_id, me.id)),
					),
				),
			);
			const where = and(...conds);

			// 统计卡与列表**同一筛选口径**(不差分页):四个桶都与流程无关 ——
			// 各模板的状态互不相同,不按状态分桶;「到期」只对设了截止时间的任务有意义
			const now = new Date();
			const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
			const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
			// 「待我处理」:**不受当前筛选影响** —— 它是「现在有什么在等我」,
			// 跟着关键字/日期一起缩水的话,用户永远看不到自己被压了多少活
			const pendingWhere = and(alive(taskTable), inArray(taskTable.id, myPendingTaskIds()));
			const [totalRow, recentRow, dueSoonRow, overdueRow, pendingRow] = await Promise.all([
				db.select({ n: count() }).from(taskTable).where(where),
				db
					.select({ n: count() })
					.from(taskTable)
					.where(and(where, gte(taskTable.created_at, weekAgo))),
				db
					.select({ n: count() })
					.from(taskTable)
					.where(and(where, isNotNull(taskTable.due_at), gte(taskTable.due_at, now), lt(taskTable.due_at, weekLater))),
				db
					.select({ n: count() })
					.from(taskTable)
					.where(and(where, isNotNull(taskTable.due_at), lt(taskTable.due_at, now))),
				db.select({ n: count() }).from(taskTable).where(pendingWhere),
			]);

			const rows = await db
				.select()
				.from(taskTable)
				.where(where)
				.orderBy(desc(taskTable.created_at), desc(taskTable.id))
				.limit(pageSize)
				.offset((page - 1) * pageSize);
			const nameOf = await nameMapOf(rows.map((row) => row.creator_id));
			// 卡面「发给谁」:执行人(挂在 tc_member 上,不在任务行上)
			const executorNameOf = await executorNamesOf(rows.map((row) => row.id));
			// 父任务卡片要显示「N 个子任务」:一次 group by 拿到本页所有父任务的子任务数
			const childCounts = rows.length
				? await db
						.select({ parentId: taskTable.parent_id, n: count() })
						.from(taskTable)
						.where(
							and(
								inArray(
									taskTable.parent_id,
									rows.map((row) => row.id),
								),
								alive(taskTable),
							),
						)
						.groupBy(taskTable.parent_id)
				: [];
			const childCountOf = new Map(childCounts.map((row) => [row.parentId ?? "", Number(row.n ?? 0)]));
			// 卡面「待你处理」标记:本页里有动作轮到我的那几条
			const pendingRows = rows.length
				? await db
						.select({ id: taskActionTable.task_id })
						.from(taskActionTable)
						.where(
							and(
								eq(taskActionTable.assignee_id, me.id),
								eq(taskActionTable.status, "active"),
								inArray(
									taskActionTable.task_id,
									rows.map((row) => row.id),
								),
							),
						)
				: [];
			const pendingSet = new Set(pendingRows.map((row) => row.id));

			return {
				items: rows.map((row) => ({
					...toTaskBrief(row, nameOf.get(row.creator_id) ?? null),
					childCount: childCountOf.get(row.id) ?? 0,
					hasMyAction: pendingSet.has(row.id),
					/** 这条派给谁 —— 卡面顶行显示;没有执行人(fan-out 的父任务是分派容器)时为 null */
					executorName: executorNameOf.get(row.id) ?? null,
				})),
				total: Number(totalRow[0]?.n ?? 0),
				stats: {
					total: Number(totalRow[0]?.n ?? 0),
					recentCreated: Number(recentRow[0]?.n ?? 0),
					dueSoon: Number(dueSoonRow[0]?.n ?? 0),
					overdue: Number(overdueRow[0]?.n ?? 0),
					/** 不受筛选影响 —— 见上面 `pendingWhere` 的注释 */
					pendingMine: Number(pendingRow[0]?.n ?? 0),
				},
			};
		}),

	/** 任务详情:本体 + 成员 + 动作流 + **我能做什么** */
	taskGet: protectedProcedure.input(z.object({ id: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.id);
		// 不是相关方(也不是父任务的参与者)连详情都不给 —— 直接访问 URL 也一样
		await assertTaskReadable(task, me.id);

		const memberRows = await db
			.select()
			.from(taskMemberTable)
			.where(eq(taskMemberTable.task_id, task.id))
			.orderBy(asc(taskMemberTable.created_at));
		const actionRows = await db
			.select()
			.from(taskActionTable)
			.where(eq(taskActionTable.task_id, task.id))
			.orderBy(asc(taskActionTable.created_at));

		const nameOf = await nameMapOf([
			task.creator_id,
			...memberRows.map((row) => row.user_id),
			...actionRows.flatMap((row) => [row.creator_id, row.assignee_id]),
		]);

		// 内容区(块)+ 附件区**按整棵树取并集**:子任务传的附件 / 加的链接,父任务看得到,反之亦然。
		// `own` 那两个只给编辑弹窗用 —— 弹窗存回去的是「这条任务自己的」,不把别人的内容克隆一份。
		const family = await familyTasks(task, me.id);
		const ownLinks = parseBlocks((task.payload as { links?: unknown } | null)?.links);
		const ownAttachments = await resolveAttachments(attachmentIdsOf(task.payload));
		const links = [
			...new Map(
				family
					.flatMap((row) => parseBlocks((row.payload as { links?: unknown } | null)?.links))
					.map((block) => [block.url, block]),
			).values(),
		];
		const attachments = await resolveAttachments(family.flatMap((row) => attachmentIdsOf(row.payload)));

		// 子任务(fan-out 出来的):详情页用卡片列出来,点进去就是那条子任务自己的详情
		const childRows = await db
			.select()
			.from(taskTable)
			.where(and(eq(taskTable.parent_id, task.id), alive(taskTable)))
			.orderBy(asc(taskTable.created_at));
		const childNameOf = await nameMapOf(childRows.map((row) => row.creator_id));
		// 子任务「发给谁」:每条 fan-out 子任务各有一名执行人 —— 卡面要能一眼认出是谁的活
		const childExecutorNameOf = await executorNamesOf(childRows.map((row) => row.id));
		// 子任务也可能再 fan-out 出孙任务:一次 group by 拿到每个子任务自己的子任务数 ——
		// 前端据此分流「点进去是卡片页(还有子任务)还是详情页(叶子)」
		const grandCounts = childRows.length
			? await db
					.select({ parentId: taskTable.parent_id, n: count() })
					.from(taskTable)
					.where(
						and(
							inArray(
								taskTable.parent_id,
								childRows.map((row) => row.id),
							),
							alive(taskTable),
						),
					)
					.groupBy(taskTable.parent_id)
			: [];
		const grandCountOf = new Map(grandCounts.map((row) => [row.parentId ?? "", Number(row.n ?? 0)]));
		const reached = await db
			.select({ status: taskLogTable.to_status, at: min(taskLogTable.created_at).mapWith(taskLogTable.created_at) })
			.from(taskLogTable)
			.where(and(eq(taskLogTable.task_id, task.id), isNotNull(taskLogTable.to_status)))
			.groupBy(taskLogTable.to_status);

		return {
			task: toTaskDetail(task, nameOf.get(task.creator_id) ?? null),
			/** 整棵树并集(只读展示) */
			links,
			attachments,
			/** 这条任务**自己**的内容(编辑 / 附件弹窗回存用,别把兄弟任务的内容克隆过来) */
			own: { links: ownLinks, attachments: ownAttachments },
			children: childRows.map((row) => ({
				...toTaskBrief(row, childNameOf.get(row.creator_id) ?? null),
				childCount: grandCountOf.get(row.id) ?? 0,
				/** 发给谁 —— 一眼看得出这条是给谁干的 */
				executorName: childExecutorNameOf.get(row.id) ?? null,
			})),
			members: memberRows.map((row) => toMember(row, nameOf)),
			actions: actionRows.map((row) => toAction(row, nameOf)),
			reached: reached.map((row) => ({ status: row.status, at: row.at?.toISOString() ?? null })),
			permissions: await permissionsOf(task, me.id),
			/** 当前用户 id —— 前端要靠它判断「这条动作 / 评论是不是我的」,前端不再单独问一次会话 */
			meId: me.id,
		};
	}),

	/**
	 * 任务附件的取地址(预览 / 下载)—— **只放行挂在这条任务上的文件**。
	 *
	 * 为什么不复用 `file.url`:那个按 `/settings/files` 页面码授权,任务页调不到;若把它放开到任务页,
	 * 又等于"任何登录用户凭 id 就能取任意文件"。所以这里先确认 `fileId` 确实挂在**这棵任务树**上
	 * (`payload.attachments` ∪ 评论附件),再签地址 —— 权限口径与「任务可见即可读」一致。
	 * 树内并集是必须的:内容区按整棵树展示(见 `familyTasks`),父任务要能签子任务附件。
	 * `download=true` 走预签名(带 `Content-Disposition`,按原始文件名下载)。
	 */
	attachmentUrl: protectedProcedure
		.input(z.object({ taskId: ID, fileId: z.string().min(1).max(32), download: z.boolean().optional() }))
		.query(async ({ ctx, input }) => {
			const task = await getTaskRow(input.taskId);
			const me = requireCurrentUser(ctx);
			await assertTaskReadable(task, me.id);
			const family = await familyTasks(task, me.id);
			let owned = family.some((row) => attachmentIdsOf(row.payload).includes(input.fileId));
			if (!owned) {
				const comments = await db
					.select({ attachments: taskCommentTable.attachments })
					.from(taskCommentTable)
					.where(and(eq(taskCommentTable.task_id, task.id), alive(taskCommentTable)));
				owned = comments.some(
					(row) => Array.isArray(row.attachments) && (row.attachments as unknown[]).includes(input.fileId),
				);
			}
			if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "附件不存在" });

			const [row] = await db.select().from(sysFile).where(eq(sysFile.id, input.fileId)).limit(1);
			// 只签已确认的文件:`status = 0` 是「已签发 PUT、对象还没上来」的中间态,
			// 放它过等于对不存在的对象签名;`status = 2` 已删除。与 `resolveAttachments` 同判据。
			if (!row || Number(row.status) !== 1) {
				throw new TRPCError({ code: "NOT_FOUND", message: "附件不存在或还没上传完成" });
			}

			const url = await getObjectUrl(row.bucket, row.object_key, input.download ? row.origin_name : undefined);
			return {
				url,
				originName: row.origin_name,
				contentType: row.content_type,
				size: row.size,
				ext: row.ext,
			};
		}),

	/**
	 * 建任务。
	 *
	 * `workflow` 列存的是 `tc_workflow.payload` 的**整份快照** —— 之后改模板不影响已建任务。
	 * 初始状态取快照的 `initial`。成员一并写 `tc_member`(creator 不进那张表,它在 `tc_task.creator_id`)。
	 */
	taskCreate: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1, "任务名称不能为空").max(255),
				description: z.string().max(5000).nullish(),
				/** ISO 字符串,例:`2026-10-09T18:00:00.000Z`(必须能解析;log#list 同款口径) */
				dueAt: z
					.string()
					.max(64)
					.nullish()
					.refine((value) => !value || !Number.isNaN(new Date(value).getTime()), {
						message: "截止时间写成了一段没法解析的日期",
					}),
				/** `0` = P0 / `1` = P1 / `2` = P2;留空表示「未设置」 */
				priority: z.number().int().min(0).max(2).nullish(),
				workflowId: ID,
				/** 绑定填报模板: `{ reportId, filter?, rows? }` —— rows 为建任务时直接带进来的初始行(文件导入) */
				report: z
					.object({
						reportId: ID,
						filter: z
							.array(
								z.object({
									field: z.string().min(1).max(64),
									value: z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()]),
								}),
							)
							.min(1)
							.max(20)
							.optional(),
						rows: z.array(reportRowSchema).max(10000).optional(),
					})
					.optional(),
				payload: taskPayloadSchema.nullish(),
				members: z
					.array(
						z.object({
							userId: z.string().min(1).max(36),
							role: ROLE_ENUM,
							/** 该成员子任务的填报过滤规则(仅表格模板;多执行人 fan-out 时生效) */
							filter: z
								.array(
									z.object({
										field: z.string().min(1).max(64),
										value: z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()]),
									}),
								)
								.min(1)
								.max(20)
								.optional(),
						}),
					)
					.max(50)
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const [workflow] = await db
				.select()
				.from(taskWorkflowTable)
				.where(and(eq(taskWorkflowTable.id, input.workflowId), alive(taskWorkflowTable)))
				.limit(1);
			if (!workflow) throw new TRPCError({ code: "NOT_FOUND", message: "状态图模板不存在" });
			const snapshot = workflow.payload as WorkflowPayload;
			// zod 的 min(1) 只拦 undefined / 空串,"   " 这类纯空白要 trim 后再拦(编辑侧也过 name.trim())
			if (!input.name.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "任务名称不能为空" });
			const requestedMembers = (input.members ?? []).filter((member) => member.userId !== me.id);
			if (new Set(requestedMembers.map((member) => member.userId)).size !== requestedMembers.length) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "任务成员不能重复" });
			}

			const id = newId();
			await db.transaction(async (tx) => {
				if (requestedMembers.length) {
					const users = await tx
						.select({ id: sysUser.id })
						.from(sysUser)
						.where(
							and(
								inArray(
									sysUser.id,
									requestedMembers.map((member) => member.userId),
								),
								alive(sysUser),
							),
						)
						.for("update");
					if (users.length !== requestedMembers.length)
						throw new TRPCError({ code: "NOT_FOUND", message: "任务成员不存在" });
				}
				const template = input.report ? await getAvailableReportTemplate(tx, input.report.reportId, me) : null;
				const executors = requestedMembers.filter((member) => member.role === "executor");
				const filters = [input.report?.filter, ...requestedMembers.map((member) => member.filter)].filter(
					(filter): filter is NonNullable<typeof filter> => filter !== undefined,
				);
				if (filters.length && (!template || template.schema.kind !== "TABLE"))
					throw new TRPCError({ code: "BAD_REQUEST", message: "数据范围只支持表格填报" });
				for (const filter of filters) {
					const fields = new Set<string>();
					for (const condition of filter) {
						const field = template?.schema.fields.find((item) => item.id === condition.field);
						if (!field || field.type === "multiselect" || fields.has(condition.field))
							throw new TRPCError({ code: "BAD_REQUEST", message: "数据范围字段无效或重复" });
						fields.add(condition.field);
					}
				}
				// 多执行人 = fan-out:**1 父 + N 子**(父不设执行人,每个执行人各拿一条子任务)
				const fanout = executors.length >= 2;
				// 只允许互斥范围,否则子任务同步时会覆盖另一个执行人的数据。
				if (fanout && template?.schema.kind === "TABLE") {
					const rules = executors.map((member) => member.filter ?? input.report?.filter ?? []);
					if (rules.some((rule, index) => rules.slice(index + 1).some((other) => scopesOverlap(rule, other))))
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "多个执行人的数据范围不能重叠，否则同一批数据会被互相覆盖",
						});
				}

				// 母版数据:建任务时文件导入带进来的初始行(仅表格模板)
				const masterRows: Array<Record<string, unknown>> = (() => {
					if (!template || !input.report?.rows?.length) return [];
					if (template.schema.kind !== "TABLE")
						throw new TRPCError({ code: "BAD_REQUEST", message: "数据规则只支持表格形式模板" });
					const issues = validateTaskReport(template.schema, input.report.rows);
					if (issues.length)
						throw new TRPCError({ code: "BAD_REQUEST", message: `填报数据无效: ${issues[0].message}` });
					return input.report.rows;
				})();

				/** 母版行按过滤规则切片(规则 = 一组 field=value 的 AND;空规则 = 全部行) */
				const rowsFor = (filter: Array<{ field: string; value: unknown }>) =>
					masterRows.filter((row) => filter.every((condition) => (row[condition.field] ?? null) === condition.value));

				/** 填报草稿:表格取过滤后的行,表单取字段默认值 */
				const draftOf = (filter: Array<{ field: string; value: unknown }>): unknown => {
					if (!template) return null;
					if (template.schema.kind === "TABLE") return rowsFor(filter);
					return Object.fromEntries(
						template.schema.fields
							.filter((field) => field.defaultValue !== undefined)
							.map((field) => [field.id, field.defaultValue]),
					);
				};

				if (fanout) {
					// 父任务:承载母版(执行人就是创建人),成员里只留非执行人(如参与者)
					await insertTask(
						tx,
						{
							id,
							name: input.name,
							description: input.description,
							dueAt: input.dueAt ? new Date(input.dueAt) : null,
							priority: input.priority,
							workflowId: input.workflowId,
							workflow: snapshot,
							payload: input.payload,
							...(template ? { report: { reportId: template.id, schema: template.schema } } : {}),
							masterRows,
							members: requestedMembers.filter((member) => member.role !== "executor"),
						},
						me,
					);
					if (template) {
						await tx.insert(taskReportTable).values({ id: newId(), task_id: id, draft: draftOf([]), revision: 0 });
					}
					for (const member of executors) {
						const childId = newId();
						// 子任务的过滤规则:成员自带优先,否则沿用任务级数据规则(表单里只配一条)
						const filter = member.filter ?? input.report?.filter ?? [];
						await insertTask(
							tx,
							{
								id: childId,
								parentId: id,
								name: input.name,
								// 子任务继承父任务创建时的说明与链接 / 附件 —— 除数据范围外,两边看到的一样
								description: input.description,
								dueAt: input.dueAt ? new Date(input.dueAt) : null,
								priority: input.priority,
								workflowId: input.workflowId,
								workflow: snapshot,
								payload: input.payload,
								...(template
									? {
											report: {
												reportId: template.id,
												schema: template.schema,
												filter,
												baseHash: createHash("sha256")
													.update(stableJson(draftOf(filter)))
													.digest("hex"),
											},
										}
									: {}),
								members: [{ userId: member.userId, role: "executor" }],
							},
							me,
						);
						if (template) {
							// 下发即复制:子任务拿一份独立的行副本,之后各改各的,手动「保存」才回写父任务
							await tx.insert(taskReportTable).values({
								id: newId(),
								task_id: childId,
								draft: draftOf(filter),
								revision: 0,
							});
						}
						await logTaskEvent(tx, {
							taskId: childId,
							event: "task.create",
							actor: me,
							detail: { parentId: id, filter },
						});
					}
					return;
				}

				await insertTask(
					tx,
					{
						id,
						name: input.name,
						description: input.description,
						dueAt: input.dueAt ? new Date(input.dueAt) : null,
						priority: input.priority,
						workflowId: input.workflowId,
						workflow: snapshot,
						payload: input.payload,
						...(template
							? {
									report: {
										reportId: template.id,
										schema: template.schema,
										filter: executors[0]?.filter ?? input.report?.filter,
									},
								}
							: {}),
						members: requestedMembers,
					},
					me,
				);
				if (template) {
					await tx.insert(taskReportTable).values({
						id: newId(),
						task_id: id,
						draft: draftOf(executors[0]?.filter ?? input.report?.filter ?? []),
						revision: 0,
					});
				}
			});
			return { id };
		}),

	/** 编辑任务 —— 只改描述性字段;`status` / `workflow` 不在这里改(那要走 `taskTransit` / `actionCreate`) */
	taskUpdate: protectedProcedure
		.input(
			z.object({
				id: ID,
				name: z.string().min(1, "任务名称不能为空").max(255),
				description: z.string().max(5000).nullish(),
				/** ISO 字符串;必须能解析(log#list 同款口径) */
				dueAt: z
					.string()
					.max(64)
					.nullish()
					.refine((value) => !value || !Number.isNaN(new Date(value).getTime()), {
						message: "截止时间写成了一段没法解析的日期",
					}),
				/** `undefined` = 不传(保旧值);`null` = 显式清空;`0|1|2` = 改值 */
				priority: z.number().int().min(0).max(2).nullish(),
				/** `undefined` = 不传(整块 payload 保旧值);`null` = 显式清空;对象 = 整块替换 */
				payload: taskPayloadSchema.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const task = await getTaskRow(input.id);
			await assertCanManage(task, me.id);

			// 变更前的值只能在这里取(update 之后就没了)—— 日志要写"从什么改成什么"
			const nextName = input.name.trim();
			if (!nextName) throw new TRPCError({ code: "BAD_REQUEST", message: "任务名称不能为空" });
			/**
			 * 可空字段同口径:**`undefined` = 不动**(回退锁上的旧值,下游比较自然为 false);
			 * `null` / 空串 = 显式清空;有值 = 改值。与 `priority` / `payload` 一致。
			 * 回退用的旧值必须在事务内取 —— 外层的 `task` 是加锁前的快照。
			 */
			const payloadTouched = input.payload !== undefined;

			const now = new Date();
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.id);
				const nextDescription = input.description === undefined ? task.description : input.description?.trim() || null;
				const nextDueAt = input.dueAt === undefined ? task.due_at : input.dueAt ? new Date(input.dueAt) : null;
				/** 优先级 `undefined` = 不动;`null` = 显式清空;字符串 = 改值 */
				const nextPriority = input.priority === undefined ? undefined : input.priority;
				const nextPayload = payloadTouched ? await prepareTaskPayload(tx, input.payload) : task.payload;
				const prevDueAt = task.due_at ? task.due_at.toISOString() : null;
				const nextDueText = nextDueAt ? nextDueAt.toISOString() : null;
				const fields: Array<{ key: string; from: string | number | null; to: string | number | null }> = [];
				if (nextName !== task.name) fields.push({ key: "name", from: task.name, to: nextName });
				if (nextDescription !== task.description) {
					fields.push({ key: "description", from: task.description, to: nextDescription });
				}
				if (nextDueText !== prevDueAt) fields.push({ key: "dueAt", from: prevDueAt, to: nextDueText });
				if (nextPriority !== undefined && nextPriority !== task.priority) {
					fields.push({ key: "priority", from: task.priority, to: nextPriority });
				}
				const payloadChanged = stableJson(nextPayload ?? null) !== stableJson(task.payload ?? null);

				const setValue: Partial<typeof taskTable.$inferInsert> = {
					name: nextName,
					description: nextDescription,
					due_at: nextDueAt,
					payload: nextPayload,
					updated_at: now,
				};
				if (nextPriority !== undefined) setValue.priority = nextPriority;
				await tx.update(taskTable).set(setValue).where(eq(taskTable.id, task.id));
				// 说明是「整件事」的描述:父任务改了,子任务跟着改(子任务是执行副本,不各写一份)
				if (!task.parent_id && nextDescription !== task.description) {
					await tx
						.update(taskTable)
						.set({ description: nextDescription, updated_at: now })
						.where(and(eq(taskTable.parent_id, task.id), alive(taskTable)));
				}
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "task.update",
					actor: me,
					detail: { fields, payloadChanged },
					at: now,
				});
			});
			return { ok: true };
		}),

	/**
	 * **给任务加附件**(执行人 / 参与者也能用,不必等创建人改整份 payload)。
	 *
	 * 只动 `payload.attachments`,`links` / `type` / 名称 / 描述原样保留 —— 服务端从库里取旧值再合并,
	 * 前端传什么都不会覆盖别的字段。内容区按整棵树展示(见 `familyTasks`),所以子任务加的附件
	 * 父任务那边同样看得到。
	 */
	taskAttach: protectedProcedure
		.input(
			z.object({
				id: ID,
				attachments: z.array(z.string().min(1).max(32)).max(20),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.id);
				await assertTaskParticipant(task, me.id, "无权给这条任务加附件");
				const nextPayload = await prepareTaskPayload(tx, {
					...normalizePayload(task.payload as Parameters<typeof normalizePayload>[0]),
					attachments: input.attachments,
				});
				const changed = stableJson(nextPayload ?? null) !== stableJson(task.payload ?? null);
				await tx
					.update(taskTable)
					.set({ payload: nextPayload, updated_at: new Date() })
					.where(eq(taskTable.id, task.id));
				if (changed)
					await logTaskEvent(tx, {
						taskId: task.id,
						event: "task.update",
						actor: me,
						detail: { payloadChanged: true, attachments: input.attachments.length },
					});
			});
			return { ok: true };
		}),

	/**
	 * 软删任务，并在同一事务终止未完成动作和待发送通知。
	 *
	 * 删父任务连带删子任务,避免保留脱离分派上下文的子任务。
	 */
	taskRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.id);
		await assertCanManage(task, me.id);
		const now = new Date();
		await db.transaction(async (tx) => {
			await lockTask(tx, task.id);
			const children = await tx
				.select({ id: taskTable.id })
				.from(taskTable)
				.where(and(eq(taskTable.parent_id, task.id), alive(taskTable)))
				.for("update");
			for (const row of children) await cancelLiveTaskActions(tx, row.id, now);
			await cancelLiveTaskActions(tx, task.id, now);
			await tx
				.update(taskTable)
				.set({ ...softDeleted(), updated_at: now })
				.where(eq(taskTable.id, task.id));
			if (children.length) {
				await tx
					.update(taskTable)
					.set({ ...softDeleted(), updated_at: now })
					.where(and(eq(taskTable.parent_id, task.id), alive(taskTable)));
				for (const row of children)
					await logTaskEvent(tx, { taskId: row.id, event: "task.remove", actor: me, at: now });
			}
			await logTaskEvent(tx, { taskId: task.id, event: "task.remove", actor: me, at: now });
		});
		return { ok: true };
	}),

	/**
	 * **直接改状态**(`via='direct'` 的边)—— 创建者关单 / 驳回 / 归档走这里,不建 action。
	 *
	 * 三道校验,缺一不可:① 目标状态在快照的 `statuses` 里;② 从当前状态到目标存在 `via='direct'` 的边;
	 * ③ 这条边的 `who` 命中当前用户。任务被锁(有未完成的 `is_locking` action)时一律拒绝。
	 *
	 * 管理员可绕过角色限制，但必须遵守模板转移边和业务守卫。
	 * 所有角色**一律按模板走** —— 前端只把 `permissions.transitions` 里那几条直改边列出来。
	 * 锁守卫对所有人一视同仁(管理员也不能在锁定期改):那会留下一个 `to_status` 与任务状态对不上的活动作。
	 */
	taskTransit: protectedProcedure
		.input(z.object({ id: ID, to: z.string().min(1).max(32) }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const isAdmin = await isAdminUser(me.id);
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.id);
				if (task.status === input.to) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "任务已经是这个状态" });
				}
				if (await isLocked(task.id, tx)) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "有未完成的审批动作,任务被锁定" });
				}
				const workflow = workflowOf(task);
				if (!workflow.statuses?.some((status) => status.value === input.to)) {
					throw new TRPCError({ code: "BAD_REQUEST", message: `状态图里没有状态:${input.to}` });
				}
				const edge = (workflow.edges ?? []).find(
					(item) => item.from === task.status && item.to === input.to && item.via === "direct",
				);
				if (!edge)
					throw new TRPCError({ code: "BAD_REQUEST", message: `没有 ${task.status} → ${input.to} 的直接转移` });
				if (!isAdmin) {
					if (!(await whoAllows(task, me.id, edge.who ?? [], undefined, tx))) {
						throw new TRPCError({ code: "FORBIDDEN", message: "你没有权限做这次状态转移" });
					}
				}
				const now = new Date();
				if (workflow.statuses.some((status) => status.value === input.to && status.terminal))
					await cancelLiveTaskActions(tx, task.id, now);
				await tx.update(taskTable).set({ status: input.to, updated_at: now }).where(eq(taskTable.id, task.id));
				// 「直接改状态」以前**不留痕**(只有 action 才有记录),这里是它第一次被记进历史
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "task.transit",
					actor: me,
					fromStatus: task.status,
					toStatus: input.to,
					detail: { who: edge?.who ?? [] },
					at: now,
				});
			});
			return { ok: true };
		}),

	// ────────────────────────────── 成员 ──────────────────────────────

	/**
	 * 加参与者 / 执行者 —— **任务相关方**(创建者 / 管理员 / 当前成员)可以加;陌生人不行。
	 *
	 * 为什么不是「所有登录用户」:任务列表默认对全员可见,如果谁都能写 `tc_member`,
	 * 任何人都能把自己加成 executor 拿到提交权,或把别人拉进任务、伪造参与记录。
	 * 「全员可评论」是只写日志的旁路,与「往成员表里插行」不是一回事。
	 *
	 */
	memberAdd: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				userId: z.string().min(1).max(36),
				role: ROLE_ENUM,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const primary = input.role === "executor";
			const now = new Date();
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				if (!(await isTaskParticipant(task, me.id, tx)))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建者、管理员或任务成员可以做这个操作" });
				if (input.userId === task.creator_id)
					throw new TRPCError({ code: "BAD_REQUEST", message: "创建者不必进成员表(他是 tc_task.creator_id)" });
				const [user] = await tx
					.select({ id: sysUser.id })
					.from(sysUser)
					.where(and(eq(sysUser.id, input.userId), alive(sysUser)))
					.limit(1);
				if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
				if (primary) {
					const [executor] = await tx
						.select({ id: taskMemberTable.id })
						.from(taskMemberTable)
						.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.role, "executor")))
						.limit(1);
					if (executor) throw new TRPCError({ code: "BAD_REQUEST", message: "任务已有执行人，请使用转交" });
				}
				// 去重键只到「人」为止 —— 带上 role 会允许同一人同时留 participant + executor 两行
				const [dup] = await tx
					.select({ id: taskMemberTable.id })
					.from(taskMemberTable)
					.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, input.userId)))
					.limit(1);
				if (dup) throw new TRPCError({ code: "BAD_REQUEST", message: "这个人已经是任务成员了" });
				await tx.insert(taskMemberTable).values({
					id: newId(),
					task_id: task.id,
					user_id: input.userId,
					role: input.role,
					created_at: now,
					updated_at: now,
				});
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "member.add",
					actor: me,
					targetId: input.userId,
					detail: { role: input.role },
					at: now,
				});
			});
			return { ok: true };
		}),

	/** 移除成员 —— 仅创建者。纯关联表**真删**(与 `sys_user_dept` 同档,审计走 `sys_log`) */
	memberRemove: protectedProcedure
		.input(z.object({ taskId: ID, userId: z.string().min(1).max(36), role: ROLE_ENUM }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const task = await getTaskRow(input.taskId);
			await assertCanManage(task, me.id);
			const now = new Date();
			await db.transaction(async (tx) => {
				await lockTask(tx, task.id);
				const [pending] = await tx
					.select({ id: taskActionTable.id })
					.from(taskActionTable)
					.where(
						and(
							eq(taskActionTable.task_id, task.id),
							eq(taskActionTable.assignee_id, input.userId),
							inArray(taskActionTable.status, [...LIVE_ACTION_STATUS]),
						),
					)
					.limit(1);
				if (pending) throw new TRPCError({ code: "BAD_REQUEST", message: "该成员还有未完成的动作，不能移除" });
				await tx
					.delete(taskMemberTable)
					.where(
						and(
							eq(taskMemberTable.task_id, task.id),
							eq(taskMemberTable.user_id, input.userId),
							eq(taskMemberTable.role, input.role),
						),
					);
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "member.remove",
					actor: me,
					targetId: input.userId,
					detail: { role: input.role },
					at: now,
				});
			});
			return { ok: true };
		}),

	/**
	 * **转交**执行人 —— 把「执行者」这个身份交给同任务里的另一位成员(原子换人)。
	 *
	 * 语义(用户约定):新人成为**唯一主执行人**;其余执行者一律降为参与者。
	 * 能转交的:管理员,或当前是执行者的成员。目标只能是**本任务的成员**
	 * (创建者不进 `tc_member`),且不能是自己。
	 *
	 * 为什么不拆成 `memberAdd` + `memberRemove` 两次调用:那是两条独立事务,中间会出现
	 * 「两个主执行人 / 一个执行人都没有」的窗口;而且执行者本人并没有 `memberRemove` 权限。
	 * `tc_member` 的 UK 是 `(task_id, user_id, role)`,所以「换角色」一律**先删行再插行**,
	 * 免得同一人留下 participant + executor 两行。
	 */
	taskTransfer: protectedProcedure
		.input(z.object({ taskId: ID, userId: z.string().min(1).max(36) }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const isAdmin = await isAdminUser(me.id);
			const now = new Date();
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				const myRoles = await memberRolesOf(task.id, me.id, tx);
				if (!isAdmin && !myRoles.includes("executor")) {
					throw new TRPCError({ code: "FORBIDDEN", message: "只有执行者或管理员能转交" });
				}
				if (input.userId === task.creator_id) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "不能转交给创建者(他不在成员表里)" });
				}
				if (input.userId === me.id) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "不能转交给自己" });
				}
				const target = await tx
					.select({ id: taskMemberTable.id })
					.from(taskMemberTable)
					.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, input.userId)));
				if (target.length === 0) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "只能转交给这条任务的成员" });
				}

				// 转交前的执行人
				const [executor] = await tx
					.select({ userId: taskMemberTable.user_id })
					.from(taskMemberTable)
					.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.role, "executor")))
					.limit(1);
				const fromUserId = executor?.userId ?? null;
				if (fromUserId && fromUserId !== input.userId)
					await tx
						.update(taskMemberTable)
						.set({ role: "participant", updated_at: now })
						.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, fromUserId)));
				await tx
					.update(taskMemberTable)
					.set({ role: "executor", updated_at: now })
					.where(and(eq(taskMemberTable.task_id, task.id), eq(taskMemberTable.user_id, input.userId)));
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "member.transfer",
					actor: me,
					targetId: input.userId,
					detail: { from: fromUserId },
					at: now,
				});
			});
			return { ok: true };
		}),

	// ────────────────────────────── 动作 ──────────────────────────────

	/**
	 * 侧边栏「我的任务」的**红点计数** —— 只数**未读的站内任务通知**
	 * (@提及 / "轮到你了"这类,路径都指向 `/task-close/{id}`);标已读的那一下就是消红点的那一下 ——
	 * 动作本身的待办在「我的任务」页里自己看得见,不再给徽标双记账。
	 *
	 * 它是**外壳级**读口(每个页面都在用,只哨登录,登记在 `UNMAPPED_QUERIES` 类别 1);
	 * 侧边栏 30s 轮询 + SSE(`notice.new`)一起喂它,新通知秒亮、已读秒消。
	 */
	menuBadge: protectedProcedure.query(async ({ ctx }) => {
		const me = requireCurrentUser(ctx);
		const [taskNotices] = await db
			.select({ n: count() })
			.from(sysNotificationDelivery)
			.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
			.where(
				and(
					eq(sysNotificationDelivery.recipient_id, me.id),
					eq(sysNotificationDelivery.channel, "in_app"),
					eq(sysNotificationDelivery.status, "sent"),
					isNull(sysNotificationDelivery.read_at),
					or(eq(sysNotification.source_type, "task"), eq(sysNotification.source_type, "task_action")),
				),
			);
		return { count: Number(taskNotices?.n ?? 0) };
	}),

	/**
	 * 发起动作 —— 审批(`toStatus` 有值)和征询(`toStatus` 为空)是同一张表的同一种模式。
	 *
	 * 派生规则(文档「状态机推进」):
	 *  · 根级(`parentActionId` 不传):`from_status = 当前任务状态`,`root_action_id = 自己 id`,`sequence = 0`;
	 *    `toStatus` 有值 → `is_locking = 1` 并锁定状态转移;`toStatus` 为空 → `is_locking = 0`(不锁、不动状态);
	 *  · 子级:`from_status` / `to_status` 必须为 NULL,继承父的 `root_action_id`,`sequence = 父 + 1`(**不推进任务状态**)。
	 *
	 * 权限:`toStatus` 有值 → 走快照里 `via='action'` 的边 + `who` 判定;为空 → 创建者 / 参与者 / 执行者任一。
	 */
	actionCreate: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				toStatus: z.string().min(1).max(32).nullish(),
				assigneeId: z.string().min(1).max(191),
				parentActionId: ID.nullish(),
				nextAssigneeIds: z.array(z.string().min(1).max(36)).max(49).optional(),
				flowMode: z.enum(["serial", "parallel"]).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const nextAssigneeIds = input.nextAssigneeIds ?? [];
			if (nextAssigneeIds.length && input.parentActionId) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "多人流程只能从任务发起" });
			}
			const assigneeIds = [input.assigneeId, ...nextAssigneeIds];
			if (new Set(assigneeIds).size !== assigneeIds.length)
				throw new TRPCError({ code: "BAD_REQUEST", message: "处理人不能重复" });
			const id = newId();
			const now = new Date();
			const isAdmin = await isAdminUser(me.id);
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);

				let parent: ActionRow | null = null;
				if (input.parentActionId) {
					const [row] = await tx
						.select()
						.from(taskActionTable)
						.where(eq(taskActionTable.id, input.parentActionId))
						.limit(1);
					if (!row || row.task_id !== task.id) {
						throw new TRPCError({ code: "NOT_FOUND", message: "父动作不存在" });
					}
					if (!isAdmin && row.assignee_id !== me.id)
						throw new TRPCError({ code: "FORBIDDEN", message: "只有当前处理人可以追问" });
					if (row.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "只能追问正在处理的动作" });
					parent = row;
				}

				// 子动作不推进任务状态,权限在父动作上已经判过
				const toStatus = parent ? null : (input.toStatus ?? null);
				if (!parent) {
					if (!toStatus && workflowOf(task).statuses.some((status) => status.value === task.status && status.terminal))
						throw new TRPCError({ code: "BAD_REQUEST", message: "任务已结束，不能发起征询" });
					if (toStatus && (await isLocked(task.id, tx))) {
						throw new TRPCError({ code: "BAD_REQUEST", message: "有未完成的审批动作,任务被锁定" });
					}
					if (toStatus) {
						const workflow = workflowOf(task);
						if (!workflow.statuses?.some((status) => status.value === toStatus)) {
							throw new TRPCError({ code: "BAD_REQUEST", message: `状态图里没有状态:${toStatus}` });
						}
						const edge = (workflow.edges ?? []).find(
							(item) => item.from === task.status && item.to === toStatus && item.via === "action",
						);
						if (!edge) {
							throw new TRPCError({ code: "BAD_REQUEST", message: `没有 ${task.status} → ${toStatus} 的审批边` });
						}
						if (!isAdmin && !(await whoAllows(task, me.id, edge.who ?? [], undefined, tx))) {
							throw new TRPCError({ code: "FORBIDDEN", message: "你没有权限发起这次状态变更" });
						}
					} else if (!isAdmin && (await memberRolesOf(task.id, me.id, tx)).length === 0 && task.creator_id !== me.id) {
						throw new TRPCError({ code: "FORBIDDEN", message: "只有创建者 / 参与者 / 执行者能发起征询" });
					}
				}
				const taskMembers = await tx
					.select({ userId: taskMemberTable.user_id })
					.from(taskMemberTable)
					.where(eq(taskMemberTable.task_id, task.id));
				const allowedAssignees = new Set([task.creator_id, ...taskMembers.map((member) => member.userId)]);
				if (assigneeIds.some((assigneeId) => !allowedAssignees.has(assigneeId)))
					throw new TRPCError({ code: "BAD_REQUEST", message: "处理人必须是任务创建人或成员" });
				const users = await tx
					.select({ id: sysUser.id })
					.from(sysUser)
					.where(and(inArray(sysUser.id, assigneeIds), alive(sysUser)))
					.for("update");
				if (users.length !== assigneeIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "处理人不存在" });

				const isLocking = !parent && toStatus !== null;
				await tx.insert(taskActionTable).values({
					id,
					task_id: task.id,
					root_action_id: parent ? parent.root_action_id : id,
					parent_action_id: parent ? parent.id : null,
					is_locking: isLocking,
					from_status: parent ? null : task.status,
					to_status: toStatus,
					sequence: parent ? parent.sequence + 1 : 0,
					creator_id: me.id,
					assignee_id: input.assigneeId,
					status: "active",
					activated_at: now,
					created_at: now,
					updated_at: now,
				});
				let predecessor = id;
				for (const [index, assigneeId] of nextAssigneeIds.entries()) {
					const nextId = newId();
					const parallel = input.flowMode === "parallel";
					await tx.insert(taskActionTable).values({
						id: nextId,
						task_id: task.id,
						root_action_id: id,
						parent_action_id: parallel ? id : predecessor,
						is_locking: isLocking,
						from_status: null,
						to_status: null,
						sequence: index + 1,
						creator_id: me.id,
						assignee_id: assigneeId,
						status: parallel ? "active" : "queued",
						activated_at: parallel ? now : null,
						created_at: now,
						updated_at: now,
					});
					if (parallel)
						await createNotification(tx, {
							type: "action.assigned",
							source: { type: "task_action", id: nextId },
							title: `轮到你:${task.name}`,
							content: `${me.name || "有人"} ${isLocking ? "发起审批" : "征询了你"} —— 到「我的任务」查看`,
							payload: { path: taskPathOf(task.id), level: "info", actionId: nextId },
							dedupeKey: `action.assigned:${nextId}`,
							recipients: [{ userId: assigneeId, channel: "in_app" }],
						});
					predecessor = nextId;
				}
				await createNotification(tx, {
					type: "action.assigned",
					source: { type: "task_action", id },
					title: `轮到你:${task.name}`,
					content: `${me.name || "有人"} ${isLocking ? "发起审批" : "征询了你"} —— 到「我的任务」查看`,
					payload: { path: taskPathOf(task.id), level: "info", actionId: id },
					dedupeKey: `action.assigned:${id}`,
					recipients: [{ userId: input.assigneeId, channel: "in_app" }],
				});
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "action.create",
					actor: me,
					// 创建动作不改变任务状态
					fromStatus: null,
					toStatus: null,
					targetId: id,
					detail: {
						// 「这次想去哪」:审批是目标状态,征询是 null —— 不要拿 to_status 兼职
						intendedTo: toStatus,
						intendedFrom: isLocking ? task.status : null,
						assigneeId: input.assigneeId,
						isLocking,
						parentActionId: parent ? parent.id : null,
						sequence: parent ? parent.sequence + 1 : 0,
					},
					at: now,
				});
			});
			publish({ channel: `notice:${input.assigneeId}`, name: "notice.new", data: { actionId: id } });
			if (input.flowMode === "parallel") publishMentions(nextAssigneeIds);
			return { id };
		}),

	/** 创建一次催办；条件更新同时保证冷却和多请求竞争安全。 */
	actionUrge: protectedProcedure
		.input(
			z.object({
				id: ID,
				requestId: z.string().min(1).max(32),
				channels: z
					.array(z.enum(["sms", "email"]))
					.min(1)
					.max(2),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const [row] = await db
				.select({ action: taskActionTable, task: taskTable, user: sysUser })
				.from(taskActionTable)
				.innerJoin(taskTable, eq(taskTable.id, taskActionTable.task_id))
				.innerJoin(sysUser, eq(sysUser.id, taskActionTable.assignee_id))
				.where(and(eq(taskActionTable.id, input.id), alive(taskTable), alive(sysUser)))
				.limit(1);
			if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "动作或处理人不存在" });
			if (
				me.id !== row.action.creator_id &&
				me.id !== row.task.creator_id &&
				!(await isAdminUser(me.id, me.isSuper === true))
			) {
				throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人、动作发起人或管理员可以催办" });
			}
			const key = `action.urged:${createHash("sha256")
				.update(JSON.stringify([input.id, input.requestId]))
				.digest("hex")}`;
			const existing = async () => {
				const [hit] = await db
					.select({ id: sysNotification.id, sourceId: sysNotification.source_id })
					.from(sysNotification)
					.where(eq(sysNotification.dedupe_key, key))
					.limit(1);
				return hit;
			};
			const previous = await existing();
			if (previous) {
				if (previous.sourceId !== input.id) throw new TRPCError({ code: "CONFLICT", message: "催办请求编号已使用" });
				return { id: previous.id, reused: true };
			}
			const channels = [...new Set(input.channels)];
			if (channels.includes("sms") && (!row.user.phone || !/^\+?[0-9][0-9 -]{5,30}$/.test(row.user.phone))) {
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "处理人未配置有效的联系电话" });
			}
			if (channels.includes("email") && !z.string().email().safeParse(row.user.email).success) {
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "处理人未配置有效的邮箱" });
			}
			const now = new Date();
			const cutoff = new Date(now.getTime() - TASK_URGE_COOLDOWN_MINUTES * 60_000);
			const id = await db.transaction(async (tx) => {
				const updated = await tx
					.update(taskActionTable)
					.set({ last_urged_at: now })
					.where(
						and(
							eq(taskActionTable.id, input.id),
							eq(taskActionTable.status, "active"),
							eq(taskActionTable.assignee_id, row.user.id),
							or(isNull(taskActionTable.last_urged_at), lte(taskActionTable.last_urged_at, cutoff)),
						),
					);
				if (updated[0].affectedRows !== 1) return null;
				return createNotification(tx, {
					type: "action.urged",
					source: { type: "task_action", id: input.id },
					title: `任务催办：${row.task.name}`,
					content: "您有一项待处理的审批或征询，请及时查看。",
					payload: { path: taskPathOf(row.task.id), actionId: input.id, operatorId: me.id },
					dedupeKey: key,
					recipients: channels.map((channel) => ({
						userId: row.user.id,
						channel,
						target: channel === "sms" ? row.user.phone : row.user.email,
					})),
				});
			});
			if (!id) {
				const raced = await existing();
				if (raced && raced.sourceId === input.id) return { id: raced.id, reused: true };
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "动作已结束或仍在 30 分钟催办冷却期" });
			}
			return { id, reused: false };
		}),

	/** 催办记录只向该动作发起人、任务创建人及管理员开放。 */
	actionUrgeHistory: protectedProcedure.input(z.object({ id: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const [row] = await db
			.select({ action: taskActionTable, task: taskTable })
			.from(taskActionTable)
			.innerJoin(taskTable, eq(taskTable.id, taskActionTable.task_id))
			.where(and(eq(taskActionTable.id, input.id), alive(taskTable)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "动作不存在" });
		if (
			me.id !== row.action.creator_id &&
			me.id !== row.task.creator_id &&
			!(await isAdminUser(me.id, me.isSuper === true))
		) {
			throw new TRPCError({ code: "FORBIDDEN", message: "没有权限查看催办记录" });
		}
		const events = await db
			.select()
			.from(sysNotification)
			.where(
				and(
					eq(sysNotification.source_type, "task_action"),
					eq(sysNotification.source_id, input.id),
					eq(sysNotification.type, "action.urged"),
				),
			)
			.orderBy(desc(sysNotification.created_at))
			.limit(100);
		const ids = events.map((event) => event.id);
		if (!ids.length) return [];
		const deliveries = await db
			.select()
			.from(sysNotificationDelivery)
			.where(inArray(sysNotificationDelivery.notification_id, ids))
			.orderBy(desc(sysNotificationDelivery.created_at));
		return deliveries.map((delivery) => ({
			id: delivery.id,
			channel: delivery.channel,
			status: delivery.status,
			attempts: delivery.attempts,
			error: delivery.last_error,
			createdAt: delivery.created_at.toISOString(),
			sentAt: delivery.sent_at?.toISOString() ?? null,
		}));
	}),

	/** 发起人或管理员撤回动作，审批会取消整条流程的未处理动作。 */
	actionWithdraw: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const admin = await isAdminUser(me.id, me.isSuper === true);
		await db.transaction(async (tx) => {
			const { task, action } = await lockAction(tx, input.id);
			if (!admin && action.creator_id !== me.id && task.creator_id !== me.id)
				throw new TRPCError({ code: "FORBIDDEN", message: "只有动作发起人、任务创建人或管理员可以撤回" });
			if (!(LIVE_ACTION_STATUS as readonly string[]).includes(action.status))
				throw new TRPCError({ code: "BAD_REQUEST", message: "该动作已结束" });
			const chain = await tx
				.select()
				.from(taskActionTable)
				.where(and(eq(taskActionTable.task_id, task.id), eq(taskActionTable.root_action_id, action.root_action_id)))
				.for("update");
			const cancelled = new Set(action.is_locking ? chain.map((item) => item.id) : [action.id]);
			let changed = true;
			while (changed) {
				changed = false;
				for (const item of chain)
					if (item.parent_action_id && cancelled.has(item.parent_action_id) && !cancelled.has(item.id)) {
						cancelled.add(item.id);
						changed = true;
					}
			}
			const ids = [...cancelled];
			const now = new Date();
			await tx
				.update(taskActionTable)
				.set({ status: "cancelled", updated_at: now })
				.where(and(inArray(taskActionTable.id, ids), inArray(taskActionTable.status, [...LIVE_ACTION_STATUS])));
			await cancelPendingNotifications(tx, "task_action", ids);
			await logTaskEvent(tx, {
				taskId: task.id,
				event: "action.withdraw",
				actor: me,
				targetId: action.id,
				fromStatus: null,
				toStatus: null,
				detail: { cancelled: ids.length },
				at: now,
			});
		});
		return { ok: true };
	}),

	/** 查看指定动作仅记录处理人首次打开的时间，与站内通知已读无关。 */
	actionView: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const [action] = await db.select().from(taskActionTable).where(eq(taskActionTable.id, input.id)).limit(1);
		if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "动作不存在" });
		if (action.assignee_id !== me.id) throw new TRPCError({ code: "FORBIDDEN", message: "只有处理人可以查看该动作" });
		if (action.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "该动作已不在待处理状态" });
		await getTaskRow(action.task_id);
		await db
			.update(taskActionTable)
			.set({ viewed_at: new Date() })
			.where(
				and(
					eq(taskActionTable.id, input.id),
					eq(taskActionTable.assignee_id, me.id),
					eq(taskActionTable.status, "active"),
					isNull(taskActionTable.viewed_at),
				),
			);
		return { ok: true };
	}),

	/**
	 * 答复动作 —— 只有 `assignee_id` 本人能答。
	 *
	 * 结算:审批全部通过后任务转根节点的 `to_status`;驳回后保持原状态(文档「状态机推进」)。
	 * 锁顺序与 `taskTransit` 一致(先 `tc_task` 再 `tc_action`),避免互相等锁。
	 */
	actionRespond: protectedProcedure
		.input(z.object({ id: ID, approved: z.boolean(), reason: z.string().max(2000).nullish() }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			let nextAssigneeId: string | null = null;
			await db.transaction(async (tx) => {
				const { task, action } = await lockAction(tx, input.id);
				if (action.assignee_id !== me.id) {
					throw new TRPCError({ code: "FORBIDDEN", message: "只有指派人能答复这个动作" });
				}
				if (!action.is_locking) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "征询必须填写意见回复" });
				}
				if (action.status !== "active") {
					throw new TRPCError({ code: "BAD_REQUEST", message: "这个动作已经答复过了" });
				}
				// 驳回**必须写原因**;原因直接以**评论**留档(复用评论流,和普通评论一起看),不另造一张"驳回意见"表
				const reason = input.reason?.trim();
				if (!input.approved && !reason) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "驳回要填写原因" });
				}
				if (input.approved && action.is_locking) {
					const [root] = await tx
						.select()
						.from(taskActionTable)
						.where(eq(taskActionTable.id, action.root_action_id))
						.limit(1)
						.for("update");
					const edge = workflowOf(task).edges.find(
						(item) => item.from === root?.from_status && item.to === root?.to_status && item.via === "action",
					);
					if (!root || !edge || task.status !== root.from_status)
						throw new TRPCError({ code: "BAD_REQUEST", message: "任务未满足流程条件，无法通过审批" });
				}

				await tx
					.update(taskActionTable)
					.set({ status: input.approved ? "done" : "rejected", updated_at: new Date() })
					.where(eq(taskActionTable.id, action.id));
				await cancelPendingNotifications(tx, "task_action", [action.id]);

				// 通过 / 驳回的意见都落成评论(有就写一条;通过的意见是可选的)
				if (reason) {
					await tx.insert(taskCommentTable).values({
						id: newId(),
						task_id: task.id,
						author_id: me.id,
						content: `${input.approved ? "通过意见" : "驳回原因"}:${reason}`,
						created_at: new Date(),
						updated_at: new Date(),
					});
				}

				const now = new Date();
				const nextAction = input.approved ? await activateNextAction(tx, task, action, now) : null;
				nextAssigneeId = nextAction?.assignee_id ?? null;
				// 审批默认全员通过；任一拒绝立即回退并取消剩余节点。
				let movedTo: string | null = null;
				if (action.is_locking) {
					const [root] = await tx
						.select()
						.from(taskActionTable)
						.where(and(eq(taskActionTable.id, action.root_action_id), eq(taskActionTable.task_id, task.id)))
						.limit(1)
						.for("update");
					if (!root || !root.is_locking)
						throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "审批流程缺少根节点" });
					if (!input.approved) {
						const pending = await tx
							.select({ id: taskActionTable.id })
							.from(taskActionTable)
							.where(
								and(
									eq(taskActionTable.task_id, task.id),
									eq(taskActionTable.root_action_id, action.root_action_id),
									inArray(taskActionTable.status, [...LIVE_ACTION_STATUS]),
								),
							)
							.for("update");
						if (pending.length) {
							const ids = pending.map((item) => item.id);
							await tx
								.update(taskActionTable)
								.set({ status: "cancelled", updated_at: now })
								.where(inArray(taskActionTable.id, ids));
							await cancelPendingNotifications(tx, "task_action", ids);
						}
					}
					const [remaining] = await tx
						.select({ id: taskActionTable.id })
						.from(taskActionTable)
						.where(
							and(
								eq(taskActionTable.task_id, task.id),
								eq(taskActionTable.root_action_id, action.root_action_id),
								eq(taskActionTable.is_locking, true),
								inArray(taskActionTable.status, [...LIVE_ACTION_STATUS]),
							),
						)
						.limit(1)
						.for("update");
					const next = input.approved ? (remaining ? null : root.to_status) : root.from_status;
					if (next && next !== task.status) {
						if (workflowOf(task).statuses.some((status) => status.value === next && status.terminal))
							await cancelLiveTaskActions(tx, task.id, now);
						await tx.update(taskTable).set({ status: next, updated_at: now }).where(eq(taskTable.id, task.id));
						movedTo = next;
					}
				}
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "action.respond",
					actor: me,
					// 仅在全部通过并推进任务时填写状态列
					fromStatus: movedTo ? task.status : null,
					toStatus: movedTo,
					targetId: action.id,
					detail: {
						approved: input.approved,
						// 驳回原因同时落了条评论(评论流要看);这里再存一份是给活动流直接渲染用
						reason: reason ?? null,
						actionStatus: input.approved ? "done" : "rejected",
						nextActionId: nextAction?.id ?? null,
					},
					at: now,
				});
			});
			if (nextAssigneeId) publishMentions([nextAssigneeId]);
			return { ok: true };
		}),

	/**
	 * **回复征询** —— 征询是「征意见」,不是审批:不需要通过 / 驳回,
	 * 指派人给一条意见(**可带附件**)即算处理完毕;意见直接以**一条评论**进讨论流
	 * (与驳回原因同一做法:复用评论流,不另造一张"意见"表)。
	 *
	 * 与 `actionRespond` 的差异:不区分 approve / reject、不碰任务状态(任务该锁还锁、该开还开)、
	 * 不写 reason 强校验(空内容直接拒,不需要"必须驳回才填"的绕弯)。
	 */
	actionReply: protectedProcedure
		.input(
			z.object({
				id: ID,
				content: z.string().min(1, "回复内容不能为空").max(5000),
				attachments: z.array(z.string().min(1).max(32)).max(20).optional(),
				mentionIds: z.array(z.string().min(1).max(36)).max(100).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			let receivers: string[] = [];
			await db.transaction(async (tx) => {
				const { task, action } = await lockAction(tx, input.id);
				if (action.assignee_id !== me.id) {
					throw new TRPCError({ code: "FORBIDDEN", message: "只有被征询的人能回复" });
				}
				if (action.is_locking) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "审批必须通过或驳回" });
				}
				if (action.status !== "active") {
					throw new TRPCError({ code: "BAD_REQUEST", message: "这个征询已经回复过了" });
				}
				const content = input.content.trim();
				if (!content) throw new TRPCError({ code: "BAD_REQUEST", message: "回复内容不能为空" });
				await assertAttachments(tx, input.attachments ?? []);
				const now = new Date();
				const commentId = newId();
				await tx
					.update(taskActionTable)
					.set({ status: "done", updated_at: now })
					.where(eq(taskActionTable.id, action.id));
				await cancelPendingNotifications(tx, "task_action", [action.id]);
				await tx.insert(taskCommentTable).values({
					id: commentId,
					task_id: action.task_id,
					author_id: me.id,
					content,
					attachments: input.attachments?.length ? input.attachments : null,
					created_at: now,
					updated_at: now,
				});
				receivers = await createMentionNotifications(tx, task, content, me, input.mentionIds ?? [], commentId);
				const nextAction = await activateNextAction(tx, task, action, now);
				if (nextAction) receivers.push(nextAction.assignee_id);
				await logTaskEvent(tx, {
					taskId: action.task_id,
					event: "action.reply",
					actor: me,
					// target = **意见那条评论** —— 读取侧按它取摘要(excerpt),动态流直接渲染
					targetId: commentId,
					detail: {
						consultOf: action.creator_id, // 征询是谁发起的(展示:"对 甲 回复征询")
						commentId,
						nextActionId: nextAction?.id ?? null,
						attachments: input.attachments?.length ?? 0,
					},
					at: now,
				});
			});
			publishMentions(receivers);
			return { ok: true };
		}),

	// ────────────────────────────── 评论 ──────────────────────────────

	/** 评论流 —— 附件只存了 `sys_file.id`,这里回填文件名 / 大小;已删文件直接丢掉(不留空行) */
	commentList: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ ctx, input }) => {
		await assertTaskReadable(await getTaskRow(input.taskId), requireCurrentUser(ctx).id);
		const rows = await db
			.select()
			.from(taskCommentTable)
			.where(and(eq(taskCommentTable.task_id, input.taskId), alive(taskCommentTable)))
			.orderBy(asc(taskCommentTable.created_at));

		const nameOf = await nameMapOf(rows.map((row) => row.author_id));
		const fileIds = [...new Set(rows.flatMap((row) => (row.attachments as string[] | null) ?? []))];
		const files =
			fileIds.length === 0
				? []
				: await db
						.select({
							id: sysFile.id,
							name: sysFile.origin_name,
							size: sysFile.size,
							contentType: sysFile.content_type,
						})
						.from(sysFile)
						.where(and(inArray(sysFile.id, fileIds), eq(sysFile.status, 1)));
		const fileOf = new Map(files.map((file) => [file.id, file]));

		return rows.map((row) => ({
			id: row.id,
			taskId: row.task_id,
			authorId: row.author_id,
			authorName: nameOf.get(row.author_id) ?? null,
			content: row.content,
			attachments: ((row.attachments as string[] | null) ?? [])
				.map((fileId) => fileOf.get(fileId))
				.filter((file) => file !== undefined),
			createdAt: row.created_at ? row.created_at.toISOString() : null,
		}));
	}),

	/**
	 * 任务可见者可以评论,写入与任务删除按任务行锁串行。
	 *
	 * 附件 id 在事务里先验存在(`assertAttachments`):attachmentUrl 的"挂在任务上才给 URL"
	 * 归属守卫靠这里收口 —— 不校验的话 `commentCreate([任意fileId])` 能把守卫骗开。
	 */
	commentCreate: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				content: z.string().min(1, "评论内容不能为空").max(5000),
				attachments: z.array(z.string().min(1).max(32)).max(20).optional(),
				mentionIds: z.array(z.string().min(1).max(36)).max(100).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			// zod 的 min(1) 拦不住 "   ":trim 后为空的评论等于没写,直接拒(与驳回原因同一口径)
			if (!input.content.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "评论内容不能为空" });
			const id = newId();
			const now = new Date();
			let receivers: string[] = [];
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				await assertTaskReadable(task, me.id);
				// 附件 id 先验存在(见 assertAttachments):attachmentUrl 的归属守卫依赖这里收口
				await assertAttachments(tx, input.attachments ?? []);
				await tx.insert(taskCommentTable).values({
					id,
					task_id: input.taskId,
					author_id: me.id,
					content: input.content.trim(),
					attachments: input.attachments?.length ? input.attachments : null,
					created_at: now,
					updated_at: now,
				});
				receivers = await createMentionNotifications(tx, task, input.content.trim(), me, input.mentionIds ?? [], id);
				await logTaskEvent(tx, {
					taskId: input.taskId,
					event: "comment.create",
					actor: me,
					targetId: id,
					detail: { attachments: input.attachments?.length ?? 0 },
					at: now,
				});
			});
			publishMentions(receivers);
			return { id };
		}),

	/** 删评论(软删)—— **只有作者本人**;管理员可删任意评论(任务创建者**不**在此列) */
	commentRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const [row] = await db
			.select()
			.from(taskCommentTable)
			.where(and(eq(taskCommentTable.id, input.id), alive(taskCommentTable)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在" });
		const task = await getTaskRow(row.task_id);
		if (row.author_id !== me.id && !(await isAdminUser(me.id))) {
			throw new TRPCError({ code: "FORBIDDEN", message: "只能删除自己的评论(管理员除外)" });
		}
		await db.transaction(async (tx) => {
			await tx
				.update(taskCommentTable)
				.set({ ...softDeleted(), updated_at: new Date() })
				.where(eq(taskCommentTable.id, row.id));
			await logTaskEvent(tx, {
				taskId: task.id,
				event: "comment.remove",
				actor: me,
				targetId: row.id,
			});
		});
		return { ok: true };
	}),

	/**
	 * 任务活动流 —— 「谁、什么时候、把什么从 A 改成 B」,按时间**倒序**分页。
	 *
	 * 与 `commentList` 同权限口径(登录 + 任务可见):任务不存在 / 已软删 ⇒ `NOT_FOUND`
	 * —— 详情页据此自动回「我的任务」(见 `task-detail-page.tsx`)。
	 *
	 * `targetName` 由**读取侧**按 `event` 决定去哪张表查(动作 → 指派人,成员 → 那个人,评论 → 不查);
	 * 是"尽力而为":查不到回退 id。`comment.*` 另给 `excerpt`(正文摘要)供活动流直接渲染。
	 */
	logList: protectedProcedure.input(z.object({ taskId: ID, ...pageInput })).query(async ({ ctx, input }) => {
		const task = await getTaskRow(input.taskId);
		await assertTaskReadable(task, requireCurrentUser(ctx).id);
		const page = input.page ?? 1;
		const pageSize = input.pageSize ?? 20;

		const [counted] = await db.select({ n: count() }).from(taskLogTable).where(eq(taskLogTable.task_id, input.taskId));
		const rows = await db
			.select()
			.from(taskLogTable)
			.where(eq(taskLogTable.task_id, input.taskId))
			// 同一毫秒撞点时用 id 兜底 —— 只为**稳定**,不表示语义(见 doc/task-close.md「活动日志」)
			.orderBy(desc(taskLogTable.created_at), desc(taskLogTable.id))
			.limit(pageSize)
			.offset((page - 1) * pageSize);

		// 要查名字的人:操作人(快照缺失时兜底)+ 各事件的主对象
		const personIds = rows.flatMap((row) => {
			const detail = detailOf(row.detail);
			const ids = [row.actor_name ? "" : row.actor_id];
			if (row.event === "member.add" || row.event === "member.remove" || row.event === "member.transfer") {
				ids.push(row.target_id ?? "");
			}
			if (row.event === "action.create" || row.event === "action.respond") {
				ids.push(typeof detail.assigneeId === "string" ? detail.assigneeId : "");
			}
			// 回复征询:展示名是**被回复的征询发起人**(「对 甲 回复征询」)
			if (row.event === "action.reply") {
				ids.push(typeof detail.consultOf === "string" ? detail.consultOf : "");
			}
			return ids.filter(Boolean);
		});
		const nameOf = await nameMapOf(personIds);

		// `action.reply` 的 target 也是**一条评论**(意见本体),摘要与 comment.* 同源
		const commentIds = rows
			.filter((row) => row.event === "comment.create" || row.event === "comment.remove" || row.event === "action.reply")
			.map((row) => row.target_id)
			.filter((id): id is string => id !== null);
		const comments =
			commentIds.length === 0
				? []
				: await db
						.select({ id: taskCommentTable.id, content: taskCommentTable.content })
						.from(taskCommentTable)
						.where(inArray(taskCommentTable.id, commentIds));
		const contentOf = new Map(comments.map((row) => [row.id, row.content]));

		return {
			items: rows.map((row) => {
				const detail = detailOf(row.detail);
				const assigneeId = typeof detail.assigneeId === "string" ? detail.assigneeId : null;
				const replyOf = typeof detail.consultOf === "string" ? detail.consultOf : null;
				const personId =
					row.event === "action.create" || row.event === "action.respond"
						? assigneeId
						: row.event === "action.reply"
							? replyOf
							: row.target_id;
				const content = row.target_id ? contentOf.get(row.target_id) : undefined;
				return {
					id: row.id,
					event: row.event,
					fromStatus: row.from_status,
					toStatus: row.to_status,
					targetId: row.target_id,
					targetName: personId ? (nameOf.get(personId) ?? personId) : null,
					actorId: row.actor_id,
					actorName: row.actor_name ?? nameOf.get(row.actor_id) ?? null,
					detail: row.detail,
					excerpt: content ? content.slice(0, 80) : null,
					createdAt: row.created_at ? row.created_at.toISOString() : null,
				};
			}),
			total: Number(counted?.n ?? 0),
		};
	}),
});
