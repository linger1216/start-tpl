import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { taskReportTable, taskReportTemplateTable, taskTable } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { alive, softDeleted } from "#/lib/soft-delete";
import { MAX_NAME_LENGTH } from "#/lib/task/close-spec";
import { isRecord, stableJson } from "#/lib/task/json";
import { createReportWorkbook, previewReportWorkbook } from "#/lib/task/report-excel";
import {
	asFormValue,
	asTableValue,
	composeRows,
	MAX_REPORT_BYTES,
	MAX_REPORT_ROWS,
	reportAttachmentIds,
	reportRowsOf,
	rowMatchesFilter,
	type TaskReportSchema,
	taskReportSchema,
	validateTaskReport,
} from "#/lib/task/report-spec";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	assertAttachments,
	assertTaskParticipant,
	attachmentRows,
	executorNamesOf,
	getTaskReportTemplate,
	getTaskRow,
	hasChildTasks,
	ID,
	isAdminOf,
	lockTask,
	reportRowOf,
	resolveReportTemplate,
	type ScopeFilter,
	type Tx,
	visibleTemplateFilter,
	writeTaskEvent,
} from "./common";

/** Excel 编解码失败统一转换，已分类的业务错误原样保留。 */
async function withExcelError<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof TRPCError) throw error;
		throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "文件格式无效" });
	}
}

const REPORT_CONFLICT_MESSAGE = "填报已被修改，请刷新后重试";
function assertEitherTaskOrReport(input: { taskId?: string; reportId?: string }) {
	if (!!input.taskId === !!input.reportId)
		throw new TRPCError({ code: "BAD_REQUEST", message: "必须且只能指定任务或填报模板" });
}

/**
 * 模板管理的公共闸口:锁行 + 判「创建者或管理员」(`action` 进错误消息:发布 / 删除)。
 *
 * 管理员判据是 `isAdminUser`(与任务侧 `assertCanManage` 同一口径)—— 免得出现「前端显示能点、后端 403」。
 */
async function lockTemplateForManage(tx: Tx, id: string, me: { id: string; isSuper?: boolean }, action: string) {
	const admin = await isAdminOf(me);
	const [template] = await tx
		.select()
		.from(taskReportTemplateTable)
		.where(and(eq(taskReportTemplateTable.id, id), alive(taskReportTemplateTable)))
		.limit(1)
		.for("update");
	if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "模板不存在" });
	if (template.creator_id !== me.id && !admin)
		throw new TRPCError({ code: "FORBIDDEN", message: `只有模板创建人或管理员可以${action}` });
	return template;
}

/** 创建人或当前执行人可以填写、导入及同步(执行人是 `tc_task.executor_id`)。 */
function canEditReport(task: { creator_id: string; executor_id: string | null }, userId: string): boolean {
	return task.creator_id === userId || task.executor_id === userId;
}

/** `tc_task.report` 上的数据范围。子任务带 filter,父任务没有(没有就是全部行)。 */
function filterOf(report: unknown): ScopeFilter {
	const bag = report && typeof report === "object" ? (report as { filter?: unknown }) : null;
	return Array.isArray(bag?.filter) ? (bag.filter as ScopeFilter) : [];
}

/**
 * 子任务**已提交**的填报行(`synced` 非空)。父任务的一切(展示、导出)以它为准 ——
 * 没点「提交」的子任务不覆盖母版。`reportGet` 与 Excel 导出共用这一份口径。
 *
 * 顺带回答「这条任务有没有子任务」—— 父任务是**只读组合视图**时靠它挡下写入(见 `reportGet`)。
 */
async function submittedChildrenOf(reader: Pick<typeof db, "select">, taskId: string) {
	const childTasks = await reader
		.select({ id: taskTable.id, name: taskTable.name, executorId: taskTable.executor_id, report: taskTable.report })
		.from(taskTable)
		.where(and(eq(taskTable.parent_id, taskId), alive(taskTable)))
		.orderBy(asc(taskTable.created_at), asc(taskTable.id));
	if (childTasks.length === 0) return { hasChildren: false, children: [] };
	const childIds = childTasks.map((row) => row.id);
	const submissions = await reader
		.select({ taskId: taskReportTable.task_id, payload: taskReportTable.synced })
		.from(taskReportTable)
		.where(and(inArray(taskReportTable.task_id, childIds), isNotNull(taskReportTable.synced)));
	const executorNameOf = await executorNamesOf(childTasks.map((row) => row.id));
	const nameOf = new Map(childTasks.map((row) => [row.id, row.name]));
	const filterByTask = new Map(childTasks.map((row) => [row.id, filterOf(row.report)]));
	return {
		hasChildren: true,
		children: submissions.map((row) => ({
			taskId: row.taskId,
			name: nameOf.get(row.taskId) ?? row.taskId,
			executorName: executorNameOf.get(row.taskId) ?? null,
			payload: row.payload,
			filter: filterByTask.get(row.taskId) ?? [],
		})),
	};
}

