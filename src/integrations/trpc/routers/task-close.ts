import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import {
	sysFile,
	sysUser,
	taskCloseAction,
	taskCloseComment,
	taskCloseLog,
	taskCloseMember,
	taskCloseTask,
	taskCloseWorkflow,
} from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { alive, softDeleted } from "#/lib/soft-delete";
import { getStorage, isPublicBucket } from "#/lib/storage";
import { LOCKED_STATUS, type TaskLogEvent } from "#/lib/task-close-log";
import { DEFAULT_WORKFLOW_ID, type WorkflowStatus } from "#/lib/task-close-spec";
import { normalizePayload, parseBlocks, taskPayloadSchema } from "#/lib/task-content";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../init";

/**
 * 任务闭环(tc_close 模块)—— 「甲发任务给乙 → 处置 → 审批 → 关闭归档」。
 *
 * 表 / 状态机 / `who` 协议的设计真源是 `doc/task-close.md`,这里只写接口。
 *
 * **授权不走 RBAC 权限点**,由 `who` 协议在 resolver 内判定(见 `canAct`)。
 * 理由:本模块还没有菜单 / 按钮,硬配权限码等于造出「没人能被授予」的假权限,
 * 结果是所有账号集体失权(`lib/rbac.ts` 文件头写过这个坑)。
 * 所以 16 个接口全部登记在 `UNMAPPED_MUTATIONS` / `UNMAPPED_QUERIES` 里。
 *
 * **可见性 v1 口径**:任何登录用户都能读任何任务(无菜单 = RBAC 允许访客)。
 * `tc_member` 决定的是**谁能推进**,不是**谁能看见** —— 见文档「权限矩阵」。
 *
 * **管理员旁路**:「系统管理员」角色(`isAdminUser`)在本模块**什么都可以** —— 读路径由
 * `permissionsOf` 下发 `isAdmin`,写路径的 `assertCanManage` / `canAct` / `commentRemove` 一并放行,
 * 三处判据同源。仍受状态机完整性约束(边必须存在),只是不受 `who` 限制。
 */

type TaskRow = typeof taskCloseTask.$inferSelect;
type ActionRow = typeof taskCloseAction.$inferSelect;
type MemberRow = typeof taskCloseMember.$inferSelect;
type WorkflowRow = typeof taskCloseWorkflow.$inferSelect;

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

/** `who` 协议合法值(文档「who 协议」)—— 数组是 OR */
const MEMBER_ROLES = ["participant", "executor"] as const;
/** 还活着、占着锁的 action 状态:有这些就说明任务被锁 */
const LIVE_ACTION_STATUS = ["active", "queued"] as const;
/** 根级动作待答复 = `active`;链中排队 = `queued`(v1 不产生);答复完 = `done` / `rejected` */
const ROLE_ENUM = z.enum(["participant", "executor"]);
/** 任务 id / 动作 id 都是 varchar(191)(nanoid),入参统一按这个长度校验 */
const ID = z.string().min(1).max(191);

/** `who` 协议合法值(`creator` / `participant` / `executor` / `any`)—— 编辑模板时的可选项 */
const WHO_ENUM = z.enum(["creator", "participant", "executor", "any"]);

