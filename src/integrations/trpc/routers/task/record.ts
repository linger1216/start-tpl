import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { taskMemberTable, taskReportTable, taskTable, taskWorkflowTable } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { alive, softDeleted } from "#/lib/soft-delete";
import { isTerminalStatusOf, MAX_TEXT_LENGTH, statusesOf } from "#/lib/task/close-spec";
import { isRecord, stableJson } from "#/lib/task/json";
import { MAX_ATTACHMENTS, normalizePayload, payloadOf, taskPayloadSchema, withContent } from "#/lib/task/payload";
import { readTaskReminderConfig, type TaskReminderConfig, taskReminderConfigSchema } from "#/lib/task/reminder-spec";
import {
	MAX_REPORT_ROWS,
	REPORT_ROW_ID,
	reportAttachmentIds,
	reportRowSchema,
	reportRowsOf,
	reportRowsWithIds,
	rowMatchesFilter,
	type taskReportSchema,
	validateTaskReport,
} from "#/lib/task/report-spec";
import { cancelTaskReminders, rescheduleTaskReminders } from "#/lib/task/scheduled-reminders";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	applyStatusMove,
	assertAttachments,
	assertCanManage,
	assertEdgeWho,
	assertTaskUnlocked,
	assertUsersExist,
	cancelLiveTaskActions,
	FILE_ID,
	findEdge,
	getTaskReportTemplate,
	getTaskRow,
	ID,
	isAdminOf,
	lockTask,
	resolveReportTemplate,
	type ScopeFilter,
	STATUS_VALUE,
	type TaskRow,
	type Tx,
	taskCoreFields,
	USER_ID,
	type WorkflowPayload,
	workflowOf,
	writeTaskEvent,
	writeTaskEvents,
} from "./common";

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

function mergeInheritedValues<T>(previous: readonly T[], next: readonly T[], child: readonly T[]): T[] {
	const previousSet = new Set(previous);
	return [...new Set([...next, ...child.filter((value) => !previousSet.has(value))])];
}

/** 从行里读提醒配置(容错:缺省 / 旧结构都走默认) */
const remindersOf = (row: { payload: unknown }) => readTaskReminderConfig(payloadOf(row.payload)?.reminders);

/** 把一行读成完整 payload —— 缺状态图快照就是数据没迁移,报清楚 */
function storedOf(row: { payload: unknown }) {
	const stored = payloadOf(row.payload);
	if (!stored) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "任务缺少状态图快照(数据未迁移)" });
	return stored;
}

function mergeInheritedPayload(previous: unknown, next: unknown, child: unknown) {
	const before = normalizePayload(previous as Parameters<typeof normalizePayload>[0]);
	const after = normalizePayload(next as Parameters<typeof normalizePayload>[0]);
	const current = normalizePayload(child as Parameters<typeof normalizePayload>[0]);
	return normalizePayload({
		links: mergeInheritedValues(
			before?.links?.map((item) => item.url) ?? [],
			after?.links?.map((item) => item.url) ?? [],
			current?.links?.map((item) => item.url) ?? [],
		).map((url) => ({ kind: "link" as const, url })),
		attachments: mergeInheritedValues(before?.attachments ?? [], after?.attachments ?? [], current?.attachments ?? []),
	});
}

