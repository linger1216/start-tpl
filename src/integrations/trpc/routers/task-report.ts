import { TRPCError } from "@trpc/server";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { taskReportTable, taskReportTemplateTable, taskTable } from "#/db/data-base-schema";
import { isAdminUser } from "#/lib/casbin";
import { newId } from "#/lib/ids";
import { alive, softDeleted } from "#/lib/soft-delete";
import { createReportWorkbook, previewReportWorkbook } from "#/lib/task-report-excel";
import { taskReportSchema, validateTaskReport } from "#/lib/task-report-spec";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../init";
import {
	assertTaskParticipant,
	getAvailableReportTemplate,
	getTaskRow,
	hashReportRows,
	ID,
	lockTask,
	logTaskEvent,
	memberRolesOf,
	type ScopeFilter,
	stableJson,
	type Tx,
} from "./task-shared";

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

/** 任务始终使用绑定时的结构快照。 */
function getTaskReportTemplate(task: { report: unknown }) {
	const report = task.report as { reportId?: string; schema?: unknown } | null;
	const reportId = report?.reportId;
	if (!reportId) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报模板引用" });
	const schema = taskReportSchema.parse(report?.schema);
	return { id: reportId, schema };
}

/** 创建人或当前执行人可以填写、导入及同步。 */
async function canEditReport(
	task: { id: string; creator_id: string },
	userId: string,
	reader: Pick<typeof db, "select"> = db,
) {
	return task.creator_id === userId || (await memberRolesOf(task.id, userId, reader)).includes("executor");
}

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

/** 统一锁顺序及同步授权；先锁子任务和子填报，再锁父填报。 */
async function lockReportPair(tx: Tx, taskId: string, userId: string, action: "同步" | "重新载入", revision?: number) {
	const task = await lockTask(tx, taskId);
	const parentTaskId = task.parent_id;
	if (!parentTaskId) throw new TRPCError({ code: "BAD_REQUEST", message: `只有子任务可以${action}` });
	if (!(await canEditReport(task, userId, tx)))
		throw new TRPCError({ code: "FORBIDDEN", message: `只有任务创建人或当前执行人可以${action}` });
	if (getTaskReportTemplate(task).schema.kind !== "TABLE")
		throw new TRPCError({ code: "BAD_REQUEST", message: `只有表格填报可以${action}` });
	const [own] = await tx
		.select()
		.from(taskReportTable)
		.where(eq(taskReportTable.task_id, task.id))
		.limit(1)
		.for("update");
	if (!own || !Array.isArray(own.draft)) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有表格填报" });
	if (revision !== undefined && own.revision !== revision)
		throw new TRPCError({ code: "CONFLICT", message: "填报已被修改，请刷新后重试" });
	const [parent] = await tx
		.select()
		.from(taskReportTable)
		.where(eq(taskReportTable.task_id, parentTaskId))
		.limit(1)
		.for("update");
	if (!parent || !Array.isArray(parent.draft))
		throw new TRPCError({ code: "NOT_FOUND", message: "父任务没有表格填报" });
	return { task, parentTaskId, own, parent, ownRows: own.draft, parentRows: parent.draft };
}

export const taskReportRouter = createTRPCRouter({
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
			const template = getTaskReportTemplate(task);
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
				if (!(await canEditReport(task, me.id)))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以导入" });
				const [report] = await db.select().from(taskReportTable).where(eq(taskReportTable.task_id, task.id)).limit(1);
				if (!report) throw new TRPCError({ code: "BAD_REQUEST", message: "没有可编辑的填报" });
				const template = getTaskReportTemplate(task);
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
		const template = getTaskReportTemplate(task);
		return {
			/** 每个任务读**自己那份**草稿(子任务是下发时复制出来的),互不加锁 */
			report: own,
			template,
			canEdit: await canEditReport(task, me.id),
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
				if (!(await canEditReport(task, me.id, tx)))
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
				const template = getTaskReportTemplate(task);
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
			const {
				task,
				parentTaskId,
				ownRows: mine,
				parent,
				parentRows,
			} = await lockReportPair(tx, input.taskId, me.id, "同步");

			const filter = scopeFilterOf(task);
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
					parentTaskId,
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
				const { task, parentTaskId, own, parentRows } = await lockReportPair(
					tx,
					input.taskId,
					me.id,
					"重新载入",
					input.revision,
				);
				const draft = parentRows.filter((row) => rowInScope(row, scopeFilterOf(task)));
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
					detail: { parentTaskId },
				});
				return { draft, revision };
			});
		}),
});
