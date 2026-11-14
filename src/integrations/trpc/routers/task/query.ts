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
	taskActionTable,
	taskCommentTable,
	taskLogTable,
	taskMemberTable,
	taskReportSubmissionTable,
	taskReportTable,
	taskTable,
} from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { alive } from "#/lib/soft-delete";
import { getObjectUrl } from "#/lib/storage";
import { parseBlocks } from "#/lib/task/payload";
import { executorReminderEvents, executorReminderRuleSchema, readTaskReminderConfig } from "#/lib/task/reminder-spec";
import { reportAttachmentIds } from "#/lib/task/report-spec";
import { isWorkingDay, workdayKnown } from "#/lib/workday";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	type ActionRow,
	assertTaskReadable,
	getTaskReportTemplate,
	getTaskRow,
	ID,
	isLocked,
	memberRolesOf,
	nameMapOf,
	pageInput,
	type TaskRow,
	type WorkflowPayload,
	whoAllows,
	workflowOf,
} from "./common";

type MemberRow = typeof taskMemberTable.$inferSelect;

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
	reminderConfig: readTaskReminderConfig(row.reminder_config),
	updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
});

const toMember = (row: MemberRow, nameOf: Map<string, string>) => ({
	userId: row.user_id,
	name: nameOf.get(row.user_id) ?? null,
	role: row.role,
});

const toAction = (row: ActionRow, nameOf: Map<string, string>) => ({
	id: row.id,
	rootActionId: row.root_action_id,
	isLocking: row.is_locking,
	fromStatus: row.from_status,
	toStatus: row.to_status,
	creatorId: row.creator_id,
	creatorName: nameOf.get(row.creator_id) ?? null,
	assigneeId: row.assignee_id,
	assigneeName: nameOf.get(row.assignee_id) ?? null,
	status: row.status,
	lastUrgedAt: row.last_urged_at?.toISOString() ?? null,
});

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
	const isParticipant = isAdmin || isCreator || memberRoles.length > 0;

	const transitions: string[] = [];
	/** 我能发起的「改状态」action 的目标状态(前端「发起审批」弹窗的候选项)—— 模板里枚举好的 `via=action` 边 */
	const actionTargets: string[] = [];
	const locked = await isLocked(task.id);
	for (const edge of workflowOf(task).edges ?? []) {
		if (locked) break;
		if (edge.from !== task.status) continue;
		// 管理员不受 `who` 限制:当前状态能走的边他都能走
		if (!isAdmin && !(await whoAllows(task, meId, edge.who ?? [], memberRoles))) continue;
		if (edge.via === "direct") transitions.push(edge.to);
		else actionTargets.push(edge.to);
	}

	return {
		/** 是否「系统管理员」—— 前端按钮矩阵的最高一档 */
		isAdmin,
		/** 任务当前是否被未完成的审批动作锁住 —— 锁定期谁都改不了状态(前端据此把按钮禁掉) */
		locked,
		/** 我能**直接**改到的状态 */
		transitions,
		/** 我能发起「改状态」action 的目标状态(可空;多个时前端让用户选) */
		actionTargets,
		/** 我能发起「不改状态」的 action(征询)—— creator / participant / executor / admin */
		canInitiateConsult:
			isParticipant && !workflowOf(task).statuses.some((status) => status.value === task.status && status.terminal),
		/** 加成员:创建者 / 管理员 / 当前成员 —— 与 `memberAdd` 的 `assertTaskParticipant` 同一判据 */
		canAddMember: isParticipant,
		/** 创建者或管理员可以管理任务和成员。 */
		canManage: isAdmin || isCreator,
		/** 删除任务是破坏性动作,**单独一个开关**(判据:创建者或管理员)—— 与 `assertCanRemoveTask` 同一口径 */
		canRemove: isAdmin || isCreator,
		canTransfer: isAdmin || memberRoles.includes("executor"),
	};
}
export const taskQueryRouter = createTRPCRouter({
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
	/**
	 * 截止提醒预览:给定执行人提醒规则 + 截止时间,**算出前 5 次提醒时刻**(与排期走同一份展开代码)。
	 *
	 * 放在服务端是为了**不让 2011–2026 的节假日数据进客户端包**;纯算,不读库、不看任何人的数据。
	 * `known = false` 表示算到的日期已超出节假日数据集(那边只按周末判断,前端要如实提示)。
	 */
	reminderPreview: protectedProcedure
		.input(
			z.object({
				executor: executorReminderRuleSchema,
				/** ISO 字符串;解析不出来就拒(与 `taskCreate` 的口径一致) */
				dueAt: z.string().min(1).max(64),
			}),
		)
		.query(({ input }) => {
			const dueAt = new Date(input.dueAt);
			if (Number.isNaN(dueAt.getTime()))
				throw new TRPCError({ code: "BAD_REQUEST", message: "截止时间写成了一段没法解析的日期" });
			const events = executorReminderEvents(input.executor, dueAt, new Date(), { isWorkday: isWorkingDay });
			const last = events.at(-1);
			return {
				/** 前 5 次(升序,ISO) */
				times: events.slice(0, 5).map((event) => event.at.toISOString()),
				/** 窗口内一共几次 */
				total: events.length,
				/** 最后一次的时刻(只给前 5 次容易让人误判总量) */
				last: last ? last.at.toISOString() : null,
				/** 算到的日期是否都在节假日数据集内 */
				known: events.length === 0 || (workdayKnown(events[0].at) && workdayKnown(events[events.length - 1].at)),
			};
		}),

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
			own: { links: ownLinks, attachments: ownAttachments, attachmentIds: attachmentIdsOf(task.payload) },
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
			if (!owned) {
				const snapshot = task.report as { schema?: unknown } | null;
				if (snapshot && typeof snapshot === "object" && "reportId" in snapshot) {
					const { schema } = await getTaskReportTemplate(task);
					const [report] = await db
						.select({ draft: taskReportTable.draft })
						.from(taskReportTable)
						.where(eq(taskReportTable.task_id, task.id))
						.limit(1);
					owned = reportAttachmentIds(schema, report?.draft).includes(input.fileId);
					// 父任务还要能预览**子任务已保存**的填报附件(与 reportGet 的可见集合同口径:
					// 只看 current_submission_id 指向的那份快照,没保存的一律不放行)
					if (!owned) {
						const submissions = await db
							.select({ payload: taskReportSubmissionTable.payload })
							.from(taskReportTable)
							.innerJoin(
								taskReportSubmissionTable,
								eq(taskReportSubmissionTable.id, taskReportTable.current_submission_id),
							)
							.innerJoin(taskTable, eq(taskTable.id, taskReportTable.task_id))
							.where(and(eq(taskTable.parent_id, task.id), alive(taskTable)));
						owned = submissions.some((row) => reportAttachmentIds(schema, row.payload).includes(input.fileId));
					}
				}
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
});