/** 父任务编辑后更新子任务的共同字段；名称始终跟随父任务，其他字段与链接 / 附件保留子任务本地改动。 */
async function syncChildrenFromParent(
	tx: Tx,
	parent: TaskRow,
	next: Partial<TaskRow>,
	actor: { id: string; name: string },
	now: Date,
	options: { payloadChanged?: boolean } = {},
) {
	const target = { ...parent, ...next };
	const rows = await tx
		.select({ id: taskTable.id })
		.from(taskTable)
		.where(and(eq(taskTable.parent_id, parent.id), alive(taskTable)));
	let synced = 0;
	for (const row of rows) {
		const child = await lockTask(tx, row.id);
		const setValue: Partial<typeof taskTable.$inferInsert> = { updated_at: now };
		const changedFields: string[] = [];
		if (parent.name !== target.name && child.name !== target.name) {
			setValue.name = target.name;
			changedFields.push("name");
		}
		if (parent.description !== target.description && child.description === parent.description) {
			setValue.description = target.description;
			changedFields.push("description");
		}
		if (parent.due_at?.getTime() !== target.due_at?.getTime() && child.due_at?.getTime() === parent.due_at?.getTime()) {
			setValue.due_at = target.due_at;
			changedFields.push("dueAt");
		}
		if (parent.priority !== target.priority && child.priority === parent.priority) {
			setValue.priority = target.priority;
			changedFields.push("priority");
		}
		const beforeReminder = remindersOf(parent);
		const afterReminder = remindersOf(target);
		const childReminder = remindersOf(child);
		let nextStored = storedOf(child);
		let reminderChanged = false;
		if (
			stableJson(beforeReminder) !== stableJson(afterReminder) &&
			stableJson(childReminder) === stableJson(beforeReminder)
		) {
			nextStored = { ...nextStored, reminders: afterReminder };
			reminderChanged = true;
			changedFields.push("reminderConfig");
		}
		let payloadChanged = false;
		if (options.payloadChanged) {
			const merged = mergeInheritedPayload(parent.payload, target.payload, child.payload);
			const withNewContent = withContent(nextStored, merged);
			if (stableJson(withNewContent) !== stableJson(storedOf(child))) {
				nextStored = withNewContent;
				payloadChanged = true;
				changedFields.push("payload");
			}
		}
		if (reminderChanged || payloadChanged) setValue.payload = nextStored;
		if (changedFields.length === 0) continue;
		await tx.update(taskTable).set(setValue).where(eq(taskTable.id, child.id));
		if (
			setValue.due_at !== undefined ||
			(reminderChanged && stableJson(beforeReminder.executor) !== stableJson(afterReminder.executor))
		)
			await rescheduleTaskReminders(tx, { ...child, ...setValue }, now, "executor");
		if (reminderChanged && stableJson(beforeReminder.node) !== stableJson(afterReminder.node))
			await rescheduleTaskReminders(tx, { ...child, ...setValue }, now, "node");
		await writeTaskEvent(tx, {
			taskId: child.id,
			event: "task.update",
			actor,
			detail: { parentTaskId: parent.id, synchronizedFields: changedFields },
			at: now,
		});
		synced +=
			1 +
			(await syncChildrenFromParent(tx, child, setValue, actor, now, {
				payloadChanged: changedFields.includes("payload"),
			}));
	}
	return synced;
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
		workflowId?: string | null;
		reminderConfig?: TaskReminderConfig;
		workflow: WorkflowPayload;
		payload?: Parameters<typeof normalizePayload>[0];
		/** 唯一执行人(→ `tc_task.executor_id`);父任务传创建人,子任务传该执行人,单任务传选定执行人 */
		executorId?: string | null;
		/** 参与者 userId 列表(→ `tc_member`) */
		participants?: string[];
		/** 父子填报:父任务传模板快照与参与状态,子任务传 `{ reportId, filter }` */
		report?: {
			reportId: string;
			schema: z.infer<typeof taskReportSchema>;
			filter?: ScopeFilter;
			allocatedRowIds?: string[];
			parentParticipates?: boolean;
		} | null;
		/** 父任务 id(fan-out 时子任务指向父) */
		parentId?: string | null;
	},
	actor: { id: string; name: string },
) {
	const now = new Date();
	const content = await prepareTaskPayload(tx, input.payload);
	await tx.insert(taskTable).values({
		id: input.id,
		name: input.name.trim(),
		description: input.description?.trim() || null,
		status: input.workflow.initial,
		creator_id: actor.id,
		executor_id: input.executorId ?? null,
		due_at: input.dueAt ?? null,
		priority: input.priority ?? null,
		/** 一列装三样:状态图快照 + 提醒规则 + 内容区 */
		payload: {
			workflow: input.workflow,
			...(input.reminderConfig !== undefined ? { reminders: input.reminderConfig } : {}),
			...(content ?? {}),
		},
		parent_id: input.parentId ?? null,
		report: input.report ?? null,
		created_at: now,
		updated_at: now,
	});
	const participants = (input.participants ?? []).map((userId) => ({
		id: newId(),
		task_id: input.id,
		user_id: userId,
		created_at: now,
		updated_at: now,
	}));
	if (participants.length) await tx.insert(taskMemberTable).values(participants);
	const [created] = await tx.select().from(taskTable).where(eq(taskTable.id, input.id));
	await rescheduleTaskReminders(tx, created, now);
	await writeTaskEvent(tx, {
		taskId: input.id,
		event: "task.create",
		actor,
		toStatus: input.workflow.initial,
		detail: {
			workflowId: input.workflowId,
			members: [
				...(input.executorId ? [{ userId: input.executorId, role: "executor" as const }] : []),
				...participants.map((member) => ({ userId: member.user_id, role: "participant" as const })),
			],
		},
		at: now,
	});
}

