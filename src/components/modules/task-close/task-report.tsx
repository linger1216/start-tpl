import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { CloudUpload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { TaskReportExcel } from "#/components/modules/task-close/task-report-excel";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { TableResizeHandle } from "#/components/ui/table-resize-handle";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { toastApiError } from "#/lib/api/error";
import { pasteReportGrid, type TaskReportSchema, validateTaskReport } from "#/lib/task-report-spec";

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

type Value = string | number | boolean | string[] | null;
type Row = Record<string, Value>;
type ReportData = NonNullable<inferRouterOutputs<TRPCRouter>["taskClose"]["reportGet"]>;

function TaskReportEditor({ taskId, schema, data }: { taskId: string; schema: TaskReportSchema; data: ReportData }) {
	const trpc = useTRPC();
	const [draft, setDraft] = useState<Row | Row[]>(data.report.draft as Row | Row[]);
	const [rowKeys, setRowKeys] = useState(() =>
		Array.isArray(data.report.draft) ? data.report.draft.map(() => crypto.randomUUID()) : [],
	);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const [revision, setRevision] = useState(data.report.revision);
	const [dirty, setDirty] = useState(false);
	const [conflicted, setConflicted] = useState(false);
	const [syncConflict, setSyncConflict] = useState(false);
	const [confirmReset, setConfirmReset] = useState(false);
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
	const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
	const currentPage = Math.min(page, totalPages);
	const pageStart = (currentPage - 1) * pageSize;
	const pageRows = rows.slice(pageStart, pageStart + pageSize);
	/** 这个格子有没有被校验点名 —— 有就把输入框标红,不用人对着下面的清单逐条找 */
	const invalidOf = (row: number, field: string) =>
		issues.some((issue) => issue.field === field && (schema.kind === "OBJECT" || issue.row === row));
	const update = (index: number, field: string, value: Value) => {
		const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
		setDraft(schema.kind === "TABLE" ? next : next[0]);
		markDirty();
		setIssues([]);
	};
	/** 手动「保存」= 把本子任务的行同步到父任务。 */
	const sync = useMutation(
		trpc.taskClose.reportSyncToParent.mutationOptions({
			onSuccess: (result) => {
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
				setDraft(next);
				setRowKeys(Array.isArray(next) ? next.map(() => crypto.randomUUID()) : []);
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
	const busy = sync.isPending || reset.isPending;
	return (
		<ReportSection
			actions={
				<div className="flex items-center">
					{data.canSyncToParent ? (
						<Button
							variant="ghost"
							size="sm"
							disabled={busy || save.isPending || dirty || conflicted || syncConflict || !data.canEdit}
							onClick={() => sync.mutate({ taskId })}
						>
							<CloudUpload className="size-3.5" />
							{sync.isPending ? "同步中…" : "保存填报"}
						</Button>
					) : null}
					<TaskReportExcel
						taskId={taskId}
						schema={schema}
						canEdit={data.canEdit}
						disabled={save.isPending || busy}
						onImport={(value) => {
							const next = value as Row | Row[];
							setDraft(next);
							setRowKeys(Array.isArray(next) ? next.map(() => crypto.randomUUID()) : []);
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
			<div className="grid gap-4">
				<p className="text-sm text-muted-foreground">共 {rows.length} 条数据</p>
				{schema.kind === "TABLE" && rows.length === 0 && <p className="text-sm text-muted-foreground">暂无数据行。</p>}
				<div className={schema.kind === "TABLE" ? "overflow-x-auto" : "grid gap-3"}>
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
									return (
										<tr key={rowKeys[index]}>
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
														field={field}
														value={row[field.id]}
														invalid={invalidOf(index, field.id)}
														disabled={!data.canEdit || busy || field.readOnly}
														onChange={(value) => update(index, field.id, value)}
													/>
												</td>
											))}
											{data.canEdit && (
												<td className="border border-border p-2">
													<Button
														variant="ghost"
														size="sm"
														disabled={busy}
														onClick={() => {
															setDraft(rows.filter((_, i) => i !== index));
															setRowKeys((keys) => keys.filter((_, i) => i !== index));
															markDirty();
														}}
													>
														删除
													</Button>
												</td>
											)}
										</tr>
									);
								})}
							</tbody>
						</table>
					) : (
						schema.fields.map((field) => (
							<DetailRow key={field.id} label={field.label} align="center">
								<ReportField
									field={field}
									value={rows[0][field.id]}
									invalid={invalidOf(0, field.id)}
									disabled={!data.canEdit || busy || field.readOnly}
									onChange={(value) => update(0, field.id, value)}
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
									setRowKeys((keys) => [...keys, crypto.randomUUID()]);
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
								添加行
							</Button>
						)}
					</div>
				)}
			</div>
		</ReportSection>
	);
}

function ReportField({
	field,
	value,
	disabled,
	invalid,
	onChange,
}: {
	field: TaskReportSchema["fields"][number];
	value: Value | undefined;
	disabled: boolean;
	/** 校验点名了这个字段 —— 走 `aria-invalid`,与表单里的必填错同一套红 */
	invalid?: boolean;
	onChange: (value: Value) => void;
}) {
	if (field.type === "multiselect")
		return (
			<div className="flex flex-wrap gap-3">
				{field.options?.map((option) => (
					<span key={option} className="flex items-center gap-2 text-sm">
						<Checkbox
							aria-label={`${field.label}: ${option}`}
							checked={Array.isArray(value) && value.includes(option)}
							disabled={disabled}
							onCheckedChange={(checked) =>
								onChange(
									checked
										? [...(Array.isArray(value) ? value : []), option]
										: (Array.isArray(value) ? value : []).filter((item) => item !== option),
								)
							}
						/>
						{option}
					</span>
				))}
			</div>
		);
	if (field.type === "select")
		return (
			<Select
				items={[
					...(field.allowEmpty ? [{ value: null, label: "（空）" }] : []),
					...(field.options ?? []).map((option) => ({ value: option, label: option })),
				]}
				value={typeof value === "string" ? value : null}
				disabled={disabled}
				onValueChange={(next) => onChange(next ?? null)}
			>
				<SelectTrigger aria-label={field.label} aria-invalid={invalid || undefined} className="w-full">
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
		);
	const kind =
		field.type === "integer" || field.type === "decimal"
			? "number"
			: field.type === "date"
				? "date"
				: field.type === "datetime"
					? "datetime-local"
					: "text";
	const display =
		field.type === "datetime" && typeof value === "string" && !Number.isNaN(Date.parse(value))
			? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
			: String(value ?? "");
	return (
		<Input
			aria-label={field.label}
			aria-invalid={invalid || undefined}
			type={kind}
			step={field.type === "decimal" ? "any" : undefined}
			value={display}
			disabled={disabled}
			onChange={(event) => {
				const raw = event.target.value;
				onChange(
					!raw ? null : kind === "number" ? Number(raw) : kind === "datetime-local" ? new Date(raw).toISOString() : raw,
				);
			}}
		/>
	);
}
