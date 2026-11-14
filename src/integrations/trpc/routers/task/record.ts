import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { sysUser, taskMemberTable, taskReportTable, taskTable, taskWorkflowTable } from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { alive, softDeleted } from "#/lib/soft-delete";
import { normalizePayload, taskPayloadSchema } from "#/lib/task/payload";
import { type TaskReminderConfig, taskReminderConfigSchema } from "#/lib/task/reminder-spec";
import {
	reportAttachmentIds,
	reportRowSchema,
	type taskReportSchema,
	validateTaskReport,
} from "#/lib/task/report-spec";
import { cancelTaskReminders, rescheduleTaskReminders } from "#/lib/task/scheduled-reminders";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	assertAttachments,
	assertCanManage,
	assertCanRemoveTask,
	assertTaskParticipant,
	cancelLiveTaskActions,
	getAvailableReportTemplate,
	getTaskRow,
	hashReportRows,
	ID,
	isLocked,
	lockTask,
	ROLE_ENUM,
	type ScopeFilter,
	stableJson,
	type Tx,
	type WorkflowPayload,
	whoAllows,
	workflowOf,
	writeTaskEvent,
} from "./common";

/** 两组 AND 条件只有在同一字段要求不同值时才互斥。 */
function scopesOverlap(a: ScopeFilter, b: ScopeFilter): boolean {
	return !a.some((left) => b.some((right) => left.field === right.field && left.value !== right.value));
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
		reminderConfig: TaskReminderConfig;
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
		reminder_config: input.reminderConfig,
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
	const [created] = await tx.select().from(taskTable).where(eq(taskTable.id, input.id));
	await rescheduleTaskReminders(tx, created, now);
	await writeTaskEvent(tx, {
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

export const taskRecordRouter = createTRPCRouter({
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
				reminderConfig: taskReminderConfigSchema,
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
						if (!field || field.type === "multiselect" || field.type === "attachment" || fields.has(condition.field))
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
				if (template) await assertAttachments(tx, reportAttachmentIds(template.schema, masterRows));

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
							reminderConfig: input.reminderConfig,
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
								reminderConfig: input.reminderConfig,
								workflow: snapshot,
								payload: input.payload,
								...(template
									? {
											report: {
												reportId: template.id,
												schema: template.schema,
												filter,
												baseHash: hashReportRows(draftOf(filter)),
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
						await writeTaskEvent(tx, {
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
						reminderConfig: input.reminderConfig,
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
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.id);
				if (
					payloadTouched &&
					input.expectedPayload !== undefined &&
					stableJson(normalizePayload(input.expectedPayload) ?? null) !==
						stableJson(normalizePayload(task.payload as Parameters<typeof normalizePayload>[0]) ?? null)
				)
					throw new TRPCError({ code: "CONFLICT", message: "任务内容已被修改，请刷新后重试" });
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
				if (input.reminderConfig !== undefined) setValue.reminder_config = input.reminderConfig;
				await tx.update(taskTable).set(setValue).where(eq(taskTable.id, task.id));
				const previousConfig = taskReminderConfigSchema.parse(task.reminder_config ?? undefined);
				const config = input.reminderConfig ?? previousConfig;
				if (nextDueText !== prevDueAt || stableJson(config.executor) !== stableJson(previousConfig.executor))
					await rescheduleTaskReminders(tx, { ...task, ...setValue }, now, "executor");
				if (
					(input.reminderConfig !== undefined && !task.reminder_config) ||
					stableJson(config.node) !== stableJson(previousConfig.node)
				)
					await rescheduleTaskReminders(tx, { ...task, ...setValue }, now, "node");
				// 说明是「整件事」的描述:父任务改了,子任务跟着改(子任务是执行副本,不各写一份)
				if (!task.parent_id && nextDescription !== task.description) {
					await tx
						.update(taskTable)
						.set({ description: nextDescription, updated_at: now })
						.where(and(eq(taskTable.parent_id, task.id), alive(taskTable)));
				}
				await writeTaskEvent(tx, {
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
				expectedAttachments: z.array(z.string().min(1).max(32)).max(20),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			await db.transaction(async (tx) => {
				const task = await lockTask(tx, input.id);
				await assertTaskParticipant(task, me.id, "无权给这条任务加附件");
				const current = normalizePayload(task.payload as Parameters<typeof normalizePayload>[0]);
				if (stableJson(current?.attachments ?? []) !== stableJson(input.expectedAttachments))
					throw new TRPCError({ code: "CONFLICT", message: "附件已被修改，请刷新后重试" });
				const nextPayload = await prepareTaskPayload(tx, {
					...current,
					attachments: input.attachments,
				});
				const changed = stableJson(nextPayload ?? null) !== stableJson(task.payload ?? null);
				await tx
					.update(taskTable)
					.set({ payload: nextPayload, updated_at: new Date() })
					.where(eq(taskTable.id, task.id));
				if (changed)
					await writeTaskEvent(tx, {
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
	 * **只有任务创建者或管理员能删**(`assertCanRemoveTask`)—— 执行人 / 参与者一律拒绝。
	 */
	taskRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.id);
		await assertCanRemoveTask(task, me.id);
		const now = new Date();
		await db.transaction(async (tx) => {
			await lockTask(tx, task.id);
			const children = await tx
				.select({ id: taskTable.id })
				.from(taskTable)
				.where(and(eq(taskTable.parent_id, task.id), alive(taskTable)))
				.for("update");
			for (const row of children) {
				await cancelLiveTaskActions(tx, row.id, now);
				await cancelTaskReminders(tx, row.id, now);
			}
			await cancelLiveTaskActions(tx, task.id, now);
			await cancelTaskReminders(tx, task.id, now);
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
					await writeTaskEvent(tx, { taskId: row.id, event: "task.remove", actor: me, at: now });
			}
			await writeTaskEvent(tx, { taskId: task.id, event: "task.remove", actor: me, at: now });
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
				if (
					workflow.statuses.some(
						(status) => (status.value === task.status || status.value === input.to) && status.terminal,
					)
				)
					await rescheduleTaskReminders(tx, { ...task, status: input.to }, now);
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