/** 数据范围过滤条件的入参形状 —— 任务级 `report.filter` 与成员级 `members[].filter` 共用同一份 */
const dataScopeFilterSchema = z
	.array(
		z.object({
			field: z.string().min(1).max(64),
			value: z.union([z.string().max(MAX_TEXT_LENGTH), z.number().finite(), z.boolean(), z.null()]),
		}),
	)
	.min(1)
	.max(20);

/**
 * 建任务的入参 —— 提成具名 schema,两个建任务分支(`createSingleTask` / `createFanoutTask`)
 * 与 procedure 共用同一份类型;规则本身一个字节都没改。
 */
const taskCreateInput = z.strictObject({
	...taskCoreFields,
	workflowId: ID,
	reminderConfig: taskReminderConfigSchema,
	/** 绑定填报模板: `{ reportId, filter?, rows? }` —— rows 为建任务时直接带进来的初始行(文件导入) */
	report: z
		.object({
			reportId: ID,
			filter: dataScopeFilterSchema.optional(),
			rows: z.array(reportRowSchema).max(MAX_REPORT_ROWS).optional(),
		})
		.optional(),
	payload: taskPayloadSchema.nullish(),
	members: z
		.array(
			z.object({
				userId: USER_ID,
				/** 这一条是不是执行人(执行人落库进 `tc_task.executor_id`,其余进 `tc_member`) */
				role: z.enum(["participant", "executor"]),
				/** 该成员子任务的填报过滤规则(仅表格模板;多执行人 fan-out 时生效) */
				filter: dataScopeFilterSchema.optional(),
			}),
		)
		.max(50)
		.optional(),
});

type TaskCreateInput = z.infer<typeof taskCreateInput>;
type CreateTaskContext = {
	tx: Tx;
	input: TaskCreateInput;
	id: string;
	me: ReturnType<typeof requireCurrentUser>;
	snapshot: WorkflowPayload;
	requestedMembers: NonNullable<TaskCreateInput["members"]>;
	executors: NonNullable<TaskCreateInput["members"]>;
	template: Awaited<ReturnType<typeof resolveReportTemplate>> | null;
	masterRows: Array<Record<string, unknown>>;
};

function createDraftOf(template: CreateTaskContext["template"], masterRows: CreateTaskContext["masterRows"]) {
	/** 母版行按过滤规则切片(规则 = 一组 field=value 的 AND;空规则 = 全部行) */
	const rowsFor = (filter: Array<{ field: string; value: unknown }>) =>
		masterRows.filter((row) => rowMatchesFilter(row, filter));

	/** 填报草稿:表格取过滤后的行,表单取字段默认值 */
	const draftOf = (filter: Array<{ field: string; value: unknown }>): unknown => {
		if (!template) return null;
		if (template.schema.kind === "EXCEL") return { fileId: null };
		if (template.schema.kind === "TABLE") return rowsFor(filter);
		return Object.fromEntries(
			template.schema.fields
				.filter((field) => field.defaultValue !== undefined)
				.map((field) => [field.id, field.defaultValue]),
		);
	};
	return draftOf;
}

/**
 * 建任务各分支共用的那 8 个字段 —— 父任务 / 子任务 / 单任务看到的都一样,只有归属与范围不同。
 * 子任务创建时复制父任务的说明与链接 / 附件;后续父任务编辑通过 `syncChildrenFromParent` 同步共同字段。
 */