/** 状态图模板的编辑入参(`name` 与三个结构一起进 `tc_workflow.payload`) */
const workflowInput = z.object({
	name: z.string().min(1, "模板名称不能为空").max(100),
	statuses: z
		.array(z.object({ value: z.string().min(1).max(32), label: z.string().min(1).max(32) }))
		.min(1, "至少要有 1 个状态")
		.max(30),
	initial: z.string().min(1).max(32),
	edges: z
		.array(
			z.object({
				from: z.string().min(1).max(32),
				to: z.string().min(1).max(32),
				who: z.array(WHO_ENUM).min(1, "每条边至少选 1 个可发起角色").max(4),
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
		statuses.push({ value, label: item.label.trim() });
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
	return { name: input.name.trim(), statuses, initial, edges };
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
	description: row.description,
	payload: row.payload,
	workflow: row.workflow,
	updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
});

const toMember = (row: MemberRow, nameOf: Map<string, string>) => ({
	userId: row.user_id,
	name: nameOf.get(row.user_id) ?? null,
	role: row.role,
	isPrimary: row.is_primary === 1,
});

const toAction = (row: ActionRow, nameOf: Map<string, string>) => ({
	id: row.id,
	taskId: row.task_id,
	serialNo: row.serial_no,
	parentActionId: row.parent_action_id,
	isLocking: row.is_locking,
	fromStatus: row.from_status,
	toStatus: row.to_status,
	sequence: row.sequence,
	createdId: row.created_id,
	createdName: nameOf.get(row.created_id) ?? null,
	handleId: row.handle_id,
	handleName: nameOf.get(row.handle_id) ?? null,
	status: row.status,
	createdAt: row.created_at ? row.created_at.toISOString() : null,
	updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
});

// ────────────────────────────── 取行 / 判定 ──────────────────────────────

const workflowOf = (task: TaskRow): WorkflowPayload => task.workflow as WorkflowPayload;

/** 取一条活着的任务;取不到(含已软删)抛 `NOT_FOUND` —— 读路径都要过 `alive()` */
async function getTaskRow(id: string): Promise<TaskRow> {
	const [row] = await db
		.select()
		.from(taskCloseTask)
		.where(and(eq(taskCloseTask.id, id), alive(taskCloseTask)))
		.limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
	return row;
}

/** 取任务并**锁行**(`for update`)—— 事务内改状态前必须走它,否则并发下会丢转移 */
async function lockTask(tx: Tx, id: string): Promise<TaskRow> {
	const [row] = await tx
		.select()
		.from(taskCloseTask)
		.where(and(eq(taskCloseTask.id, id), alive(taskCloseTask)))
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

/** 这个人在这条任务上通过 `tc_member` 拿到的角色(不含 creator —— 那个是 `tc_task` 固有列) */
async function memberRolesOf(taskId: string, userId: string, reader: Reader = db): Promise<string[]> {
	const rows = await reader
		.select({ role: taskCloseMember.role })
		.from(taskCloseMember)
		.where(and(eq(taskCloseMember.task_id, taskId), eq(taskCloseMember.user_id, userId)));
	return rows.map((row) => row.role);
}

/**
 * `who` 协议判定(文档「who 协议」)。
 *
 * - `who = []` → **false**:系统自带,前端不开(任何用户都不能据此发起);
 * - `"any"` → true(三者并集的便利写法);
 * - `"creator"` → 读 `tc_task.creator_id`,**不走 `tc_member`**;
 * - `"participant"` / `"executor"` → 查 `tc_member`;
 * - 数组 = OR。
 *
 * `memberRoles` 传已查到的角色可以省一次查询(详情页里要判很多条边)。
 */
async function canAct(
	task: TaskRow,
	meId: string,
	who: readonly string[],
	memberRoles?: readonly string[],
): Promise<boolean> {
	if (who.length === 0) return false;
	if (who.includes("any")) return true;
	if (who.includes("creator") && task.creator_id === meId) return true;
	const wanted = MEMBER_ROLES.filter((role) => who.includes(role));
	if (wanted.length === 0) return false;
	const roles = memberRoles ?? (await memberRolesOf(task.id, meId));
	return wanted.some((role) => roles.includes(role));
}

/** 任务被锁 = 存在 `is_locking=1` 且状态还活着的 action(文档「锁语义」) */
async function isLocked(taskId: string, reader: Reader = db): Promise<boolean> {
	const [row] = await reader
		.select({ id: taskCloseAction.id })
		.from(taskCloseAction)
		.where(
			and(
				eq(taskCloseAction.task_id, taskId),
				eq(taskCloseAction.is_locking, true),
				inArray(taskCloseAction.status, [...LIVE_ACTION_STATUS]),
			),
		)
		.limit(1);
	return Boolean(row);
}

/** 一批 user_id → 姓名。分批查 + 内存拼(项目现有风格,不引入 leftJoin) */
async function nameMapOf(ids: readonly string[]): Promise<Map<string, string>> {
	const uniq = [...new Set(ids.filter(Boolean))];
	if (uniq.length === 0) return new Map();
	const rows = await db.select({ id: sysUser.id, name: sysUser.name }).from(sysUser).where(inArray(sysUser.id, uniq));
	return new Map(rows.map((row) => [row.id, row.name]));
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
	await tx.insert(taskCloseLog).values({
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
	for (const edge of workflowOf(task).edges ?? []) {
		if (edge.from !== task.status) continue;
		// 管理员不受 `who` 限制:当前状态能走的边他都能走
		if (!isAdmin && !(await canAct(task, meId, edge.who ?? [], memberRoles))) continue;
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
		locked: await isLocked(task.id),
		/** 我能**直接**改到的状态 */
		transitions,
		/** 我能发起「改状态」action 的目标状态(可空;多个时前端让用户选) */
		actionTargets,
		/** 我能发起「改状态」的 action */
		canInitiateStatusAction,
		/** 我能发起「不改状态」的 action(征询)—— creator / participant / executor / admin */
		canInitiateConsult: myRoles.length > 0,
		/** 加成员:所有登录用户(任务可见即可)—— 与「全员可评论」同口径 */
		canAddMember: true,
		/** 移出成员:创建者或管理员 */
		canManageMembers: isAdmin || isCreator,
		canUpdate: isAdmin || isCreator,
		canRemove: isAdmin || isCreator,
	};
}

const pageInput = {
	page: z.number().int().min(1).optional(),
	pageSize: z.number().int().min(1).max(100).optional(),
};

export const taskCloseRouter = createTRPCRouter({
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
			.from(taskCloseWorkflow)
			.where(alive(taskCloseWorkflow))
			.orderBy(asc(taskCloseWorkflow.created_at));
		return rows.map((row: WorkflowRow) => ({
			id: row.id,
			name: (row.payload as WorkflowPayload).name ?? row.id,
			payload: row.payload,
			builtin: row.id === DEFAULT_WORKFLOW_ID,
			createdAt: row.created_at ? row.created_at.toISOString() : null,
			updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
		}));
	}),

	/** 模板详情(流程模板页的「详情」弹窗)—— 结构与 `payload` 摊平,前端不必再解 JSON */
	workflowGet: protectedProcedure.input(z.object({ id: ID })).query(async ({ input }) => {
		const [row] = await db
			.select()
			.from(taskCloseWorkflow)
			.where(and(eq(taskCloseWorkflow.id, input.id), alive(taskCloseWorkflow)))
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
		await db.insert(taskCloseWorkflow).values({
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
			.select({ id: taskCloseWorkflow.id })
			.from(taskCloseWorkflow)
			.where(and(eq(taskCloseWorkflow.id, input.id), alive(taskCloseWorkflow)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "流程模板不存在" });
		await db
			.update(taskCloseWorkflow)
			.set({ payload: normalizeWorkflow(input), updated_at: new Date() })
			.where(eq(taskCloseWorkflow.id, row.id));
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
			.select({ id: taskCloseWorkflow.id })
			.from(taskCloseWorkflow)
			.where(and(eq(taskCloseWorkflow.id, input.id), alive(taskCloseWorkflow)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "流程模板不存在" });
		await db
			.update(taskCloseWorkflow)
			.set({ ...softDeleted(), updated_at: new Date() })
			.where(eq(taskCloseWorkflow.id, row.id));
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
					keyword: z.string().max(64).optional(),
					mine: z.boolean().optional(),
					...pageInput,
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const page = input?.page ?? 1;
			const pageSize = input?.pageSize ?? 20;

			const conds: (SQL | undefined)[] = [alive(taskCloseTask)];
			if (input?.status) conds.push(eq(taskCloseTask.status, input.status));
			if (input?.keyword) conds.push(like(taskCloseTask.name, `%${input.keyword}%`));
			if (input?.mine) {
				conds.push(
					or(
						eq(taskCloseTask.creator_id, me.id),
						inArray(
							taskCloseTask.id,
							db
								.select({ id: taskCloseMember.task_id })
								.from(taskCloseMember)
								.where(eq(taskCloseMember.user_id, me.id)),
						),
					),
				);
			}
			const where = and(...conds);

			const [counted] = await db.select({ n: count() }).from(taskCloseTask).where(where);
			const rows = await db
				.select()
				.from(taskCloseTask)
				.where(where)
				.orderBy(desc(taskCloseTask.created_at))
				.limit(pageSize)
				.offset((page - 1) * pageSize);
			const nameOf = await nameMapOf(rows.map((row) => row.creator_id));

			return {
				items: rows.map((row) => toTaskBrief(row, nameOf.get(row.creator_id) ?? null)),
				total: Number(counted?.n ?? 0),
			};
		}),

	/** 任务详情:本体 + 成员 + 动作流 + **我能做什么** */
	taskGet: protectedProcedure.input(z.object({ id: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.id);

		const memberRows = await db
			.select()
			.from(taskCloseMember)
			.where(eq(taskCloseMember.task_id, task.id))
			.orderBy(desc(taskCloseMember.is_primary), asc(taskCloseMember.created_at));
		const actionRows = await db
			.select()
			.from(taskCloseAction)
			.where(eq(taskCloseAction.task_id, task.id))
			.orderBy(asc(taskCloseAction.created_at));

		const nameOf = await nameMapOf([
			task.creator_id,
			...memberRows.map((row) => row.user_id),
			...actionRows.flatMap((row) => [row.created_id, row.handle_id]),
		]);

		// 内容区(块)+ 附件区由 `task.payload` 派生:块做**容错解析**(未知 kind 交给前端占位),附件 join `sys_file`
		const payload = (task.payload ?? null) as { content?: unknown; attachments?: unknown } | null;
		const content = parseBlocks(payload?.content);
		const attachmentIds = Array.isArray(payload?.attachments)
			? payload.attachments.filter((id): id is string => typeof id === "string")
			: [];
		const attachments = await resolveAttachments(attachmentIds);

		return {
			task: toTaskDetail(task, nameOf.get(task.creator_id) ?? null),
			content,
			attachments,
			members: memberRows.map((row) => toMember(row, nameOf)),
			actions: actionRows.map((row) => toAction(row, nameOf)),
			permissions: await permissionsOf(task, me.id),
			/** 当前用户 id —— 前端要靠它判断「这条动作 / 评论是不是我的」,前端不再单独问一次会话 */
			meId: me.id,
		};
	}),

	/**
	 * 任务附件的取地址(预览 / 下载)—— **只放行挂在这条任务上的文件**。
	 *
	 * 为什么不复用 `file.url`:那个按 `/settings/files` 页面码授权,任务页调不到;若把它放开到任务页,
	 * 又等于"任何登录用户凭 id 就能取任意文件"。所以这里先确认 `fileId` 确实挂在本任务上
	 * (`payload.attachments` ∪ 评论附件),再签地址 —— 权限口径与「任务可见即可读」一致。
	 * `download=true` 走预签名(带 `Content-Disposition`,按原始文件名下载)。
	 */
	attachmentUrl: protectedProcedure
		.input(z.object({ taskId: ID, fileId: z.string().min(1).max(32), download: z.boolean().optional() }))
		.query(async ({ input }) => {
			const task = await getTaskRow(input.taskId);
			const payload = (task.payload ?? null) as { attachments?: unknown } | null;
			const payloadIds = Array.isArray(payload?.attachments)
				? payload.attachments.filter((id): id is string => typeof id === "string")
				: [];
			let owned = payloadIds.includes(input.fileId);
			if (!owned) {
				const comments = await db
					.select({ attachments: taskCloseComment.attachments })
					.from(taskCloseComment)
					.where(and(eq(taskCloseComment.task_id, task.id), alive(taskCloseComment)));
				owned = comments.some(
					(row) => Array.isArray(row.attachments) && (row.attachments as unknown[]).includes(input.fileId),
				);
			}
			if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "附件不存在" });

			const [row] = await db.select().from(sysFile).where(eq(sysFile.id, input.fileId)).limit(1);
			if (!row || Number(row.status) === 2) {
				throw new TRPCError({ code: "NOT_FOUND", message: "附件不存在或已删除" });
			}

			const storage = await getStorage();
			const url =
				input.download || !isPublicBucket(row.bucket)
					? await storage.presignGet(
							row.bucket,
							row.object_key,
							undefined,
							input.download ? row.origin_name : undefined,
						)
					: storage.publicUrl(row.bucket, row.object_key);
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
				/** ISO 字符串,例:`2026-10-09T18:00:00.000Z` */
				dueAt: z.string().max(64).nullish(),
				/** `0` = P0 / `1` = P1 / `2` = P2;留空表示「未设置」 */
				priority: z.number().int().min(0).max(2).nullish(),
				workflowId: ID,
				payload: taskPayloadSchema.nullish(),
				members: z
					.array(
						z.object({
							userId: z.string().min(1).max(36),
							role: ROLE_ENUM,
							isPrimary: z.boolean().optional(),
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
				.from(taskCloseWorkflow)
				.where(and(eq(taskCloseWorkflow.id, input.workflowId), alive(taskCloseWorkflow)))
				.limit(1);
			if (!workflow) throw new TRPCError({ code: "NOT_FOUND", message: "状态图模板不存在" });
			const snapshot = workflow.payload as WorkflowPayload;

			const id = newId();
			const now = new Date();
			await db.transaction(async (tx) => {
				await tx.insert(taskCloseTask).values({
					id,
					name: input.name.trim(),
					description: input.description?.trim() || null,
					status: snapshot.initial,
					creator_id: me.id,
					due_at: input.dueAt ? new Date(input.dueAt) : null,
					priority: input.priority ?? null,
					payload: normalizePayload(input.payload),
					workflow: snapshot,
					created_at: now,
					updated_at: now,
				});
				const members = (input.members ?? [])
					.filter((member) => member.userId !== me.id)
					.map((member) => ({
						id: newId(),
						task_id: id,
						user_id: member.userId,
						role: member.role,
						// 主执行人只对 executor 有意义;participant 强制 0(见文档)
						is_primary: member.role === "executor" && member.isPrimary === true ? 1 : 0,
						created_at: now,
						updated_at: now,
					}));
				if (members.length > 0) await tx.insert(taskCloseMember).values(members);
				// 一次用户操作 = 一行:初始成员折进 detail,不另写 member.add(见 doc/task-close.md「活动日志」)
				await logTaskEvent(tx, {
					taskId: id,
					event: "task.create",
					actor: me,
					toStatus: snapshot.initial,
					detail: {
						workflowId: input.workflowId,
						members: members.map((member) => ({
							userId: member.user_id,
							role: member.role,
							isPrimary: member.is_primary === 1,
						})),
					},
					at: now,
				});
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
				dueAt: z.string().max(64).nullish(),
				/** `undefined` = 不传(保旧值);`null` = 显式清空;`0|1|2` = 改值 */
				priority: z.number().int().min(0).max(2).nullish(),
				payload: taskPayloadSchema.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const task = await getTaskRow(input.id);
			await assertCanManage(task, me.id);

			// 变更前的值只能在这里取(update 之后就没了)—— 日志要写"从什么改成什么"
			const nextName = input.name.trim();
			const nextDescription = input.description?.trim() || null;
			const nextDueAt = input.dueAt ? new Date(input.dueAt) : null;
			/** 优先级 `undefined` = 不动;`null` = 显式清空;字符串 = 改值 */
			const nextPriority = input.priority === undefined ? undefined : input.priority;
			const nextPayload = normalizePayload(input.payload);
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

			const now = new Date();
			await db.transaction(async (tx) => {
				const setValue: Partial<typeof taskCloseTask.$inferInsert> = {
					name: nextName,
					description: nextDescription,
					due_at: nextDueAt,
					payload: nextPayload,
					updated_at: now,
				};
				if (nextPriority !== undefined) setValue.priority = nextPriority;
				await tx.update(taskCloseTask).set(setValue).where(eq(taskCloseTask.id, task.id));
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

	/** 软删任务 —— 只写 `tc_task.deleted_at`;成员 / 动作 / 评论跟着主行一起"看不见"(读路径都先取任务) */
	taskRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.id);
		await assertCanManage(task, me.id);
		const now = new Date();
		await db.transaction(async (tx) => {
			await tx
				.update(taskCloseTask)
				.set({ ...softDeleted(), updated_at: now })
				.where(eq(taskCloseTask.id, task.id));
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
	 * **只有管理员例外**:目标状态只要是模板里声明的,**任意状态都能直接改**(② ③ 都不查)。
	 * 其他角色(含创建者)**一律按模板走** —— 前端只把 `permissions.transitions` 里那几条直改边列出来。
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
				// 只有管理员免检;其他角色(含创建者)都必须走模板里声明的那条 direct 边、且 who 命中
				if (!isAdmin) {
					if (!edge) {
						throw new TRPCError({ code: "BAD_REQUEST", message: `没有 ${task.status} → ${input.to} 的直接转移` });
					}
					if (!(await canAct(task, me.id, edge.who ?? []))) {
						throw new TRPCError({ code: "FORBIDDEN", message: "你没有权限做这次状态转移" });
					}
				}
				const now = new Date();
				await tx.update(taskCloseTask).set({ status: input.to, updated_at: now }).where(eq(taskCloseTask.id, task.id));
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

	/** 加参与者 / 执行者 —— **所有登录用户都能加**(与「全员可评论」同口径);`isPrimary` 只对 executor 有意义,且同一任务至多一个 */
	memberAdd: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				userId: z.string().min(1).max(36),
				role: ROLE_ENUM,
				isPrimary: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const task = await getTaskRow(input.taskId);
			if (input.userId === task.creator_id) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "创建者不必进成员表(他是 tc_task.creator_id)" });
			}
			const [user] = await db
				.select({ id: sysUser.id })
				.from(sysUser)
				.where(and(eq(sysUser.id, input.userId), alive(sysUser)))
				.limit(1);
			if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });

			const primary = input.role === "executor" && input.isPrimary === true;
			const now = new Date();
			await db.transaction(async (tx) => {
				const [dup] = await tx
					.select({ id: taskCloseMember.id })
					.from(taskCloseMember)
					.where(
						and(
							eq(taskCloseMember.task_id, task.id),
							eq(taskCloseMember.user_id, input.userId),
							eq(taskCloseMember.role, input.role),
						),
					)
					.limit(1);
				if (dup) throw new TRPCError({ code: "BAD_REQUEST", message: "这个人已经是该角色了" });
				if (primary) {
					// 主执行人至多 1 行:先把现有的降下来。应用层保证,不上 DDL 硬约束(见文档「风险与边界」)
					await tx
						.update(taskCloseMember)
						.set({ is_primary: 0, updated_at: now })
						.where(and(eq(taskCloseMember.task_id, task.id), eq(taskCloseMember.role, "executor")));
				}
				await tx.insert(taskCloseMember).values({
					id: newId(),
					task_id: task.id,
					user_id: input.userId,
					role: input.role,
					is_primary: primary ? 1 : 0,
					created_at: now,
					updated_at: now,
				});
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "member.add",
					actor: me,
					targetId: input.userId,
					detail: { role: input.role, isPrimary: primary },
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
				await tx
					.delete(taskCloseMember)
					.where(
						and(
							eq(taskCloseMember.task_id, task.id),
							eq(taskCloseMember.user_id, input.userId),
							eq(taskCloseMember.role, input.role),
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
	 * **转交**执行人 —— 把「执行者」这个身份交给同任务里的另一位参与人员(原子换人)。
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
					.select({ id: taskCloseMember.id })
					.from(taskCloseMember)
					.where(and(eq(taskCloseMember.task_id, task.id), eq(taskCloseMember.user_id, input.userId)));
				if (target.length === 0) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "只能转交给这条任务的参与人员" });
				}

				// 转交前的主执行人(没有主执行人就退回「操作者本人,若他是执行者」)
				const executors = await tx
					.select({ userId: taskCloseMember.user_id, isPrimary: taskCloseMember.is_primary })
					.from(taskCloseMember)
					.where(and(eq(taskCloseMember.task_id, task.id), eq(taskCloseMember.role, "executor")));
				const fromUserId =
					executors.find((row) => row.isPrimary === 1)?.userId ?? (myRoles.includes("executor") ? me.id : null);
				const demote = executors.map((row) => row.userId).filter((userId) => userId !== input.userId);

				// 目标 → 执行者 + 主执行人(先清掉它原有的行,免得留下 participant + executor 两行)
				await tx
					.delete(taskCloseMember)
					.where(and(eq(taskCloseMember.task_id, task.id), eq(taskCloseMember.user_id, input.userId)));
				await tx.insert(taskCloseMember).values({
					id: newId(),
					task_id: task.id,
					user_id: input.userId,
					role: "executor",
					is_primary: 1,
					created_at: now,
					updated_at: now,
				});
				// 其余执行者 → 参与者(与目标同一人已排除)
				for (const userId of demote) {
					await tx
						.delete(taskCloseMember)
						.where(and(eq(taskCloseMember.task_id, task.id), eq(taskCloseMember.user_id, userId)));
					await tx.insert(taskCloseMember).values({
						id: newId(),
						task_id: task.id,
						user_id: userId,
						role: "participant",
						is_primary: 0,
						created_at: now,
						updated_at: now,
					});
				}
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

	/** 一条任务的动作流(时间正序,详情页时间线) */
	actionList: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ input }) => {
		const rows = await db
			.select()
			.from(taskCloseAction)
			.where(eq(taskCloseAction.task_id, input.taskId))
			.orderBy(asc(taskCloseAction.created_at));
		const nameOf = await nameMapOf(rows.flatMap((row) => [row.created_id, row.handle_id]));
		return rows.map((row) => toAction(row, nameOf));
	}),

	/** 待我处理 —— 跨任务。`handle_id` 可能不是任务成员,没有这个列表闭环就接不上 */
	actionMine: protectedProcedure.input(z.object({ ...pageInput }).optional()).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const page = input?.page ?? 1;
		const pageSize = input?.pageSize ?? 20;
		const where = and(eq(taskCloseAction.handle_id, me.id), inArray(taskCloseAction.status, [...LIVE_ACTION_STATUS]));

		const [counted] = await db.select({ n: count() }).from(taskCloseAction).where(where);
		const rows = await db
			.select()
			.from(taskCloseAction)
			.where(where)
			.orderBy(desc(taskCloseAction.created_at))
			.limit(pageSize)
			.offset((page - 1) * pageSize);

		const taskIds = [...new Set(rows.map((row) => row.task_id))];
		const tasks =
			taskIds.length === 0
				? []
				: await db
						.select({ id: taskCloseTask.id, name: taskCloseTask.name, status: taskCloseTask.status })
						.from(taskCloseTask)
						.where(inArray(taskCloseTask.id, taskIds));
		const taskOf = new Map(tasks.map((task) => [task.id, task]));
		const nameOf = await nameMapOf(rows.map((row) => row.created_id));

		return {
			items: rows.map((row) => ({
				...toAction(row, nameOf),
				taskName: taskOf.get(row.task_id)?.name ?? null,
				taskStatus: taskOf.get(row.task_id)?.status ?? null,
			})),
			total: Number(counted?.n ?? 0),
		};
	}),

	/**
	 * 发起动作 —— 审批(`toStatus` 有值)和征询(`toStatus` 为空)是同一张表的同一种模式。
	 *
	 * 派生规则(文档「状态机推进」):
	 *  · 根级(`parentActionId` 不传):`from_status = 当前任务状态`,`serial_no = 自己 id`,`sequence = 0`;
	 *    `toStatus` 有值 → `is_locking = 1` 且任务转 `pending`;`toStatus` 为空 → `is_locking = 0`(不锁、不动状态);
	 *  · 子级:`from_status` / `to_status` 必须为 NULL,继承父的 `serial_no`,`sequence = 父 + 1`(**不推进任务状态**)。
	 *
	 * 权限:`toStatus` 有值 → 走快照里 `via='action'` 的边 + `who` 判定;为空 → 创建者 / 参与者 / 执行者任一。
	 */
	actionCreate: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				toStatus: z.string().min(1).max(32).nullish(),
				handleId: z.string().min(1).max(191),
				parentActionId: ID.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const [handle] = await db
				.select({ id: sysUser.id })
				.from(sysUser)
				.where(and(eq(sysUser.id, input.handleId), alive(sysUser)))
				.limit(1);
			if (!handle) throw new TRPCError({ code: "NOT_FOUND", message: "指派人不存在" });

			const id = newId();
			const now = new Date();
			const isAdmin = await isAdminUser(me.id);
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);

				let parent: ActionRow | null = null;
				if (input.parentActionId) {
					const [row] = await tx
						.select()
						.from(taskCloseAction)
						.where(eq(taskCloseAction.id, input.parentActionId))
						.limit(1);
					if (!row || row.task_id !== task.id) {
						throw new TRPCError({ code: "NOT_FOUND", message: "父动作不存在" });
					}
					parent = row;
				}

				// 子动作不推进任务状态,权限在父动作上已经判过
				const toStatus = parent ? null : (input.toStatus ?? null);
				if (!parent) {
					if (await isLocked(task.id, tx)) {
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
						if (!isAdmin && !(await canAct(task, me.id, edge.who ?? []))) {
							throw new TRPCError({ code: "FORBIDDEN", message: "你没有权限发起这次状态变更" });
						}
					} else if (!isAdmin && (await memberRolesOf(task.id, me.id, tx)).length === 0 && task.creator_id !== me.id) {
						throw new TRPCError({ code: "FORBIDDEN", message: "只有创建者 / 参与者 / 执行者能发起征询" });
					}
				}

				const isLocking = !parent && toStatus !== null;
				await tx.insert(taskCloseAction).values({
					id,
					task_id: task.id,
					serial_no: parent ? parent.serial_no : id,
					parent_action_id: parent ? parent.id : null,
					is_locking: isLocking,
					from_status: parent ? null : task.status,
					to_status: toStatus,
					sequence: parent ? parent.sequence + 1 : 0,
					created_id: me.id,
					handle_id: input.handleId,
					status: parent ? "queued" : "active",
					created_at: now,
					updated_at: now,
				});
				if (isLocking) {
					await tx
						.update(taskCloseTask)
						.set({ status: LOCKED_STATUS, updated_at: now })
						.where(eq(taskCloseTask.id, task.id));
				}
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "action.create",
					actor: me,
					// 只有锁定时任务状态才真的变了(pending);征询 / 子动作不动状态 ⇒ 两列都空
					fromStatus: isLocking ? task.status : null,
					toStatus: isLocking ? LOCKED_STATUS : null,
					targetId: id,
					detail: {
						// 「这次想去哪」:审批是目标状态,征询是 null —— 不要拿 to_status 兼职
						intendedTo: toStatus,
						handleId: input.handleId,
						isLocking,
						parentActionId: parent ? parent.id : null,
						sequence: parent ? parent.sequence + 1 : 0,
					},
					at: now,
				});
			});
			return { id };
		}),

	/**
	 * 答复动作 —— 只有 `handle_id` 本人能答。
	 *
	 * 结算:根级 + `is_locking` 通过 → 任务转 `to_status`;驳回 → 退回 `from_status`(文档「状态机推进」)。
	 * 锁顺序与 `taskTransit` 一致(先 `tc_task` 再 `tc_action`),避免互相等锁。
	 */
	actionRespond: protectedProcedure
		.input(z.object({ id: ID, approved: z.boolean(), reason: z.string().max(2000).nullish() }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			await db.transaction(async (tx) => {
				const [probe] = await tx
					.select({ taskId: taskCloseAction.task_id })
					.from(taskCloseAction)
					.where(eq(taskCloseAction.id, input.id))
					.limit(1);
				if (!probe) throw new TRPCError({ code: "NOT_FOUND", message: "动作不存在" });

				const task = await lockTask(tx, probe.taskId);
				const [action] = await tx
					.select()
					.from(taskCloseAction)
					.where(eq(taskCloseAction.id, input.id))
					.limit(1)
					.for("update");
				if (!action) throw new TRPCError({ code: "NOT_FOUND", message: "动作不存在" });
				if (action.handle_id !== me.id) {
					throw new TRPCError({ code: "FORBIDDEN", message: "只有指派人能答复这个动作" });
				}
				if (!(LIVE_ACTION_STATUS as readonly string[]).includes(action.status)) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "这个动作已经答复过了" });
				}
				// 驳回**必须写原因**;原因直接以**评论**留档(复用评论流,和普通评论一起看),不另造一张"驳回意见"表
				const reason = input.reason?.trim();
				if (!input.approved && !reason) {
					throw new TRPCError({ code: "BAD_REQUEST", message: "驳回要填写原因" });
				}

				await tx
					.update(taskCloseAction)
					.set({ status: input.approved ? "done" : "rejected", updated_at: new Date() })
					.where(eq(taskCloseAction.id, action.id));

				if (!input.approved && reason) {
					await tx.insert(taskCloseComment).values({
						id: newId(),
						task_id: task.id,
						author_id: me.id,
						content: `驳回原因:${reason}`,
						created_at: new Date(),
						updated_at: new Date(),
					});
				}

				const now = new Date();
				// 只有根级 + 锁定的动作推进任务状态(子动作的 from/to 是 NULL)
				let movedTo: string | null = null;
				if (action.parent_action_id === null && action.is_locking) {
					const next = input.approved ? action.to_status : action.from_status;
					if (next && next !== task.status) {
						await tx.update(taskCloseTask).set({ status: next, updated_at: now }).where(eq(taskCloseTask.id, task.id));
						movedTo = next;
					}
				}
				await logTaskEvent(tx, {
					taskId: task.id,
					event: "action.respond",
					actor: me,
					// 通过 = pending → to_status;驳回 = pending → from_status;子动作 / 没动 ⇒ 两列都空
					fromStatus: movedTo ? task.status : null,
					toStatus: movedTo,
					targetId: action.id,
					detail: {
						approved: input.approved,
						// 驳回原因同时落了条评论(评论流要看);这里再存一份是给活动流直接渲染用
						reason: reason ?? null,
						actionStatus: input.approved ? "done" : "rejected",
					},
					at: now,
				});
			});
			return { ok: true };
		}),

	// ────────────────────────────── 评论 ──────────────────────────────

	/** 评论流 —— 附件只存了 `sys_file.id`,这里回填文件名 / 大小;已删文件直接丢掉(不留空行) */
	commentList: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ input }) => {
		const rows = await db
			.select()
			.from(taskCloseComment)
			.where(and(eq(taskCloseComment.task_id, input.taskId), alive(taskCloseComment)))
			.orderBy(asc(taskCloseComment.created_at));

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
	 * 发评论 —— **任何登录用户**,不限 `tc_member`(文档「权限矩阵」)。
	 *
	 * 附件 id 不校验存在性:它只能从 `file.presign` / `file.confirm` 拿到,
	 * 校验等于替 `sys_file` 再做一遍状态机(读的时候已经会丢掉无效 id)。
	 */
	commentCreate: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				content: z.string().min(1, "评论内容不能为空").max(5000),
				attachments: z.array(z.string().min(1).max(32)).max(20).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			await getTaskRow(input.taskId);
			const id = newId();
			const now = new Date();
			await db.transaction(async (tx) => {
				await tx.insert(taskCloseComment).values({
					id,
					task_id: input.taskId,
					author_id: me.id,
					content: input.content.trim(),
					attachments: input.attachments?.length ? input.attachments : null,
					created_at: now,
					updated_at: now,
				});
				await logTaskEvent(tx, {
					taskId: input.taskId,
					event: "comment.create",
					actor: me,
					targetId: id,
					detail: { attachments: input.attachments?.length ?? 0 },
					at: now,
				});
			});
			return { id };
		}),

	/** 删评论(软删)—— **只有作者本人**;管理员可删任意评论(任务创建者**不**在此列) */
	commentRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const [row] = await db
			.select()
			.from(taskCloseComment)
			.where(and(eq(taskCloseComment.id, input.id), alive(taskCloseComment)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在" });
		const task = await getTaskRow(row.task_id);
		if (row.author_id !== me.id && !(await isAdminUser(me.id))) {
			throw new TRPCError({ code: "FORBIDDEN", message: "只能删除自己的评论(管理员除外)" });
		}
		await db.transaction(async (tx) => {
			await tx
				.update(taskCloseComment)
				.set({ ...softDeleted(), updated_at: new Date() })
				.where(eq(taskCloseComment.id, row.id));
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
	 * 与 `actionList` / `commentList` 同权限口径(登录 + 任务可见):任务不存在 / 已软删 ⇒ `NOT_FOUND`
	 * —— 详情页据此自动回「我的任务」(见 `task-close-detail-page.tsx`)。
	 *
	 * `targetName` 由**读取侧**按 `event` 决定去哪张表查(动作 → 指派人,成员 → 那个人,评论 → 不查);
	 * 是"尽力而为":查不到回退 id。`comment.*` 另给 `excerpt`(正文摘要)供活动流直接渲染。
	 */
	logList: protectedProcedure.input(z.object({ taskId: ID, ...pageInput })).query(async ({ input }) => {
		await getTaskRow(input.taskId);
		const page = input.page ?? 1;
		const pageSize = input.pageSize ?? 20;

		const [counted] = await db.select({ n: count() }).from(taskCloseLog).where(eq(taskCloseLog.task_id, input.taskId));
		const rows = await db
			.select()
			.from(taskCloseLog)
			.where(eq(taskCloseLog.task_id, input.taskId))
			// 同一毫秒撞点时用 id 兜底 —— 只为**稳定**,不表示语义(见 doc/task-close.md「活动日志」)
			.orderBy(desc(taskCloseLog.created_at), desc(taskCloseLog.id))
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
				ids.push(typeof detail.handleId === "string" ? detail.handleId : "");
			}
			return ids.filter(Boolean);
		});
		const nameOf = await nameMapOf(personIds);

		const commentIds = rows
			.filter((row) => row.event === "comment.create" || row.event === "comment.remove")
			.map((row) => row.target_id)
			.filter((id): id is string => id !== null);
		const comments =
			commentIds.length === 0
				? []
				: await db
						.select({ id: taskCloseComment.id, content: taskCloseComment.content })
						.from(taskCloseComment)
						.where(inArray(taskCloseComment.id, commentIds));
		const contentOf = new Map(comments.map((row) => [row.id, row.content]));

		return {
			items: rows.map((row) => {
				const detail = detailOf(row.detail);
				const handleId = typeof detail.handleId === "string" ? detail.handleId : null;
				const personId = row.event === "action.create" || row.event === "action.respond" ? handleId : row.target_id;
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