/**
 * 父任务视图 = 母版行 + 各子任务已提交的行(读时组合,父任务行永不被改写)。
 *
 * 只有**表格**填报的子任务认领母版行(表单没有行可切,它的内容追加在母版之后);
 * 提交了空表 = 撤销提交 ⇒ 既不认领也不追加,母版原样保留。
 */
function composedRowsOf(
	schema: TaskReportSchema,
	ownDraft: unknown,
	children: readonly {
		taskId: string;
		name: string;
		executorName: string | null;
		payload: unknown;
		filter: ScopeFilter;
	}[],
) {
	const contributions = children.map((child) => {
		const rows = reportRowsOf(schema, child.payload);
		return {
			taskId: child.taskId,
			ownerName: child.executorName ?? child.name,
			filter: child.filter,
			rows,
			claims: schema.kind === "TABLE" && rows.length > 0,
		};
	});
	return composeRows(reportRowsOf(schema, ownDraft), contributions);
}

/**
 * 一条任务「自己 + 各子任务已提交」引用的全部附件 id —— 用于解出文件名与签名放行。
 * 导出与 `reportGet` 共用(之前两处逐字重复)。
 */
function familyAttachmentIdsOf(
	schema: TaskReportSchema,
	ownDraft: unknown,
	children: readonly { payload: unknown }[],
): string[] {
	return [
		...new Set([
			...reportAttachmentIds(schema, reportRowsOf(schema, ownDraft)),
			...children.flatMap((child) => reportAttachmentIds(schema, reportRowsOf(schema, child.payload))),
		]),
	];
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
			assertEitherTaskOrReport(input);
			return withExcelError(async () => {
				if (input.reportId) {
					const template = await resolveReportTemplate(db, { me, templateId: input.reportId });
					return { fileBase64: createReportWorkbook(template.schema).toString("base64") };
				}
				const task = await getTaskRow(input.taskId ?? "");
				await assertTaskParticipant(task, me.id, "无权导出填报");
				const own = await reportRowOf(db, task.id);
				if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报" });
				const template = await getTaskReportTemplate(task);
				if (input.templateOnly) {
					return { fileBase64: createReportWorkbook(template.schema).toString("base64") };
				}
				// 导出 = 组合视图(母版 + 各子任务已提交),一条表、首列「执行人」;不再另起子任务表
				const submitted = await submittedChildrenOf(db, task.id);
				const composed = composedRowsOf(template.schema, own.draft, submitted.children);
				const data = composed.map((entry) => entry.row);
				const owners = composed.map((entry) => (entry.owner ? (entry.ownerName ?? "执行人") : null));
				// 「填报(可读)」那张表要把附件写成**文件名**(给附件已删的也留着名字,人看得懂更重要)
				const attachmentIds = familyAttachmentIdsOf(template.schema, own.draft, submitted.children);
				const fileRows = await attachmentRows(db, attachmentIds, true);
				return {
					fileBase64: createReportWorkbook(template.schema, data, {
						readable: true,
						fileNames: Object.fromEntries(fileRows.map((row) => [row.id, row.name])),
						owners: owners.some(Boolean) ? owners : undefined,
					}).toString("base64"),
				};
			});
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
			assertEitherTaskOrReport(input);
			return withExcelError(async () => {
				if (input.reportId) {
					const template = await resolveReportTemplate(db, { me, templateId: input.reportId });
					return await previewReportWorkbook(template.schema, input.fileBase64);
				}
				const task = await getTaskRow(input.taskId ?? "");
				if (!canEditReport(task, me.id))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以导入" });
				// 父任务(有子任务)的填报由各执行人提交,不能整表导入
				if (await hasChildTasks(db, task.id))
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "父任务的填报由各执行人提交,不能整表导入",
					});
				const report = await reportRowOf(db, task.id);
				if (!report) throw new TRPCError({ code: "BAD_REQUEST", message: "没有可编辑的填报" });
				const template = await getTaskReportTemplate(task);
				return await previewReportWorkbook(template.schema, input.fileBase64);
			});
		}),

	/** 填报模板:创建即发布(单版本,编辑即覆盖 payload)。 */
	reportTemplateCreate: protectedProcedure
		.input(
			z.object({
				name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
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

	reportTemplateUpdate: protectedProcedure
		.input(
			z.object({
				id: ID,
				name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
				payload: taskReportSchema,
				shared: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			return db.transaction(async (tx) => {
				const template = await lockTemplateForManage(tx, input.id, me, "发布");
				await tx
					.update(taskReportTemplateTable)
					.set({
						name: input.name ?? template.name,
						payload: input.payload,
						shared: input.shared === undefined ? template.shared : input.shared ? 1 : 0,
						updated_at: new Date(),
					})
					.where(eq(taskReportTemplateTable.id, input.id));
				return { ok: true };
			});
		}),

	reportTemplateRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		await db.transaction(async (tx) => {
			await lockTemplateForManage(tx, input.id, me, "删除");
			// 软删:已绑定任务的历史填报仍读得到 payload,只是不能再用于新任务/绑定
			await tx.update(taskReportTemplateTable).set(softDeleted()).where(eq(taskReportTemplateTable.id, input.id));
		});
		return { ok: true };
	}),

	reportTemplateList: protectedProcedure.query(async ({ ctx }) => {
		const me = requireCurrentUser(ctx);
		const isAdmin = await isAdminOf(me);
		// 可见性:shared = 1 全员可见,0 仅创建人;管理员始终全量;软删的不出现
		const templates = await db
			.select()
			.from(taskReportTemplateTable)
			.where(visibleTemplateFilter(me, isAdmin))
			.orderBy(desc(taskReportTemplateTable.created_at));
		// 与 `workflowList` 同形:`updatedAt` 一律是 ISO 字符串,前端两个模板页共用一套卡片版式
		return templates.map((template) => ({
			id: template.id,
			name: template.name,
			payload: template.payload,
			shared: template.shared,
			creator_id: template.creator_id,
			canManage: isAdmin || template.creator_id === me.id,
			createdAt: template.created_at ? template.created_at.toISOString() : null,
			updatedAt: template.updated_at ? template.updated_at.toISOString() : null,
		}));
	}),

	reportGet: protectedProcedure.input(z.object({ taskId: ID })).query(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		const task = await getTaskRow(input.taskId);
		await assertTaskParticipant(task, me.id, "无权查看填报");
		const own = await reportRowOf(db, task.id);
		if (!own) return null;
		// 模板引用在任务的 report 规则里(单版本:模板 payload 即当前结构)
		const template = await getTaskReportTemplate(task);
		// 子任务的填报内容:只认**点过「提交」**的;没提交的什么都不显示,不做实时兜底
		const submitted = await submittedChildrenOf(db, task.id);
		const syncedChildren = submitted.children;
		// 附件文件名:自己那份 + 子任务提交的里引用的都要解出来
		const files = await attachmentRows(db, familyAttachmentIdsOf(template.schema, own.draft, syncedChildren));
		// 父任务(有子任务)→ 只读组合视图(每行带归属);没有子任务时前端走编辑器
		const hasChildren = submitted.hasChildren;
		const composed = composedRowsOf(template.schema, own.draft, syncedChildren);
		return {
			report: own,
			template,
			files,
			/**
			 * 能不能**改自己的行**:父任务有子任务时,填报由各执行人提交 —— 父任务只读组合视图,
			 * 母版也不再整片替换(否则会盖掉执行人提交的内容)。
			 */
			canEdit: canEditReport(task, me.id) && !hasChildren,
			/** 子任务(表格 / 表单都行)能把本任务的填报提交给父任务;父任务自己就是数据源 */
			canSubmitToParent: task.parent_id !== null,
			/** 子任务**提交过**的填报;没提交的不会出现在这里 */
			syncedChildren,
			/** 父任务的只读组合行(带归属);没有子任务时前端用编辑器 */
			composed,
			hasChildren,
		};
	}),

	reportSaveDraft: protectedProcedure
		.input(z.object({ taskId: ID, revision: z.number().int().min(0), draft: z.json() }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			if (JSON.stringify(input.draft).length > MAX_REPORT_BYTES)
				throw new TRPCError({ code: "BAD_REQUEST", message: "填报数据过大" });
			return db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				if (!canEditReport(task, me.id))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以填写" });
				// 父任务(有子任务)是「分派容器」:填报由各执行人提交,母版不再整片替换
				// (子任务拿的是下发时的副本,改母版传不到执行人手里,还会盖掉他们提交的内容)
				if (await hasChildTasks(tx, task.id))
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "父任务的填报由各执行人提交,不能整表保存",
					});
				// 每个任务只写**自己那一行**:子任务是下发时复制出来的独立副本,父子互不加锁
				const own = await reportRowOf(tx, task.id, true);
				if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报" });
				if (own.revision !== input.revision)
					throw new TRPCError({ code: "CONFLICT", message: REPORT_CONFLICT_MESSAGE });
				const template = await getTaskReportTemplate(task);
				const schema = template.schema;
				const rows = reportRowsOf(schema, input.draft);
				if (rows.length > MAX_REPORT_ROWS || rows.some((row) => !isRecord(row)))
					throw new TRPCError({ code: "BAD_REQUEST", message: "填报格式无效" });
				const issues = schema.kind === "TABLE" && rows.length === 0 ? [] : validateTaskReport(schema, input.draft);
				if (issues.length) throw new TRPCError({ code: "BAD_REQUEST", message: `填报数据无效: ${issues[0].message}` });
				await assertAttachments(tx, reportAttachmentIds(schema, rows));
				if (
					task.parent_id &&
					schema.kind === "TABLE" &&
					rows.some((row) => !rowMatchesFilter(row, filterOf(task.report)))
				)
					throw new TRPCError({ code: "BAD_REQUEST", message: "填报数据不能超出分派范围" });
				for (const row of rows)
					for (const field of schema.fields.filter((f) => f.readOnly)) {
						if (
							stableJson((row as Record<string, unknown>)[field.id] ?? null) !== stableJson(field.defaultValue ?? null)
						)
							throw new TRPCError({ code: "BAD_REQUEST", message: `只读字段不可修改:${field.label}` });
					}
				await tx
					.update(taskReportTable)
					.set({
						draft: schema.kind === "TABLE" ? asTableValue(rows) : asFormValue(rows),
						revision: own.revision + 1,
						updated_at: new Date(),
					})
					.where(eq(taskReportTable.id, own.id));
				return { revision: own.revision + 1 };
			});
		}),

	/**
	 * **提交给父任务** —— 把当前 `draft` 复制成 `synced`(父任务组合时读它)。不改 `revision`、不改父任务行。
	 * 表格与表单同一套:父任务的值在读取时按子任务 `synced` 组合(`composeRows`),范围重叠也不会互相覆盖。
	 */
	reportSubmitToParent: protectedProcedure.input(z.object({ taskId: ID })).mutation(async ({ ctx, input }) => {
		const me = requireCurrentUser(ctx);
		return db.transaction(async (tx) => {
			const task = await lockTask(tx, input.taskId);
			if (!task.parent_id) throw new TRPCError({ code: "BAD_REQUEST", message: "只有子任务可以提交" });
			if (!canEditReport(task, me.id))
				throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以提交" });
			const template = await getTaskReportTemplate(task, tx);
			const own = await reportRowOf(tx, task.id, true);
			if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报" });
			let pushed = 1;
			if (template.schema.kind === "TABLE") {
				const rows = reportRowsOf(template.schema, own.draft);
				if (rows.some((row) => !rowMatchesFilter(row, filterOf(task.report))))
					throw new TRPCError({ code: "BAD_REQUEST", message: "填报数据不能超出分派范围" });
				pushed = rows.length;
			} else {
				const found = validateTaskReport(template.schema, own.draft);
				if (found.length > 0)
					throw new TRPCError({ code: "BAD_REQUEST", message: found[0]?.message ?? "填报内容不完整" });
			}
			const now = new Date();
			await tx
				.update(taskReportTable)
				.set({ synced: own.draft, synced_at: now, updated_at: now })
				.where(eq(taskReportTable.id, own.id));
			await writeTaskEvent(tx, {
				taskId: task.id,
				event: "report.submit",
				actor: me,
				detail: {
					parentTaskId: task.parent_id,
					pushed,
					summary: template.schema.kind === "TABLE" ? `提交 ${pushed} 行给父任务` : "提交表单填报给父任务",
				},
			});
			return { pushed, syncedAt: now.toISOString() };
		});
	}),
});
