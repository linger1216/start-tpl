import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { CloudUpload, Paperclip, Plus, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { TaskAttachmentPreview } from "#/components/modules/task-close/task-attachment-preview";
import { TaskReportExcel } from "#/components/modules/task-close/task-report-excel";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { TableResizeHandle } from "#/components/ui/table-resize-handle";
import { useFileUpload } from "#/hooks/use-file-upload";
import { useStableKeys } from "#/hooks/use-stable-keys";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { toastApiError } from "#/lib/api/error";
import { updateKeyedItem } from "#/lib/task/report-keyed";
import { pasteReportGrid, type TaskReportSchema, validateTaskReport } from "#/lib/task/report-spec";
import { formatLocalDateTime, parseLocalDateTime, toLocalMinuteInput } from "#/lib/time";
import { cn } from "#/lib/utils";

/** tRPC 错误码 —— `CONFLICT` 才是「别人改了」,其余失败不该引导用户去丢弃自己的修改 */
function trpcCodeOf(error: unknown): string | null {
	const err = error as { data?: { code?: unknown }; shape?: { data?: { code?: unknown } } } | null;
	const code = err?.data?.code ?? err?.shape?.data?.code;
	return typeof code === "string" ? code : null;
}

/** 结构化填报的区块外壳 —— 标题 + 右侧动作(Excel 三个图标按钮),加载 / 空态也走它,口径一致 */
function ReportSection({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) {
	return (
		<section className="grid gap-3 pt-6">
			<header className="flex items-center justify-between border-b border-dashed border-border pb-2">
				<h2 className="shrink-0 whitespace-nowrap text-base font-semibold tracking-tight text-foreground">
					结构化填报
				</h2>
				{actions}
			</header>
			{children}
		</section>
	);
}

/** 填报与说明、自由回复独立，数据和授权都由服务端提供。 */
export function TaskReport({ taskId, canManage }: { taskId: string; canManage: boolean }) {
	const trpc = useTRPC();
	const client = useQueryClient();
	const report = useQuery(trpc.taskClose.reportGet.queryOptions({ taskId }));
	const templates = useQuery({
		...trpc.taskClose.reportTemplateList.queryOptions(),
		enabled: canManage && report.data === null,
	});
	const [templateId, setTemplateId] = useState("");
	const bind = useMutation(
		trpc.taskClose.reportBind.mutationOptions({
			onSuccess: () => {
				void client.invalidateQueries(trpc.taskClose.pathFilter());
				toast.success("已配置填报");
			},
			onError: toastApiError,
		}),
	);
	if (report.isPending)
		return (
			<ReportSection>
				<p className="text-sm text-muted-foreground">正在加载填报…</p>
			</ReportSection>
		);
	if (report.isError)
		return (
			<ReportSection>
				<p className="text-sm text-muted-foreground">无法加载填报。</p>
			</ReportSection>
		);
	if (!report.data) {
		if (!canManage)
			return (
				<ReportSection>
					<p className="text-sm text-muted-foreground">此任务没有配置填报。</p>
				</ReportSection>
			);
		const options = (templates.data ?? []).map((template) => ({ value: template.id, label: template.name }));
		return (
			<ReportSection>
				<div className="flex flex-wrap items-center gap-2">
					<Select items={options} value={templateId} onValueChange={(value) => setTemplateId(value ?? "")}>
						<SelectTrigger className="w-64" aria-label="填报模板">
							<SelectValue placeholder="选择填报模板" />
						</SelectTrigger>
						<SelectContent>
							{options.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						size="sm"
						disabled={!templateId || bind.isPending}
						onClick={() => bind.mutate({ taskId, reportId: templateId })}
					>
						配置填报
					</Button>
					{options.length === 0 && <span className="text-sm text-muted-foreground">暂无已发布的填报模板。</span>}
				</div>
			</ReportSection>
		);
	}
	return (
		<TaskReportEditor
			key={`${report.data.report.id}:${report.data.template.id}`}
			taskId={taskId}
			schema={report.data.template.schema}
			data={report.data}
		/>
	);
}

type Value = string | number | boolean | string[] | Array<Record<string, Value>> | null;
type Row = Record<string, Value>;
/** reportGet 带回来的附件行(按 id 查文件名) */
type ReportFile = ReportData["files"][number];
/** 顶层字段与数组元素字段的公共形状(元素层没有 allowEmpty) */
type ReportFieldLike = Omit<TaskReportSchema["fields"][number], "allowEmpty" | "required"> & {
	allowEmpty?: boolean;
	required?: boolean;
};
type ReportData = NonNullable<inferRouterOutputs<TRPCRouter>["taskClose"]["reportGet"]>;

function TaskReportEditor({ taskId, schema, data }: { taskId: string; schema: TaskReportSchema; data: ReportData }) {
	const trpc = useTRPC();
	const [draft, setDraft] = useState<Row | Row[]>(data.report.draft as Row | Row[]);
	const [rowKeys, setRowKeys] = useState<string[]>(() =>
		Array.isArray(data.report.draft) ? data.report.draft.map(() => crypto.randomUUID()) : [],
	);
	const rowKeysRef = useRef(rowKeys);
	const generationRef = useRef(0);
	const replaceRowKeys = (keys: string[]) => {
		rowKeysRef.current = keys;
		setRowKeys(keys);
	};
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const [revision, setRevision] = useState(data.report.revision);
	const [dirty, setDirty] = useState(false);
	const [conflicted, setConflicted] = useState(false);
	const [syncConflict, setSyncConflict] = useState(false);
	const [confirmReset, setConfirmReset] = useState(false);
	/** 待确认删除的数据行 —— 用 rowKey 而不是下标,避免确认期间数据变化误删别的行 */
	const [pendingDeleteRow, setPendingDeleteRow] = useState<{ key: string; index: number } | null>(null);
	const [saveFailed, setSaveFailed] = useState(false);
	const markDirty = () => {
		setDirty(true);
		setSaveFailed(false);
	};
	const [issues, setIssues] = useState<ReturnType<typeof validateTaskReport>>([]);
	/** 表格在**前端分页**:数据长时别让整页滚成一条线(行索引仍按整份数据算) */
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(10);
	/** 用户拖出来的列宽(键 = 字段标识);没拖过的列仍均分 */
	const [columnSizing, setColumnSizing] = useState<Record<string, number>>({});
	/** 自动落草稿；冲突时保留本地内容，不覆盖其他人的修改。 */
	const save = useMutation(
		trpc.taskClose.reportSaveDraft.mutationOptions({
			onSuccess: (result, variables) => {
				setRevision(result.revision);
				if (JSON.stringify(draftRef.current) === JSON.stringify(variables.draft)) setDirty(false);
			},
			onError: (error) => {
				if (trpcCodeOf(error) === "CONFLICT") {
					setConflicted(true);
					toast.error("填报已被他人修改，本地内容尚未保存，请复制后刷新页面。");
					return;
				}
				setSaveFailed(true);
				toastApiError(error);
			},
		}),
	);
	useEffect(() => {
		if (!dirty || conflicted || saveFailed || save.isPending || !data.canEdit) return;
		const timer = window.setTimeout(() => {
			// 本地先校验:不合法的草稿不发;空表是合法草稿(用户把行删光了)
			const found =
				schema.kind === "TABLE" && Array.isArray(draft) && draft.length === 0 ? [] : validateTaskReport(schema, draft);
			setIssues(found);
			if (found.length > 0) return;
			save.mutate({ taskId, revision, draft });
		}, 600);
		return () => window.clearTimeout(timer);
	}, [dirty, conflicted, saveFailed, save.isPending, data.canEdit, taskId, revision, draft, save.mutate, schema]);
	const rows =
		schema.kind === "TABLE" ? (Array.isArray(draft) ? draft : []) : [Array.isArray(draft) ? {} : (draft ?? {})];
	/** 表单模式:数组字段单独成块(换行缩进),其余字段进表格 */
	const arrayFields = schema.kind === "OBJECT" ? schema.fields.filter((field) => field.type === "array") : [];
	const plainFields = schema.kind === "OBJECT" ? schema.fields.filter((field) => field.type !== "array") : [];
	const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
	const currentPage = Math.min(page, totalPages);
	const pageStart = (currentPage - 1) * pageSize;
	const pageRows = rows.slice(pageStart, pageStart + pageSize);
	/** 这个格子有没有被校验点名 —— 有就把输入框标红,不用人对着下面的清单逐条找 */
	const invalidOf = (row: number, field: string) =>
		issues.some((issue) => issue.field === field && (schema.kind === "OBJECT" || issue.row === row));
	/**
	 * 改一格。用 `setDraft(prev => …)` 的**函数式**更新:`value` 可能是异步拿到的
	 * (附件上传要几秒),写回时必须基于**当时最新的草稿**,而不是发起时的快照 ——
	 * 否则上传期间别人(或用户自己)对同一行数组的新增 / 删除会被这次写回抹掉。
	 */
	const update = (index: number, field: string, value: Value, generation: number, rowKey?: string) => {
		if (generation !== generationRef.current || (rowKey && !rowKeysRef.current.includes(rowKey))) return;
		const keys = rowKeysRef.current;
		setDraft((prev) => {
			const current: Row[] =
				schema.kind === "TABLE" ? (Array.isArray(prev) ? (prev as Row[]) : []) : [(prev ?? {}) as Row];
			const next = rowKey
				? updateKeyedItem(current, keys, rowKey, (row) => ({ ...row, [field]: value }))
				: current.map((row, i) => (i === index ? { ...row, [field]: value } : row));
			return schema.kind === "TABLE" ? next : next[0];
		});
		markDirty();
		setIssues([]);
	};
	/** 手动「保存」= 把本子任务的行同步到父任务。 */
	const sync = useMutation(
		trpc.taskClose.reportSyncToParent.mutationOptions({
			onSuccess: (result) => {
				setRevision(result.revision);
				toast.success(`已同步 ${result.pushed} 行到父任务`);
			},
			onError: (error) => {
				if (trpcCodeOf(error) === "CONFLICT") setSyncConflict(true);
				toastApiError(error);
			},
		}),
	);
	const reset = useMutation(
		trpc.taskClose.reportResetFromParent.mutationOptions({
			onSuccess: (result) => {
				const next = result.draft as Row | Row[];
				generationRef.current += 1;
				setDraft(next);
				replaceRowKeys(Array.isArray(next) ? next.map(() => crypto.randomUUID()) : []);
				setRevision(result.revision);
				setDirty(false);
				setSyncConflict(false);
				setSaveFailed(false);
				setIssues([]);
				setConfirmReset(false);
				toast.success("已从父任务重新载入");
			},
			onError: toastApiError,
		}),
	);
	/** 手动「保存」:没有父任务可同步时(表单 / 根任务)就是把防抖里那一次立刻落库 */
	const saveNow = async () => {
		if (conflicted || saveFailed) {
			toast.error("上次保存未成功,请先按提示处理");
			return;
		}
		const found =
			schema.kind === "TABLE" && Array.isArray(draft) && draft.length === 0 ? [] : validateTaskReport(schema, draft);
		setIssues(found);
		if (found.length > 0) {
			toast.error("有内容需要修正,尚未保存");
			return;
		}
		try {
			await save.mutateAsync({ taskId, revision, draft });
			toast.success("已保存");
		} catch {
			/* 失败提示已由 mutation 的 onError 给出 */
		}
	};
	const busy = sync.isPending || reset.isPending;
	return (
		<ReportSection
			actions={
				<div className="flex items-center">
					{data.canEdit ? (
						data.canSyncToParent ? (
							<Button
								variant="ghost"
								size="sm"
								disabled={busy || save.isPending || dirty || conflicted || syncConflict}
								onClick={() => sync.mutate({ taskId })}
							>
								<CloudUpload className="size-3.5" />
								{sync.isPending ? "同步中…" : "保存填报"}
							</Button>
						) : (
							<Button
								variant="ghost"
								size="sm"
								disabled={save.isPending || conflicted || saveFailed}
								onClick={() => void saveNow()}
							>
								<Save className="size-3.5" />
								{save.isPending ? "保存中…" : "保存"}
							</Button>
						)
					) : null}
					<TaskReportExcel
						taskId={taskId}
						schema={schema}
						canEdit={data.canEdit}
						disabled={save.isPending || busy}
						onImport={(value) => {
							const next = value as Row | Row[];
							generationRef.current += 1;
							setDraft(next);
							replaceRowKeys(Array.isArray(next) ? next.map(() => crypto.randomUUID()) : []);
							markDirty();
							setIssues([]);
							setPage(1);
						}}
					/>
				</div>
			}
		>
			{syncConflict && (
				<div role="alert" className="flex items-center gap-2 text-sm text-destructive">
					父任务的数据已变更，请重新载入后再填写。
					<Button
						variant="outline"
						size="sm"
						disabled={busy || save.isPending || dirty || conflicted}
						onClick={() => setConfirmReset(true)}
					>
						从父任务重新载入
					</Button>
				</div>
			)}
			<ConfirmDialog
				open={confirmReset}
				onOpenChange={setConfirmReset}
				title="从父任务重新载入"
				description="将丢弃当前子任务草稿，并用父任务当前范围的数据替换。此操作无法撤销。"
				confirmText="重新载入"
				pendingText="载入中…"
				isPending={reset.isPending}
				onConfirm={() => reset.mutate({ taskId, revision })}
			/>
			<ConfirmDialog
				open={pendingDeleteRow !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDeleteRow(null);
				}}
				title={`删除第 ${(pendingDeleteRow?.index ?? 0) + 1} 行`}
				description="这一行会从当前填报草稿中移除；自动保存后无法撤销。"
				onConfirm={() => {
					if (!pendingDeleteRow) return;
					const index = rowKeysRef.current.indexOf(pendingDeleteRow.key);
					if (index >= 0) {
						setDraft((prev) => (Array.isArray(prev) ? prev.filter((_, i) => i !== index) : prev));
						replaceRowKeys(rowKeysRef.current.filter((_, i) => i !== index));
						markDirty();
					}
					setPendingDeleteRow(null);
				}}
			/>
			<div className="grid gap-4">
				{schema.kind === "TABLE" ? <p className="text-sm text-muted-foreground">共 {rows.length} 条数据</p> : null}
				{schema.kind === "OBJECT" && data.syncedChildren.length > 0 ? (
					<div className="grid gap-3">
						<p className="text-sm font-medium text-foreground">子任务填报</p>
						{data.syncedChildren.map((child) => (
							<div key={child.taskId} className="grid gap-2 rounded-md border border-border p-3">
								<span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
									<span>{child.executorName ? `执行人:${child.executorName}` : child.name}</span>
									{child.syncedAt ? <span>保存于 {formatLocalDateTime(child.syncedAt)}</span> : null}
								</span>
								{/* 普通字段:一张表(表头 = 字段名,一行 = 这个子任务的那份填报) */}
								{plainFields.length > 0 ? (
									<div className="min-w-0 overflow-x-auto">
										<table className="w-full border-collapse text-left text-sm">
											<thead>
												<tr className="border-b border-border">
													{plainFields.map((field) => (
														<th
															key={field.id}
															scope="col"
															className={cn(
																fieldColWidth(field),
																"px-2 py-1.5 text-xs font-medium text-muted-foreground",
															)}
														>
															{field.label}
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												<tr>
													{plainFields.map((field) => (
														<td key={field.id} className="px-2 py-1.5 align-top break-words">
															<ReportValueView
																taskId={taskId}
																field={field}
																value={(child.payload as Row | null)?.[field.id]}
																files={data.files}
															/>
														</td>
													))}
												</tr>
											</tbody>
										</table>
									</div>
								) : null}
								{/* 数组字段:**换行缩进**单独成块 —— 元素多的字段塞进列里会把整张表撑爆 */}
								{arrayFields.map((field) => (
									<div key={field.id} className="grid gap-1.5 pl-6">
										<span className="text-xs font-medium text-muted-foreground">{field.label}</span>
										<ReportValueView
											taskId={taskId}
											field={field}
											value={(child.payload as Row | null)?.[field.id]}
											files={data.files}
										/>
									</div>
								))}
							</div>
						))}
					</div>
				) : null}
				{schema.kind === "TABLE" && rows.length === 0 && <p className="text-sm text-muted-foreground">暂无数据行。</p>}
				<div className={schema.kind === "TABLE" ? "min-w-0 overflow-x-auto" : "grid gap-3"}>
					{/* 字段宽度未知就**均分**:table-fixed + 每列一只 col(操作列固定宽、不参与均分) */}
					{schema.kind === "TABLE" ? (
						<table className="w-full min-w-[36rem] table-fixed border-collapse text-sm">
							<colgroup>
								{schema.fields.map((field) => (
									<col key={field.id} />
								))}
								{data.canEdit ? <col className="w-16" /> : null}
							</colgroup>
							<thead>
								<tr>
									{schema.fields.map((field) => (
										<th
											key={field.id}
											className="relative border border-border px-2 py-2 text-left"
											style={columnSizing[field.id] ? { width: columnSizing[field.id] } : undefined}
										>
											{field.label}
											{field.required ? " *" : ""}
											{/* 拖右边缘调列宽,双击重置回均分 */}
											<TableResizeHandle columnId={field.id} onChange={setColumnSizing} />
										</th>
									))}
									{data.canEdit && <th className="border border-border px-2">操作</th>}
								</tr>
							</thead>
							<tbody>
								{pageRows.map((row, offset) => {
									// 表格里按「本页第几行」找 DOM(上下键),写数据用整份数据的下标
									const index = pageStart + offset;
									const rowKey = rowKeys[index];
									const generation = generationRef.current;
									return (
										<tr key={rowKey}>
											{schema.fields.map((field, column) => (
												<td
													key={field.id}
													className="border border-border p-2"
													onPaste={(event) => {
														if (!data.canEdit || busy || field.readOnly) {
															event.preventDefault();
															return;
														}
														const text = event.clipboardData.getData("text");
														// 单格粘贴交给输入框自己处理;带分隔符的才按区域铺开
														if (!text.includes("\t") && !text.includes("\n")) return;
														event.preventDefault();
														setDraft(pasteReportGrid(schema, rows, index, column, text));
														markDirty();
														setIssues([]);
													}}
													onKeyDown={(event) => {
														const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
														if (!delta) return;
														const target = event.currentTarget
															.closest("table")
															?.querySelector<HTMLInputElement>(
																`tr:nth-child(${offset + delta + 1}) td:nth-child(${column + 1}) input`,
															);
														if (!target || target.disabled) return;
														event.preventDefault();
														target.focus();
													}}
												>
													<ReportField
														taskId={taskId}
														field={field}
														value={row[field.id]}
														invalid={invalidOf(index, field.id)}
														disabled={!data.canEdit || busy || field.readOnly}
														files={data.files}
														onChange={(value) => update(index, field.id, value, generation, rowKey)}
													/>
												</td>
											))}
											{data.canEdit && (
												<td className="border border-border p-2">
													<ActionButton
														tone="danger"
														aria-label={`删除第 ${index + 1} 行`}
														disabled={busy}
														onClick={() => setPendingDeleteRow({ key: rowKey, index })}
													>
														删除
													</ActionButton>
												</td>
											)}
										</tr>
									);
								})}
							</tbody>
						</table>
					) : (
						/* 表单模式:父任务与子任务**都**按表单渲染;数组字段用表格(标签在上,表格占满整行) */
						schema.fields.map((field) => (
							<DetailRow
								key={field.id}
								label={field.label}
								align={field.type === "array" ? "start" : "center"}
								className={field.type === "array" ? "flex-col items-stretch gap-2" : undefined}
							>
								<ReportField
									key={`${field.id}:${generationRef.current}`}
									taskId={taskId}
									field={field}
									value={rows[0][field.id]}
									invalid={invalidOf(0, field.id)}
									disabled={!data.canEdit || busy || field.readOnly}
									files={data.files}
									arrayLayout="table"
									onChange={(
										(generation) => (value) =>
											update(0, field.id, value, generation)
									)(generationRef.current)}
								/>
							</DetailRow>
						))
					)}
				</div>
				{schema.kind === "TABLE" ? (
					<PaginationControl
						page={currentPage}
						pageSize={pageSize}
						total={rows.length}
						onPageChange={setPage}
						onPageSizeChange={(next) => {
							setPageSize(next);
							setPage(1);
						}}
					/>
				) : null}
				{saveFailed && (
					<p role="alert" className="text-sm text-destructive">
						自动保存失败，本地内容尚未保存。继续编辑后将重新尝试。
					</p>
				)}
				{issues.length > 0 && (
					<ul role="alert" className="grid gap-1 text-sm text-destructive">
						{issues.map((issue) => (
							<li key={`${issue.row}-${issue.field}-${issue.message}`}>
								{issue.row === null ? "" : `第 ${issue.row + 1} 行 · `}
								{schema.fields.find((field) => field.id === issue.field)?.label ?? issue.field}：{issue.message}
							</li>
						))}
					</ul>
				)}
				{data.canEdit && (
					<div className="flex flex-wrap gap-2">
						{schema.kind === "TABLE" && (
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() => {
									replaceRowKeys([...rowKeysRef.current, crypto.randomUUID()]);
									setPage(Math.ceil((rows.length + 1) / pageSize));
									setDraft([
										...rows,
										Object.fromEntries(
											schema.fields
												.filter((field) => field.defaultValue !== undefined)
												.map((field) => [field.id, field.defaultValue]),
										) as Row,
									]);
									markDirty();
								}}
							>
								<Plus className="size-3.5" />
								添加行
							</Button>
						)}
					</div>
				)}
			</div>
		</ReportSection>
	);
}

/**
 * 「清空」图标按钮 —— 控件有值时露在边上,点一下把值抹掉(填错了不用一个个删)。
 * 图标按钮必须有可读名(`aria-label` + `title`),否则读屏用户不知道它是什么。
 */
function ClearButton({ label, onClear, className }: { label: string; onClear: () => void; className?: string }) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
				"hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
				className,
			)}
			onClick={onClear}
		>
			<X className="size-3.5" />
		</button>
	);
}

