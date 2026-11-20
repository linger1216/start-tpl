import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { taskReportTable, taskReportTemplateTable, taskTable } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { alive, softDeleted } from "#/lib/soft-delete";
import { MAX_NAME_LENGTH } from "#/lib/task/close-spec";
import { isRecord, stableJson } from "#/lib/task/json";
import { payloadOf } from "#/lib/task/payload";
import { createReportWorkbook, mergeTaskExcelWorkbooks, previewReportWorkbook } from "#/lib/task/report-excel";
import {
	asFormValue,
	asTableValue,
	MAX_REPORT_BYTES,
	MAX_REPORT_ROWS,
	reportAttachmentIds,
	reportRowsOf,
	type TaskReportSchema,
	taskReportSchema,
	validateTaskReport,
} from "#/lib/task/report-spec";
import { createTRPCRouter, protectedProcedure, requireCurrentUser } from "../../init";
import {
	assertAttachments,
	assertTaskReadable,
	attachmentRows,
	executorNamesOf,
	getTaskReportTemplate,
	getTaskRow,
	hasChildTasks,
	ID,
	isAdminOf,
	lockTask,
	readTaskExcelFile,
	reportOf,
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
function excelConfigOf(schema: TaskReportSchema) {
	if (schema.kind !== "EXCEL" || !schema.excel)
		throw new TRPCError({ code: "BAD_REQUEST", message: "Excel 填报配置无效" });
	return schema.excel;
}

function assertEitherTaskOrReport(input: { taskId?: string; reportId?: string }) {
	if (!!input.taskId === !!input.reportId)
		throw new TRPCError({ code: "BAD_REQUEST", message: "必须且只能指定任务或填报模板" });
}

async function validateExcelTemplate(reader: Pick<typeof db, "select">, schema: TaskReportSchema) {
	if (schema.kind !== "EXCEL" || !schema.excel) return;
	const buffer = await readTaskExcelFile(reader, schema.excel.templateFileId);
	await mergeTaskExcelWorkbooks(buffer, [], schema.excel.sheetName, schema.excel.dataStartRow);
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

/** `tc_task.payload.report` 上的数据范围。子任务带 filter,父任务没有(没有就是全部行)。 */
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
	const children = await reader
		.select({ id: taskTable.id, name: taskTable.name, payload: taskTable.payload })
		.from(taskTable)
		.where(and(eq(taskTable.parent_id, taskId), alive(taskTable)))
		.orderBy(asc(taskTable.created_at), asc(taskTable.id));
	if (!children.length) return { hasChildren: false, children: [] };
	const ids = children.map((child) => child.id);
	const reports = await reader
		.select({ taskId: taskReportTable.task_id, synced: taskReportTable.synced })
		.from(taskReportTable)
		.where(inArray(taskReportTable.task_id, ids));
	const names = await executorNamesOf(ids);
	const reportMap = new Map(reports.map((row) => [row.taskId, row.synced]));
	return {
		hasChildren: true,
		children: children.map((child) => {
			const report = reportOf(child);
			const payload = reportMap.get(child.id) ?? null;
			return {
				taskId: child.id,
				name: child.name,
				executorName: names.get(child.id) ?? null,
				payload,
				submitted: payload !== null,
				filter: filterOf(report),
			};
		}),
	};
}

/**
 * 父任务最终视图按模板形状组合:
 * - 表格和表单均按来源合并,父级参与时追加本级记录;
 * - 表单:父级参与时追加父级表单,各子任务表单始终按独立记录合并;
 * - 子任务只有提交后才进入汇总。
 */
function composedRowsOf(
	schema: TaskReportSchema,
	ownDraft: unknown,
	children: readonly {
		taskId: string;
		name: string;
		executorName: string | null;
		payload: unknown;
		submitted: boolean;
		filter: ScopeFilter;
	}[],
	parentParticipates: boolean,
	hasChildren: boolean,
) {
	const parentRows = reportRowsOf(schema, ownDraft).map((row) => ({
		row,
		owner: null,
		ownerName: "本任务",
		status: "parent" as const,
	}));
	if (!hasChildren) return parentRows;
	const childRows = children.flatMap((child) => {
		const sources = isRecord(child.payload) && Array.isArray(child.payload.__sources) ? child.payload.__sources : [];
		return reportRowsOf(schema, child.payload).map((row, index) => {
			const source = isRecord(sources[index]) ? sources[index] : null;
			return {
				row,
				owner: typeof source?.owner === "string" ? source.owner : child.taskId,
				ownerName: typeof source?.ownerName === "string" ? source.ownerName : (child.executorName ?? child.name),
				status: child.submitted ? ("submitted" as const) : ("pending" as const),
			};
		});
	});
	const composed = parentParticipates ? [...parentRows, ...childRows] : childRows;
	if (composed.length > MAX_REPORT_ROWS || JSON.stringify(composed.map((entry) => entry.row)).length > MAX_REPORT_BYTES)
		throw new TRPCError({ code: "BAD_REQUEST", message: "层级汇总数据超过上限，请分批下发或减少填报记录" });
	return composed;
}

/** 旧任务没有此字段时按「父级不参与」处理,草稿仍保留,可由父级重新开启。 */
function effectiveValueOf(entries: ReturnType<typeof composedRowsOf>, taskId: string, ownerName: string) {
	return {
		__records: entries.map((entry) => entry.row),
		__sources: entries.map((entry) => ({
			owner: entry.owner ?? taskId,
			ownerName: entry.owner ? entry.ownerName : ownerName,
		})),
	};
}

function parentParticipationOf(report: unknown): boolean {
	return isRecord(report) && report.parentParticipates === true;
}

function excelFileIdsOf(value: unknown): string[] {
	if (!isRecord(value)) return [];
	if (Array.isArray(value.fileIds)) return value.fileIds.filter((id): id is string => typeof id === "string");
	return typeof value.fileId === "string" ? [value.fileId] : [];
}

function excelSnapshotOf(
	ownDraft: unknown,
	children: readonly { payload: unknown }[],
	parentParticipates: boolean,
	hasChildren: boolean,
) {
	const childIds = children.flatMap((child) => excelFileIdsOf(child.payload));
	const fileIds = hasChildren
		? [...(parentParticipates ? excelFileIdsOf(ownDraft) : []), ...childIds]
		: excelFileIdsOf(ownDraft);
	return { kind: "EXCEL_SNAPSHOT", fileIds: [...new Set(fileIds)] };
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
					if (template.schema.kind === "EXCEL") {
						const config = excelConfigOf(template.schema);
						return {
							fileBase64: (await readTaskExcelFile(db, config.templateFileId)).toString("base64"),
						};
					}
					return { fileBase64: createReportWorkbook(template.schema).toString("base64") };
				}
				const task = await getTaskRow(input.taskId ?? "");
				await assertTaskReadable(task, me.id, "无权导出填报");
				const own = await reportRowOf(db, task.id);
				if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报" });
				const template = await getTaskReportTemplate(task);
				if (input.templateOnly) {
					if (template.schema.kind === "EXCEL") {
						const config = excelConfigOf(template.schema);
						return {
							fileBase64: (await readTaskExcelFile(db, config.templateFileId)).toString("base64"),
						};
					}
					return { fileBase64: createReportWorkbook(template.schema).toString("base64") };
				}
				// 导出与父任务最终汇总同口径,只包含已提交的子任务
				const submitted = await submittedChildrenOf(db, task.id);
				if (template.schema.kind === "EXCEL") {
					const config = excelConfigOf(template.schema);
					const effective = excelSnapshotOf(
						own.draft,
						submitted.children,
						submitted.hasChildren && parentParticipationOf(reportOf(task)),
						submitted.hasChildren,
					);
					const templateBuffer = await readTaskExcelFile(db, config.templateFileId);
					const sources: Buffer[] = [];
					for (const fileId of effective.fileIds) sources.push(await readTaskExcelFile(db, fileId));
					return {
						fileBase64: (
							await mergeTaskExcelWorkbooks(templateBuffer, sources, config.sheetName, config.dataStartRow)
						).toString("base64"),
					};
				}
				const composed = composedRowsOf(
					template.schema,
					own.draft,
					submitted.children,
					submitted.hasChildren && parentParticipationOf(reportOf(task)),
					submitted.hasChildren,
				);
				const data = composed.map((entry) => entry.row);
				const owners = composed.map((entry) =>
					entry.owner ? (entry.ownerName ?? "执行人") : submitted.hasChildren ? entry.ownerName : null,
				);
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
			await validateExcelTemplate(db, input.payload);
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
				await validateExcelTemplate(tx, input.payload);
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
		await assertTaskReadable(task, me.id, "无权查看填报");
		const own = await reportRowOf(db, task.id);
		if (!own) return null;
		// 模板引用在任务的 report 规则里(单版本:模板 payload 即当前结构)
		const template = await getTaskReportTemplate(task);
		// 父级汇总只读取子任务已提交的版本。
		const submitted = await submittedChildrenOf(db, task.id);
		const childReports = submitted.children;
		const syncedChildren = childReports.filter((child) => child.submitted);
		// 附件文件名:自己那份 + 子任务当前汇总版本里引用的都要解出来
		const hasChildren = submitted.hasChildren;
		const parentParticipates = hasChildren && parentParticipationOf(reportOf(task));
		const composed = composedRowsOf(template.schema, own.draft, childReports, parentParticipates, hasChildren);
		const ownExcelFileId = isRecord(own.draft) && typeof own.draft.fileId === "string" ? own.draft.fileId : null;
		const excelSources =
			template.schema.kind === "EXCEL"
				? hasChildren
					? [
							...(parentParticipates && ownExcelFileId
								? [{ taskId: task.id, ownerName: "本任务", fileId: ownExcelFileId, submitted: true }]
								: []),
							...childReports.flatMap((child) =>
								excelFileIdsOf(child.payload).map((fileId) => ({
									taskId: child.taskId,
									ownerName: child.executorName ?? child.name,
									fileId,
									submitted: child.submitted,
								})),
							),
						]
					: ownExcelFileId
						? [{ taskId: task.id, ownerName: "本任务", fileId: ownExcelFileId, submitted: true }]
						: []
				: [];
		const files = await attachmentRows(db, [
			...familyAttachmentIdsOf(template.schema, own.draft, childReports),
			...(template.schema.kind === "EXCEL" ? [template.schema.excel?.templateFileId ?? ""] : []),
			...(template.schema.kind === "EXCEL" && ownExcelFileId ? [ownExcelFileId] : []),
			...excelSources.map((source) => source.fileId),
		]);
		/** 表格:父任务母版行(数组顺序即下标,下发「手动分配」按它选行) */
		const allocationRows = template.schema.kind === "TABLE" ? reportRowsOf(template.schema, own.draft) : [];
		return {
			report: own,
			template,
			files,
			/** 创建人或当前执行人可以编辑本任务自己的填报草稿。 */
			canEdit: canEditReport(task, me.id),
			/** 子任务(表格 / 表单都行)能把本任务的填报提交给父任务;父任务自己就是数据源 */
			canSubmitToParent: task.parent_id !== null,
			/** 子任务已提交的填报 */
			syncedChildren,
			/** 父级是否参与汇总;旧任务缺字段时为 false */
			parentParticipates,
			/** 按父级参与状态组成的最终结果行 */
			composed,
			hasChildren,
			allocationRows,
			excelSources,
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
				if (schema.kind === "EXCEL") {
					if (!isRecord(input.draft) || (input.draft.fileId !== null && typeof input.draft.fileId !== "string"))
						throw new TRPCError({ code: "BAD_REQUEST", message: "Excel 填报格式无效" });
					if (typeof input.draft.fileId === "string") {
						const config = excelConfigOf(schema);
						const [templateBytes, uploadBytes] = await Promise.all([
							readTaskExcelFile(tx, config.templateFileId),
							readTaskExcelFile(tx, input.draft.fileId),
						]);
						await mergeTaskExcelWorkbooks(templateBytes, [uploadBytes], config.sheetName, config.dataStartRow);
					}
				}
				await assertAttachments(tx, reportAttachmentIds(schema, rows));
				for (const row of rows)
					for (const field of schema.fields.filter((f) => f.readOnly)) {
						if (
							stableJson((row as Record<string, unknown>)[field.id] ?? null) !== stableJson(field.defaultValue ?? null)
						)
							throw new TRPCError({ code: "BAD_REQUEST", message: `只读字段不可修改:${field.label}` });
					}
				const now = new Date();
				const nextDraft =
					schema.kind === "TABLE"
						? asTableValue(rows)
						: schema.kind === "EXCEL"
							? { fileId: isRecord(input.draft) && typeof input.draft.fileId === "string" ? input.draft.fileId : null }
							: asFormValue(rows);
				await tx
					.update(taskReportTable)
					.set({ draft: nextDraft, revision: own.revision + 1, updated_at: now })
					.where(eq(taskReportTable.id, own.id));
				return { revision: own.revision + 1 };
			});
		}),

	reportSetParentParticipation: protectedProcedure
		.input(z.object({ taskId: ID, enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			return db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				if (!(await hasChildTasks(tx, task.id)))
					throw new TRPCError({ code: "BAD_REQUEST", message: "只有包含子任务的父任务可以设置参与状态" });
				if (!canEditReport(task, me.id))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以修改" });
				const stored = payloadOf(task.payload);
				if (!stored?.report) throw new TRPCError({ code: "BAD_REQUEST", message: "任务没有填报配置" });
				const now = new Date();
				await tx
					.update(taskTable)
					.set({
						payload: { ...stored, report: { ...stored.report, parentParticipates: input.enabled } },
						updated_at: now,
					})
					.where(eq(taskTable.id, task.id));
				return { parentParticipates: input.enabled };
			});
		}),

	reportClearParentDraft: protectedProcedure
		.input(z.object({ taskId: ID, revision: z.number().int().min(0) }))
		.mutation(async ({ ctx, input }) => {
			const me = requireCurrentUser(ctx);
			return db.transaction(async (tx) => {
				const task = await lockTask(tx, input.taskId);
				if (!(await hasChildTasks(tx, task.id)))
					throw new TRPCError({ code: "BAD_REQUEST", message: "只有包含子任务的父任务可以清空本级填报" });
				if (!canEditReport(task, me.id))
					throw new TRPCError({ code: "FORBIDDEN", message: "只有任务创建人或当前执行人可以清空" });
				const own = await reportRowOf(tx, task.id, true);
				if (!own) throw new TRPCError({ code: "NOT_FOUND", message: "任务没有填报" });
				if (own.revision !== input.revision)
					throw new TRPCError({ code: "CONFLICT", message: REPORT_CONFLICT_MESSAGE });
				const template = await getTaskReportTemplate(task, tx);
				const stored = payloadOf(task.payload);
				if (!stored?.report) throw new TRPCError({ code: "BAD_REQUEST", message: "任务没有填报配置" });
				const now = new Date();
				const emptyDraft =
					template.schema.kind === "TABLE" ? [] : template.schema.kind === "EXCEL" ? { fileId: null } : {};
				await tx
					.update(taskReportTable)
					.set({ draft: emptyDraft, revision: own.revision + 1, updated_at: now })
					.where(eq(taskReportTable.id, own.id));
				await tx
					.update(taskTable)
					.set({ payload: { ...stored, report: { ...stored.report, parentParticipates: false } }, updated_at: now })
					.where(eq(taskTable.id, task.id));
				return { revision: own.revision + 1, parentParticipates: false };
			});
		}),

	/**
	 * **提交给父任务** —— 保存本级及直属子任务已提交数据的汇总快照。
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
			const descendants = await submittedChildrenOf(tx, task.id);
			const participates = descendants.hasChildren && parentParticipationOf(reportOf(task));
			const composed = composedRowsOf(
				template.schema,
				own.draft,
				descendants.children,
				participates,
				descendants.hasChildren,
			);
			const executorNames = await executorNamesOf([task.id]);
			const effective =
				template.schema.kind === "EXCEL"
					? excelSnapshotOf(own.draft, descendants.children, participates, descendants.hasChildren)
					: descendants.hasChildren
						? effectiveValueOf(composed, task.id, executorNames.get(task.id) ?? task.name)
						: own.draft;
			if (template.schema.kind === "EXCEL") {
				const snapshot = effective as { kind: string; fileIds: string[] };
				if (snapshot.fileIds.length === 0)
					throw new TRPCError({ code: "BAD_REQUEST", message: "请先上传 Excel 填报文件" });
				const config = excelConfigOf(template.schema);
				const base = await readTaskExcelFile(tx, config.templateFileId);
				const sources: Buffer[] = [];
				for (const fileId of snapshot.fileIds) sources.push(await readTaskExcelFile(tx, fileId));
				await mergeTaskExcelWorkbooks(base, sources, config.sheetName, config.dataStartRow);
				pushed = snapshot.fileIds.length;
			} else if (template.schema.kind === "TABLE") {
				const rows = reportRowsOf(template.schema, effective);
				pushed = rows.length;
			} else {
				const found =
					template.schema.kind === "OBJECT"
						? reportRowsOf(template.schema, effective).flatMap((row) => validateTaskReport(template.schema, row))
						: validateTaskReport(template.schema, effective);
				if (found.length > 0)
					throw new TRPCError({ code: "BAD_REQUEST", message: found[0]?.message ?? "填报内容不完整" });
			}
			const now = new Date();
			await tx
				.update(taskReportTable)
				.set({ synced: effective, updated_at: now })
				.where(eq(taskReportTable.id, own.id));
			await writeTaskEvent(tx, {
				taskId: task.id,
				event: "report.submit",
				actor: me,
				detail: {
					parentTaskId: task.parent_id,
					pushed,
					summary:
						template.schema.kind === "TABLE"
							? `提交 ${pushed} 行给父任务`
							: template.schema.kind === "EXCEL"
								? `提交 ${pushed} 个工作簿给父任务`
								: "提交表单填报给父任务",
				},
			});
			return { pushed, syncedAt: now.toISOString() };
		});
	}),
});