function taskBaseOf(input: TaskCreateInput, snapshot: WorkflowPayload) {
	return {
		name: input.name,
		description: input.description,
		dueAt: input.dueAt ? new Date(input.dueAt) : null,
		priority: input.priority,
		workflowId: input.workflowId,
		reminderConfig: input.reminderConfig,
		workflow: snapshot,
		payload: input.payload,
	};
}

async function createFanoutTask({
	tx,
	input,
	id,
	me,
	snapshot,
	requestedMembers,
	executors,
	template,
	masterRows,
}: CreateTaskContext) {
	const draftOf = createDraftOf(template, masterRows);
	// 父任务:承载母版(执行人就是创建人),成员里只留非执行人(如参与者)
	await insertTask(
		tx,
		{
			...taskBaseOf(input, snapshot),
			id,
			...(template ? { report: { reportId: template.id, schema: template.schema, parentParticipates: false } } : {}),
			// 父任务的执行人 = 创建人:母版数据由他维护,父任务的截止提醒也发给他
			// (子任务的执行人仍是各自那名;这里把"谁负责父任务那份"显式化)
			executorId: me.id,
			participants: requestedMembers.filter((member) => member.role !== "executor").map((member) => member.userId),
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
		const childRows =
			template?.schema.kind === "TABLE" ? masterRows.filter((row) => rowMatchesFilter(row, filter)) : [];
		await insertTask(
			tx,
			{
				...taskBaseOf(input, snapshot),
				id: childId,
				parentId: id,
				...(template
					? {
							report: {
								reportId: template.id,
								schema: template.schema,
								filter,
								...(template.schema.kind === "TABLE"
									? { allocatedRowIds: childRows.map((row) => String(row[REPORT_ROW_ID])) }
									: {}),
							},
						}
					: {}),
				executorId: member.userId,
			},
			me,
		);
		if (template) {
			// 下发即复制:子任务拿一份独立的行副本,之后各改各的,手动「保存」才回写父任务
			await tx.insert(taskReportTable).values({
				id: newId(),
				task_id: childId,
				draft: template.schema.kind === "TABLE" ? childRows : draftOf(filter),
				revision: 0,
			});
		}
		await writeTaskEvent(tx, {
			taskId: childId,
			event: "task.create",
			actor: me,
			detail: { parentId: id, filter, allocatedRows: childRows.length },
		});
	}
}

async function createSingleTask({
	tx,
	input,
	id,
	me,
	snapshot,
	requestedMembers,
	executors,
	template,
	masterRows,
}: CreateTaskContext) {
	const draftOf = createDraftOf(template, masterRows);
	await insertTask(
		tx,
		{
			...taskBaseOf(input, snapshot),
			id,
			...(template
				? {
						report: {
							reportId: template.id,
							schema: template.schema,
							filter: executors[0]?.filter ?? input.report?.filter,
						},
					}
				: {}),
			executorId: executors[0]?.userId ?? null,
			participants: requestedMembers.filter((member) => member.role !== "executor").map((member) => member.userId),
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
}

export const taskRecordRouter = createTRPCRouter({
	/** 当前执行人/管理员把任务继续下发给直属执行人；每人独立持有填报副本。 */
	taskDispatch: protectedProcedure
		.input(
			z.object({
				taskId: ID,
				targets: z
					.array(
						z.object({
							userId: USER_ID,
							mode: z.enum(["filter", "manual"]).default("filter"),
							filter: dataScopeFilterSchema.optional(),
							rowIds: z.array(z.string().min(1).max(255)).max(MAX_REPORT_ROWS).optional(),
						}),
					)
					.min(1)
					.max(1000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			return db.transaction(async (tx) => {
				const parent = await lockTask(tx, input.taskId);
				if (parent.executor_id !== me.id && !(await isAdminOf(me)))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有当前执行人或管理员可以下发" });
				if (isTerminalStatusOf(statusesOf(workflowOf(parent)), parent.status))
					throw new TRPCError({ code: "BAD_REQUEST", message: "已结束的任务不能继续下发" });
				const ids = input.targets.map((target) => target.userId);
				if (new Set(ids).size !== ids.length) throw new TRPCError({ code: "BAD_REQUEST", message: "下发对象不能重复" });
				await assertUsersExist(tx, ids, "下发对象不存在");
				const template = parent.report ? await getTaskReportTemplate(parent, tx) : null;
				const filters = input.targets.map((target) => target.filter ?? []);
				if (filters.some((filter) => filter.length) && (!template || template.schema.kind !== "TABLE"))
					throw new TRPCError({ code: "BAD_REQUEST", message: "数据范围只支持表格填报" });
				if (input.targets.some((target) => target.mode === "manual" && template?.schema.kind !== "TABLE"))
					throw new TRPCError({ code: "BAD_REQUEST", message: "手动分配只支持表格填报" });
				if (
					input.targets.some(
						(target) =>
							(target.mode === "manual" && (!target.rowIds?.length || target.filter?.length)) ||
							(target.mode === "filter" && target.rowIds?.length),
					)
				)
					throw new TRPCError({ code: "BAD_REQUEST", message: "筛选分配和手动分配不能同时设置" });
				for (const filter of filters) {
					const seen = new Set<string>();
					for (const condition of filter) {
						const field = template?.schema.fields.find((item) => item.id === condition.field);
						if (!field || field.type === "multiselect" || field.type === "attachment" || seen.has(condition.field))
							throw new TRPCError({ code: "BAD_REQUEST", message: "数据范围字段无效或重复" });
						seen.add(condition.field);
					}
				}
				const ownReport = template
					? await tx.select().from(taskReportTable).where(eq(taskReportTable.task_id, parent.id)).limit(1)
					: [];
				const own = ownReport[0];
				const sourceRows =
					template?.schema.kind === "TABLE"
						? reportRowsWithIds(reportRowsOf(template.schema, own?.draft), parent.id, own?.revision ?? 0)
						: [];
				if (template?.schema.kind === "TABLE") {
					const children = await tx
						.select({ report: taskTable.report })
						.from(taskTable)
						.where(and(eq(taskTable.parent_id, parent.id), alive(taskTable)));
					const unavailable = new Set<string>();
					for (const child of children) {
						if (!isRecord(child.report)) continue;
						const allocated = child.report.allocatedRowIds;
						if (Array.isArray(allocated)) {
							for (const id of allocated) if (typeof id === "string") unavailable.add(id);
							continue;
						}
						const filter = Array.isArray(child.report.filter) ? (child.report.filter as ScopeFilter) : [];
						for (const row of sourceRows)
							if (rowMatchesFilter(row, filter)) unavailable.add(String(row[REPORT_ROW_ID]));
					}
					const selected = new Set<string>();
					for (const [index, target] of input.targets.entries()) {
						const selectedIds =
							target.mode === "manual"
								? (target.rowIds ?? [])
								: sourceRows
										.filter((row) => rowMatchesFilter(row, filters[index] ?? []))
										.map((row) => String(row[REPORT_ROW_ID]));
						for (const rowId of selectedIds) {
							if (!sourceRows.some((row) => row[REPORT_ROW_ID] === rowId))
								throw new TRPCError({ code: "BAD_REQUEST", message: "选择的数据行已变化，请刷新后重试" });
							if (unavailable.has(rowId) || selected.has(rowId))
								throw new TRPCError({ code: "BAD_REQUEST", message: "一条填报记录不能重复分派" });
							selected.add(rowId);
						}
					}
				}
				const parentStored = storedOf(parent);
				const payload = normalizePayload(parentStored) ?? undefined;
				const workflow = parentStored.workflow;
				const reminderConfig = parentStored.reminders;
				const childIds: string[] = [];
				for (const [index, target] of input.targets.entries()) {
					const childId = newId();
					const filter = filters[index] ?? [];
					const targetRows =
						template?.schema.kind === "TABLE"
							? target.mode === "manual"
								? sourceRows.filter((row) => target.rowIds?.includes(String(row[REPORT_ROW_ID])))
								: sourceRows.filter((row) => rowMatchesFilter(row, filter))
							: [];
					const allocatedRowIds = targetRows.map((row) => String(row[REPORT_ROW_ID]));
					await insertTask(
						tx,
						{
							id: childId,
							name: parent.name,
							description: parent.description,
							dueAt: parent.due_at,
							priority: parent.priority,
							reminderConfig,
							workflow,
							payload,
							executorId: target.userId,
							parentId: parent.id,
							...(template
								? {
										report: {
											reportId: template.id,
											schema: template.schema,
											filter: target.mode === "filter" ? filter : [],
											...(template.schema.kind === "TABLE" ? { allocatedRowIds } : {}),
											parentParticipates: false,
										},
									}
								: {}),
						},
						me,
					);
					if (template) {
						const draft =
							template.schema.kind === "TABLE"
								? targetRows
								: template.schema.kind === "EXCEL"
									? { fileId: null }
									: Object.fromEntries(
											template.schema.fields
												.filter((field) => field.defaultValue !== undefined)
												.map((field) => [field.id, field.defaultValue]),
										);
						await tx.insert(taskReportTable).values({ id: newId(), task_id: childId, draft, revision: 0 });
					}
					await writeTaskEvent(tx, {
						taskId: childId,
						event: "task.create",
						actor: me,
						detail: { parentId: parent.id, filter, allocationMode: target.mode, allocatedRows: targetRows.length },
					});
					childIds.push(childId);
				}
				return { taskIds: childIds };
			});
		}),
	/**
	 * 建任务。
	 *
	 * `workflow` 列存的是 `tc_workflow.payload` 的**整份快照** —— 之后改模板不影响已建任务。
	 * 初始状态取快照的 `initial`。成员一并写 `tc_member`(creator 不进那张表,它在 `tc_task.creator_id`)。
	 */
	taskCreate: protectedProcedure.input(taskCreateInput).mutation(async ({ ctx, input }) => {
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
			await assertUsersExist(
				tx,
				requestedMembers.map((member) => member.userId),
				"任务成员不存在",
			);
			// 新绑定与模板删除串行(forUpdate)
			const template = input.report
				? await resolveReportTemplate(tx, { templateId: input.report.reportId, me, forUpdate: true })
				: null;
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
					if (!field || field.type === "multiselect" || field.type === "attachment" || fields.has(condition.field))
						throw new TRPCError({ code: "BAD_REQUEST", message: "数据范围字段无效或重复" });
					fields.add(condition.field);
				}
			}
			// 多执行人 = fan-out:**1 父 + N 子**(父执行人 = 创建人;每个执行人各拿一条子任务)
			const fanout = executors.length >= 2;
			// 多执行人各拿一条子任务;同一底表行只允许下发给一个执行人,避免子任务汇总重复

			// 母版数据:建任务时文件导入带进来的初始行(仅表格模板)
			const masterRows: Array<Record<string, unknown>> = (() => {
				if (!template || !input.report?.rows?.length) return [];
				if (template.schema.kind !== "TABLE")
					throw new TRPCError({ code: "BAD_REQUEST", message: "数据规则只支持表格形式模板" });
				const issues = validateTaskReport(template.schema, input.report.rows);
				if (issues.length) throw new TRPCError({ code: "BAD_REQUEST", message: `填报数据无效: ${issues[0].message}` });
				return reportRowsWithIds(input.report.rows, id, 0);
			})();
			if (fanout && template?.schema.kind === "TABLE") {
				const childFilters = executors.map((member) => member.filter ?? input.report?.filter ?? []);
				for (const row of masterRows) {
					const matches = childFilters.filter((filter) => rowMatchesFilter(row, filter)).length;
					if (matches > 1) throw new TRPCError({ code: "BAD_REQUEST", message: "一条填报记录不能分派给多个子任务" });
				}
			}
			if (template) await assertAttachments(tx, reportAttachmentIds(template.schema, masterRows));

			const createContext = { tx, input, id, me, snapshot, requestedMembers, executors, template, masterRows };
			if (fanout) {
				await createFanoutTask(createContext);
				return;
			}
			await createSingleTask(createContext);
		});
		return { id };
	}),

	/** 编辑任务 —— 描述性字段会沿任务树同步;`status` / `workflow` 不在这里改(那要走 `taskTransit` / `actionCreate`) */
	taskUpdate: protectedProcedure
		.input(
			z.object({
				id: ID,
				...taskCoreFields,
				/** `undefined` = 不传(整块 payload 保旧值);`null` = 显式清空;对象 = 整块替换 */
				payload: taskPayloadSchema.nullish(),
				/** 旧客户端可不传；新客户端提交编辑前读取到的内容，用于检测并发修改。 */
				expectedPayload: taskPayloadSchema.nullish(),
				reminderConfig: taskReminderConfigSchema.optional(),
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
			const syncedChildren = await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.id);
				if (
					payloadTouched &&
					input.expectedPayload !== undefined &&
					stableJson(normalizePayload(input.expectedPayload) ?? null) !==
						stableJson(normalizePayload(storedOf(task)) ?? null)
				)
					throw new TRPCError({ code: "CONFLICT", message: "任务内容已被修改，请刷新后重试" });
				const nextDescription = input.description === undefined ? task.description : input.description?.trim() || null;
				const nextDueAt = input.dueAt === undefined ? task.due_at : input.dueAt ? new Date(input.dueAt) : null;
				/** 优先级 `undefined` = 不动;`null` = 显式清空;数字 = 改值 */
				const nextPriority = input.priority;
				const currentStored = storedOf(task);
				const nextContent = payloadTouched ? await prepareTaskPayload(tx, input.payload) : undefined;
				const nextReminders = input.reminderConfig !== undefined ? input.reminderConfig : currentStored.reminders;
				const nextPayload = {
					workflow: currentStored.workflow,
					...(nextReminders !== undefined ? { reminders: nextReminders } : {}),
					...((nextContent !== undefined ? nextContent : normalizePayload(currentStored)) ?? {}),
				};
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
				const payloadChanged =
					stableJson((nextContent !== undefined ? nextContent : normalizePayload(currentStored)) ?? null) !==
					stableJson(normalizePayload(currentStored) ?? null);

				const setValue: Partial<typeof taskTable.$inferInsert> = {
					name: nextName,
					description: nextDescription,
					due_at: nextDueAt,
					payload: nextPayload,
					updated_at: now,
				};
				if (nextPriority !== undefined) setValue.priority = nextPriority;
				await tx.update(taskTable).set(setValue).where(eq(taskTable.id, task.id));
				// 读旧值要容错:老结构(offsets 数组)按「关」处理,别让一次编辑把接口整成 500
				const previousConfig = readTaskReminderConfig(currentStored.reminders);
				const config = input.reminderConfig ?? previousConfig;
				if (nextDueText !== prevDueAt || stableJson(config.executor) !== stableJson(previousConfig.executor))
					await rescheduleTaskReminders(tx, { ...task, ...setValue }, now, "executor");
				if (
					(input.reminderConfig !== undefined && currentStored.reminders === undefined) ||
					stableJson(config.node) !== stableJson(previousConfig.node)
				)
					await rescheduleTaskReminders(tx, { ...task, ...setValue }, now, "node");
				// 记录父任务本次修改;下方会在同一事务内同步共同字段到子任务。
				await writeTaskEvent(tx, {
					taskId: task.id,
					event: "task.update",
					actor: me,
					detail: { fields, payloadChanged },
					at: now,
				});
				return syncChildrenFromParent(tx, task, setValue, me, now, { payloadChanged });
			});
			return { ok: true, syncedChildren };
		}),

	/**
	 * **维护任务附件**(仅创建者或系统管理员)。
	 *
	 * 只动 `payload.attachments`,`links` / `type` / 名称 / 描述原样保留 —— 服务端从库里取旧值再合并,
	 * 前端传什么都不会覆盖别的字段。内容区按整棵树展示(见 `familyTasks`),所以子任务加的附件
	 * 父任务那边同样看得到。
	 */
	taskAttach: protectedProcedure
		.input(
			z.object({
				id: ID,
				attachments: z.array(FILE_ID).max(MAX_ATTACHMENTS),
				expectedAttachments: z.array(FILE_ID).max(MAX_ATTACHMENTS),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			const syncedChildren = await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.id);
				await assertCanManage(task, me.id, "只有任务创建者或管理员可以修改任务附件");
				const stored = storedOf(task);
				const current = normalizePayload(stored);
				if (stableJson(current?.attachments ?? []) !== stableJson(input.expectedAttachments))
					throw new TRPCError({ code: "CONFLICT", message: "附件已被修改，请刷新后重试" });
				const nextContent = await prepareTaskPayload(tx, {
					...current,
					attachments: input.attachments,
				});
				const nextPayload = withContent(stored, nextContent);
				const changed = stableJson(normalizePayload(nextPayload) ?? null) !== stableJson(current ?? null);
				const now = new Date();
				await tx.update(taskTable).set({ payload: nextPayload, updated_at: now }).where(eq(taskTable.id, task.id));
				if (changed)
					await writeTaskEvent(tx, {
						taskId: task.id,
						event: "task.update",
						actor: me,
						detail: { payloadChanged: true, attachments: input.attachments.length },
					});
				return changed
					? syncChildrenFromParent(tx, task, { payload: nextPayload }, me, now, { payloadChanged: true })
					: 0;
			});
			return { ok: true, syncedChildren };
		}),

	/**
	 * 删除任务节点，并在同一事务软删整棵后代树、终止动作和待发送通知。
	 * 当前任务创建者 / 管理员可删；直属父任务创建者或执行人也可删除这个下级节点。
	 */
	taskRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.id);
		const now = new Date();
		const deletedCount = await db.transaction(async (tx) => {
			// 固定从父级到当前节点的锁顺序，与删除整棵父树保持一致。
			const parent = task.parent_id ? await lockTask(tx, task.parent_id) : null;
			const locked = await lockTask(tx, task.id);
			const admin = await isAdminOf(me);
			const canRemove =
				admin ||
				locked.creator_id === me.id ||
				(parent !== null && (parent.creator_id === me.id || parent.executor_id === me.id));
			if (!canRemove)
				throw new TRPCError({
					code: "FORBIDDEN",
					message: parent
						? "只有任务创建者、直属父任务创建者/执行人或管理员可以删除"
						: "只有任务创建者或管理员可以删除任务",
				});

			const subtree = [locked];
			let frontier = [locked.id];
			while (frontier.length) {
				const descendants = await tx
					.select()
					.from(taskTable)
					.where(and(inArray(taskTable.parent_id, frontier), alive(taskTable)))
					.orderBy(asc(taskTable.id))
					.for("update");
				if (!descendants.length) break;
				subtree.push(...descendants);
				frontier = descendants.map((row) => row.id);
			}
			for (const row of subtree) {
				await cancelLiveTaskActions(tx, row.id, now);
				await cancelTaskReminders(tx, row.id, now);
			}
			const ids = subtree.map((row) => row.id);
			await tx
				.update(taskTable)
				.set({ ...softDeleted(), updated_at: now })
				.where(inArray(taskTable.id, ids));
			await writeTaskEvents(
				tx,
				subtree.map((row) => ({ taskId: row.id, event: "task.remove" as const, actor: me, at: now })),
			);
			return subtree.length;
		});
		return { ok: true, deletedCount };
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
	taskTransit: protectedProcedure.input(z.object({ id: ID, to: STATUS_VALUE })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const isAdmin = await isAdminOf(me);
		await db.transaction(async (tx) => {
			const task = await lockTask(tx, input.id);
			if (task.status === input.to) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "任务已经是这个状态" });
			}
			await assertTaskUnlocked(task.id, tx);
			const workflow = workflowOf(task);
			if (!workflow.statuses?.some((status) => status.value === input.to)) {
				throw new TRPCError({ code: "BAD_REQUEST", message: `状态图里没有状态:${input.to}` });
			}
			const edge = findEdge(workflow, { from: task.status, to: input.to, via: "direct" });
			if (!edge) throw new TRPCError({ code: "BAD_REQUEST", message: `没有 ${task.status} → ${input.to} 的直接转移` });
			await assertEdgeWho(task, me.id, edge, isAdmin, tx, "你没有权限做这次状态转移");
			const now = new Date();
			await applyStatusMove(tx, task, input.to, now);
			// 「直接改状态」以前**不留痕**(只有 action 才有记录),这里是它第一次被记进历史
			await writeTaskEvent(tx, {
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
});