/** 文本类输入框 —— 右侧内嵌「清空」(有值才出现);日期 / 选择类控件各自带原生图标,清空按钮放在外面 */
function ClearableInput({
	clearLabel,
	onClear,
	className,
	value,
	disabled,
	...props
}: React.ComponentProps<typeof Input> & { clearLabel: string; onClear: () => void }) {
	const filled = typeof value === "string" ? value !== "" : value != null;
	return (
		<div className="relative">
			<Input value={value} disabled={disabled} className={cn(filled && "pr-8", className)} {...props} />
			{filled && !disabled ? (
				<ClearButton label={clearLabel} onClear={onClear} className="absolute right-1 top-1/2 -translate-y-1/2" />
			) : null}
		</div>
	);
}

function ReportField({
	taskId,
	field,
	value,
	disabled,
	invalid,
	files,
	arrayLayout = "form",
	onChange,
}: {
	/** 现签附件地址要用它(预览弹窗) */
	taskId: string;
	field: ReportFieldLike;
	value: Value | undefined;
	disabled: boolean;
	/** 校验点名了这个字段 —— 走 `aria-invalid`,与表单里的必填错同一套红 */
	invalid?: boolean;
	/** 附件字段要按 id 找文件名(reportGet 带回来的) */
	files?: readonly ReportFile[];
	/** 数组字段的排布 —— `table` 时整个数组渲染成表格(子任务的表单模式用,省空间) */
	arrayLayout?: "form" | "table";
	onChange: (value: Value) => void;
}) {
	/** 附件字段:选完即传,存 id 列表;展示用 reportGet 解析回来的文件名,点名字开预览 */
	if (field.type === "attachment")
		return (
			<ReportAttachmentField
				taskId={taskId}
				field={field}
				value={value}
				disabled={disabled}
				files={files}
				onChange={onChange}
			/>
		);
	/** 数组字段:元素是一组对象 —— 给「添加」按钮,一次加一个空对象再逐项填 */
	if (field.type === "array")
		return (
			<ReportArrayField
				taskId={taskId}
				field={field}
				value={value}
				disabled={disabled}
				invalid={invalid}
				files={files}
				layout={arrayLayout}
				onChange={onChange}
			/>
		);
	/** 文本类(文本 / 手机 / 邮箱 / 整数 / 小数):一个输入框 + 内嵌「清空」 */
	if (
		field.type === "text" ||
		field.type === "phone" ||
		field.type === "email" ||
		field.type === "integer" ||
		field.type === "decimal"
	) {
		const kind = field.type === "integer" || field.type === "decimal" ? "number" : "text";
		const text = typeof value === "string" ? value : value == null ? "" : String(value);
		return (
			<ClearableInput
				aria-label={field.label}
				aria-invalid={invalid || undefined}
				type={field.type === "phone" ? "tel" : field.type === "email" ? "email" : kind}
				inputMode={
					field.type === "phone" ? "tel" : field.type === "email" ? "email" : kind === "number" ? "decimal" : undefined
				}
				step={field.type === "decimal" ? "any" : undefined}
				placeholder={
					field.type === "phone"
						? "11 位手机号,如 13800138000"
						: field.type === "email"
							? "name@example.com"
							: field.type === "text"
								? "文本"
								: "0"
				}
				value={text}
				disabled={disabled}
				clearLabel={`清空${field.label}`}
				onClear={() => onChange(null)}
				onChange={(event) => {
					const raw = event.target.value;
					onChange(raw === "" ? null : kind === "number" ? Number(raw) : raw);
				}}
			/>
		);
	}
	if (field.type === "multiselect") {
		const picked = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
		return (
			<div className="flex flex-wrap items-center gap-3">
				{field.options?.map((option) => (
					<span key={option} className="flex items-center gap-2 text-sm">
						<Checkbox
							aria-label={`${field.label}: ${option}`}
							checked={picked.includes(option)}
							disabled={disabled}
							onCheckedChange={(checked) =>
								onChange(checked ? [...picked, option] : picked.filter((item) => item !== option))
							}
						/>
						{option}
					</span>
				))}
				{picked.length > 0 ? <ClearButton label={`清空${field.label}`} onClear={() => onChange([])} /> : null}
			</div>
		);
	}
	if (field.type === "select") {
		const picked = typeof value === "string" ? value : "";
		/** 有值时「清空」顶掉触发器自己的箭头 —— 一个位置只放一个动作,窄表格里也不会挤 */
		const clearable = !!picked && !disabled;
		return (
			<div className="relative">
				<Select
					items={[
						...(field.allowEmpty ? [{ value: null, label: "（空）" }] : []),
						...(field.options ?? []).map((option) => ({ value: option, label: option })),
					]}
					value={picked || null}
					disabled={disabled}
					onValueChange={(next) => onChange(next ?? null)}
				>
					<SelectTrigger
						aria-label={field.label}
						aria-invalid={invalid || undefined}
						className={cn("w-full", clearable && "pr-8 [&>svg]:hidden")}
					>
						<SelectValue placeholder="请选择" />
					</SelectTrigger>
					<SelectContent>
						{field.allowEmpty && <SelectItem value={null}>（空）</SelectItem>}
						{field.options?.map((option) => (
							<SelectItem key={option} value={option}>
								{option}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{clearable ? (
					<ClearButton
						label={`清空${field.label}`}
						onClear={() => onChange(null)}
						className="absolute right-1 top-1/2 -translate-y-1/2"
					/>
				) : null}
			</div>
		);
	}
	/** 日期 / 日期时间:原生控件自带日历图标,「清空」放在控件外面,不跟它抢位置 */
	const kind = field.type === "date" ? "date" : "datetime-local";
	// `datetime-local` 的 value 是**本地**墙上时间:存的是 ISO(UTC),这里折算过来,别直接 slice
	const display = field.type === "datetime" ? toLocalMinuteInput(value as string | null) : String(value ?? "");
	return (
		<div className="flex items-center gap-1.5">
			<Input
				aria-label={field.label}
				aria-invalid={invalid || undefined}
				type={kind}
				value={display}
				disabled={disabled}
				className="min-w-0 flex-1"
				onChange={(event) => {
					const raw = event.target.value;
					onChange(!raw ? null : kind === "datetime-local" ? parseLocalDateTime(raw) : raw);
				}}
			/>
			{display ? <ClearButton label={`清空${field.label}`} onClear={() => onChange(null)} /> : null}
		</div>
	);
}

/** 填报里的附件字段 —— 选完即传,值只存 `sys_file.id`;展示用 `reportGet` 带回的文件名 */
function ReportAttachmentField({
	taskId,
	field,
	value,
	disabled,
	files,
	onChange,
}: {
	taskId: string;
	field: ReportFieldLike;
	value: Value | undefined;
	disabled: boolean;
	files?: readonly ReportFile[];
	onChange: (value: Value) => void;
}) {
	const { upload } = useFileUpload();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [uploading, setUploading] = useState(false);
	/**
	 * **刚传上来的**那几个附件的名字与大小(按 id)。
	 *
	 * `reportGet.files` 是查询快照:上传只刷新文件列表,不会重取填报 —— 新附件的 id 不在里面,
	 * 于是文件名回退成 id、预览显示 0B(用户报过这个现象,尤其是同一批里后传的那个)。
	 * 上传结果本身就带 `originName / size`,就地记下来,不必等下一次查询。
	 */
	const [uploaded, setUploaded] = useState<Record<string, ReportFile>>({});
	/** 点文件名开预览(地址现签,按原始附件名下载) */
	const [picked, setPicked] = useState<ReportFile | null>(null);
	const ids = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
	/** 当前值的最新快照:上传是异步的,合并要基于**完成时**的 id 列表,不能用在 `await` 之前的 */
	const idsRef = useRef(ids);
	idsRef.current = ids;
	const fileOf = (id: string): ReportFile =>
		files?.find((file) => file.id === id) ?? uploaded[id] ?? { id, name: id, size: 0, contentType: null };
	const nameOf = (id: string) => fileOf(id).name;

	async function pick(list: FileList | null) {
		if (!list?.length) return;
		setUploading(true);
		try {
			// 多选要攒齐再写一次(逐个 onChange 会拿同一个旧值)
			const picked: string[] = [];
			const meta: Record<string, ReportFile> = {};
			// 20 个是服务端口径的上限,满了就一个都不发(不是至少发一个)
			for (const file of Array.from(list).slice(0, 20 - idsRef.current.length)) {
				const result = await upload(file, "private");
				if (!result.ok) {
					toast.error(result.message);
					continue;
				}
				meta[result.row.id] = {
					id: result.row.id,
					name: result.row.originName,
					size: result.row.size,
					contentType: result.row.contentType,
				};
				if (!idsRef.current.includes(result.row.id) && !picked.includes(result.row.id)) picked.push(result.row.id);
			}
			if (Object.keys(meta).length > 0) setUploaded((prev) => ({ ...prev, ...meta }));
			if (picked.length > 0) onChange([...idsRef.current, ...picked]);
		} finally {
			setUploading(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{ids.map((id) => (
				<span
					key={id}
					className="inline-flex max-w-56 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
				>
					<button
						type="button"
						className="flex min-w-0 items-center gap-1 transition-colors hover:text-foreground hover:underline"
						title={`预览 ${nameOf(id)}`}
						onClick={() => setPicked(fileOf(id))}
					>
						<Paperclip className="size-3 shrink-0" />
						<span className="truncate">{nameOf(id)}</span>
					</button>
					{disabled ? null : (
						<button
							type="button"
							aria-label={`移除 ${nameOf(id)}`}
							className="text-muted-foreground transition-colors hover:text-destructive"
							onClick={() => onChange(ids.filter((item) => item !== id))}
						>
							<X className="size-3" />
						</button>
					)}
				</span>
			))}
			{disabled ? null : (
				<>
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						aria-label={uploading ? "上传中" : `添加${field.label}`}
						title={uploading ? "上传中…" : "添加附件"}
						disabled={uploading || ids.length >= 20}
						onClick={() => inputRef.current?.click()}
					>
						{uploading ? (
							<span className="size-3.5 animate-pulse rounded-full bg-primary/60" />
						) : (
							<Plus className="size-4" />
						)}
					</Button>
					<input
						ref={inputRef}
						type="file"
						multiple
						className="hidden"
						aria-label={`${field.label} 附件`}
						onChange={(event) => void pick(event.target.files)}
					/>
				</>
			)}
			<TaskAttachmentPreview
				taskId={taskId}
				attachment={picked}
				open={picked !== null}
				onOpenChange={(next) => {
					if (!next) setPicked(null);
				}}
			/>
		</div>
	);
}

/**
 * 只读展示一格填报值 —— 按**字段类型**渲染,不吐原始 JSON:
 * 附件是能点开的附件名(原名),数组展开成「第 N 项」+ 元素字段,单选 / 多选走选项名。
 */
function ReportValueView({
	taskId,
	field,
	value,
	files,
}: {
	taskId: string;
	field: ReportFieldLike;
	value: Value | undefined;
	files: readonly ReportFile[];
}) {
	if (field.type === "attachment") {
		const ids = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
		if (ids.length === 0) return <>—</>;
		return <ReportFileChips taskId={taskId} ids={ids} files={files} />;
	}
	if (field.type === "array") return <ReportArrayView taskId={taskId} field={field} value={value} files={files} />;
	return <>{plainTextOf(field, value)}</>;
}

/** 数组字段的只读渲染 —— 元素没有 id,用「按位置稳定」的 key(与编辑侧同一套) */
function ReportArrayView({
	taskId,
	field,
	value,
	files,
}: {
	taskId: string;
	field: ReportFieldLike;
	value: Value | undefined;
	files: readonly ReportFile[];
}) {
	const items = (Array.isArray(value) ? value : []).filter(
		(item): item is Record<string, Value> => !!item && typeof item === "object" && !Array.isArray(item),
	);
	const itemKeys = useStableKeys(items.length, "tc-read");
	const itemFields = field.itemFields ?? [];
	if (items.length === 0) return <>—</>;
	return (
		<div className="min-w-0 overflow-x-auto">
			<table className="w-full border-collapse text-left text-sm">
				<thead>
					<tr className="border-b border-border text-xs text-muted-foreground">
						<th scope="col" className="w-10 whitespace-nowrap px-2 py-1 font-normal">
							序号
						</th>
						{itemFields.map((sub) => (
							<th key={sub.id} scope="col" className={cn(fieldColWidth(sub), "px-2 py-1 font-normal")}>
								{sub.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{items.map((item, index) => (
						<tr key={itemKeys[index]} className="align-top">
							<td className="whitespace-nowrap px-2 py-1 text-xs tabular-nums text-muted-foreground">{index + 1}</td>
							{itemFields.map((sub) => (
								<td key={sub.id} className="px-2 py-1 break-words">
									<ReportValueView taskId={taskId} field={sub} value={item[sub.id]} files={files} />
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** 只读的附件名 —— 点开就是预览弹窗(表格单元格 / 表单字段 / 父任务看子任务填报共用) */
function ReportFileChips({
	taskId,
	ids,
	files,
}: {
	taskId: string;
	ids: readonly string[];
	files: readonly ReportFile[];
}) {
	const [picked, setPicked] = useState<ReportFile | null>(null);
	return (
		<>
			<span className="flex flex-wrap items-center gap-1.5">
				{ids.map((id) => {
					const file = files.find((item) => item.id === id);
					const name = file?.name ?? id;
					return (
						<button
							key={id}
							type="button"
							className="inline-flex max-w-56 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
							title={`预览 ${name}`}
							onClick={() => setPicked(file ?? { id, name: id, size: 0, contentType: null })}
						>
							<Paperclip className="size-3 shrink-0" />
							<span className="truncate">{name}</span>
						</button>
					);
				})}
			</span>
			<TaskAttachmentPreview
				taskId={taskId}
				attachment={picked}
				open={picked !== null}
				onOpenChange={(next) => {
					if (!next) setPicked(null);
				}}
			/>
		</>
	);
}

/**
 * 表格里一列的下限宽度 —— 日期、附件、多选天生占地方,文本窄。
 * 按类型给宽度,免得一张表里「隐患等级」和「照片」互相挤扁。
 */
function fieldColWidth(field: ReportFieldLike): string {
	switch (field.type) {
		case "date":
			return "min-w-36";
		case "datetime":
			return "min-w-44";
		case "attachment":
			return "min-w-48";
		case "multiselect":
			return "min-w-40";
		case "integer":
		case "decimal":
			return "min-w-28";
		case "select":
			return "min-w-32";
		default:
			return "min-w-32";
	}
}

/** 一个值的纯文本口径:单选 / 多选给选项名,其余原样(空值一律「—」) */
function plainTextOf(field: ReportFieldLike, value: Value | undefined): string {
	if (value == null || value === "") return "—";
	if (field.type === "multiselect") {
		const picked = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
		return picked.length === 0 ? "—" : picked.join("、");
	}
	if (field.type === "select") return String(value);
	if (field.type === "datetime") return formatLocalDateTime(value as string) || String(value);
	if (typeof value === "boolean") return value ? "是" : "否";
	if (Array.isArray(value)) return value.length === 0 ? "—" : `${value.length} 项`;
	return String(value);
}

/** 数组字段 —— 元素是一组对象:点「添加」加一个空对象,再逐项填 */
function ReportArrayField({
	taskId,
	field,
	value,
	disabled,
	invalid,
	files,
	layout = "form",
	onChange,
}: {
	taskId: string;
	field: ReportFieldLike;
	value: Value | undefined;
	disabled: boolean;
	invalid?: boolean;
	files?: readonly ReportFile[];
	/** `form` = 一项一框竖排(父任务自己的表单);`table` = 整张数组渲染成表格(子任务,省空间) */
	layout?: "form" | "table";
	onChange: (value: Value) => void;
}) {
	const items = (Array.isArray(value) ? value : []).filter(
		(item): item is Record<string, Value> => !!item && typeof item === "object" && !Array.isArray(item),
	);
	/**
	 * 元素数组的**最新值**。附件上传是异步的(几秒),回调里若用发起时的 `items` 快照重建数组,
	 * 期间新增的元素会被整段抹掉 —— 现象就是「第二个元素里传的附件,上传完成却没保存上」。
	 * 写回一律从 `itemsRef.current` 起算;再往上的 `update()` 也是函数式更新,两层都不吃旧快照。
	 */
	const itemsRef = useRef(items);
	itemsRef.current = items;
	const itemKeysRef = useRef<string[]>(items.map(() => crypto.randomUUID()));
	while (itemKeysRef.current.length < items.length) itemKeysRef.current.push(crypto.randomUUID());
	if (itemKeysRef.current.length > items.length) itemKeysRef.current.length = items.length;
	const setItem = (itemKey: string, fieldKey: string, next: Value) => {
		if (!itemKeysRef.current.includes(itemKey)) return;
		onChange(
			updateKeyedItem(itemsRef.current, itemKeysRef.current, itemKey, (item) => ({ ...item, [fieldKey]: next })),
		);
	};
	const itemFields = field.itemFields ?? [];
	const itemKeys = itemKeysRef.current;
	/** 待确认删除的数组项 —— 用 itemKey 定位,避免确认期间数组顺序变化时误删 */
	const [pendingRemove, setPendingRemove] = useState<{ key: string; index: number } | null>(null);
	const removeItem = (itemKey: string) => {
		const index = itemKeysRef.current.indexOf(itemKey);
		if (index < 0) return;
		itemKeysRef.current = itemKeysRef.current.filter((key) => key !== itemKey);
		onChange(itemsRef.current.filter((_, i) => i !== index));
	};
	const addItem = () => {
		itemKeysRef.current = [...itemKeysRef.current, crypto.randomUUID()];
		onChange([...itemsRef.current, {}]);
	};
	const removeConfirm = (
		<ConfirmDialog
			open={pendingRemove !== null}
			onOpenChange={(next) => {
				if (!next) setPendingRemove(null);
			}}
			title={`删除第 ${(pendingRemove?.index ?? 0) + 1} 项`}
			description="这一项会从当前数组草稿中移除；自动保存后无法撤销。"
			onConfirm={() => {
				if (!pendingRemove) return;
				removeItem(pendingRemove.key);
				setPendingRemove(null);
			}}
		/>
	);
	/** 数组整体渲染成表格 —— 表头一行是元素字段,每行一个元素(只读那侧同款口径) */
	if (layout === "table")
		return (
			<div className={cn("grid gap-2", invalid && "rounded-md ring-1 ring-destructive/40")}>
				{items.length === 0 ? <p className="text-xs text-muted-foreground">还没有数据,点下面「添加」。</p> : null}
				{items.length > 0 ? (
					<div className="min-w-0 overflow-x-auto">
						<table className="w-full border-collapse text-left text-sm">
							<thead>
								<tr className="border-b border-border text-xs text-muted-foreground">
									<th scope="col" className="w-10 whitespace-nowrap border-r border-border/60 px-2 py-1 font-normal">
										序号
									</th>
									{itemFields.map((sub) => (
										<th
											key={sub.id}
											scope="col"
											className={cn(fieldColWidth(sub), "border-r border-border/60 px-2 py-1 font-normal")}
										>
											{sub.label}
											{sub.required ? " *" : ""}
										</th>
									))}
									{disabled ? null : (
										<th scope="col" className="w-16 whitespace-nowrap px-2 py-1 font-normal">
											操作
										</th>
									)}
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{items.map((item, index) => (
									<tr key={itemKeys[index]} className="align-top">
										<td className="whitespace-nowrap border-r border-border/60 px-2 py-1 text-xs tabular-nums text-muted-foreground">
											{index + 1}
										</td>
										{itemFields.map((sub) => (
											<td key={sub.id} className="border-r border-border/60 px-2 py-1 last:border-r-0">
												<ReportField
													taskId={taskId}
													field={sub}
													value={item[sub.id]}
													disabled={disabled || sub.readOnly}
													files={files}
													onChange={(next) => setItem(itemKeys[index], sub.id, next)}
												/>
											</td>
										))}
										{disabled ? null : (
											<td className="px-2 py-1">
												<ActionButton
													tone="danger"
													aria-label={`删除第 ${index + 1} 项`}
													onClick={() => setPendingRemove({ key: itemKeys[index], index })}
												>
													删除
												</ActionButton>
											</td>
										)}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
				{disabled ? null : (
					<Button
						variant="outline"
						size="sm"
						className="justify-self-start"
						disabled={items.length >= 200}
						onClick={addItem}
					>
						<Plus className="size-3.5" />
						添加
					</Button>
				)}
				{removeConfirm}
			</div>
		);
	return (
		<div className={cn("grid gap-2", invalid && "rounded-md ring-1 ring-destructive/40")}>
			{items.length === 0 ? <p className="text-xs text-muted-foreground">还没有数据,点下面「添加」。</p> : null}
			{items.map((item, index) => (
				<div key={itemKeys[index]} className="grid gap-1.5 rounded-md border border-border p-2">
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-muted-foreground">第 {index + 1} 项</span>
						{disabled ? null : (
							<ActionButton
								tone="danger"
								aria-label={`删除第 ${index + 1} 项`}
								onClick={() => setPendingRemove({ key: itemKeys[index], index })}
							>
								删除
							</ActionButton>
						)}
					</div>
					{itemFields.map((sub) => (
						<div key={sub.id} className="grid gap-1">
							<span className="text-xs text-muted-foreground">
								{sub.label}
								{sub.required ? " *" : ""}
							</span>
							<ReportField
								taskId={taskId}
								field={sub}
								value={item[sub.id]}
								disabled={disabled || sub.readOnly}
								files={files}
								onChange={(next) => setItem(itemKeys[index], sub.id, next)}
							/>
						</div>
					))}
				</div>
			))}
			{disabled ? null : (
				<Button
					variant="outline"
					size="sm"
					className="justify-self-start"
					disabled={items.length >= 200}
					onClick={addItem}
				>
					<Plus className="size-3.5" />
					添加
				</Button>
			)}
			{removeConfirm}
		</div>
	);
}
