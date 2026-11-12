import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TaskReportExcel } from "#/components/modules/task-close/task-report-excel";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { toastApiError } from "#/lib/api/error";
import {
	pasteReportGrid,
	type TaskReportSchema,
	taskReportSchema,
	type validateTaskReport,
} from "#/lib/task-report-spec";

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
	if (report.isPending) return <p className="text-sm text-muted-foreground">正在加载填报…</p>;
	if (report.isError) return <p className="text-sm text-muted-foreground">无法加载填报。</p>;
	if (!report.data) {
		if (!canManage) return <p className="text-sm text-muted-foreground">此任务没有配置填报。</p>;
		const options = (templates.data ?? []).map((template) => ({ value: template.id, label: template.name }));
		return (
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
		);
	}
	const schema = taskReportSchema.safeParse(report.data.template?.payload);
	if (!schema.success) return <p className="text-sm text-destructive">填报模板无效，请联系管理员。</p>;
	return (
		<TaskReportEditor
			key={`${report.data.report.id}:${report.data.report.status}:${report.data.template.id}`}
			taskId={taskId}
			canManage={canManage}
			schema={schema.data}
			data={report.data}
		/>
	);
}

type Value = string | number | boolean | string[] | null;
type Row = Record<string, Value>;
type ReportData = NonNullable<inferRouterOutputs<TRPCRouter>["taskClose"]["reportGet"]>;

function TaskReportEditor({
	taskId,
	canManage,
	schema,
	data,
}: {
	taskId: string;
	canManage: boolean;
	schema: TaskReportSchema;
	data: ReportData;
}) {
	const trpc = useTRPC();
	const client = useQueryClient();
	const [draft, setDraft] = useState<Row | Row[]>(data.report.draft as Row | Row[]);
	const [rowKeys, setRowKeys] = useState(() =>
		Array.isArray(data.report.draft) ? data.report.draft.map(() => crypto.randomUUID()) : [],
	);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const [revision, setRevision] = useState(data.report.revision);
	const [dirty, setDirty] = useState(false);
	const [blocked, setBlocked] = useState(false);
	const [issues, setIssues] = useState<ReturnType<typeof validateTaskReport>>([]);
	const save = useMutation(
		trpc.taskClose.reportSaveDraft.mutationOptions({
			onSuccess: (result, variables) => {
				setRevision(result.revision);
				// 成功即解除封锁:上一轮失败(多是 revision 冲突)已经靠这次成功补上了新版本
				setBlocked(false);
				if (JSON.stringify(draftRef.current) === JSON.stringify(variables.draft)) setDirty(false);
			},
			onError: (error) => {
				setBlocked(true);
				toastApiError(error);
			},
		}),
	);
	useEffect(() => {
		if (!dirty || blocked || save.isPending || !data.canEdit) return;
		const timer = window.setTimeout(() => save.mutate({ taskId, revision, draft }), 600);
		return () => window.clearTimeout(timer);
	}, [dirty, blocked, save.isPending, data.canEdit, taskId, revision, draft, save.mutate]);
	const rows =
		schema.kind === "TABLE" ? (Array.isArray(draft) ? draft : []) : [Array.isArray(draft) ? {} : (draft ?? {})];
	const update = (index: number, field: string, value: Value) => {
		const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
		setDraft(schema.kind === "TABLE" ? next : next[0]);
		setDirty(true);
		setIssues([]);
	};
	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-sm text-muted-foreground">
					{data.scoped ? `共 ${rows.length} 条数据 · 只显示属于你的部分` : `共 ${rows.length} 条数据`}
				</span>
				{data.canEdit && (
					<span className="flex items-center gap-2 text-xs text-muted-foreground">
						{blocked ? "保存失败，请刷新后处理冲突" : save.isPending ? "正在保存…" : dirty ? "等待保存" : "已保存"}
						{/* 冲突后本地那份已经过时:一律拉服务端最新数据,本地改动丢弃。
						    盲存旧数据会把别人刚写的行打回去(整份数据集口径下尤其致命) */}
						{blocked && dirty && (
							<Button
								variant="link"
								size="sm"
								className="h-auto p-0"
								disabled={save.isPending}
								onClick={async () => {
									const fresh = await client.fetchQuery({
										...trpc.taskClose.reportGet.queryOptions({ taskId }),
										staleTime: 0,
									});
									if (!fresh) return;
									setRevision(fresh.report.revision);
									setDraft(fresh.report.draft as Row | Row[]);
									setRowKeys(
										Array.isArray(fresh.report.draft) ? fresh.report.draft.map(() => crypto.randomUUID()) : [],
									);
									setDirty(false);
									setBlocked(false);
									toast.warning("数据已被他人更新,已载入最新内容,未保存的修改已丢弃");
								}}
							>
								载入最新数据
							</Button>
						)}
					</span>
				)}
			</div>
			{canManage && data.scoped && (
				<p className="text-xs text-muted-foreground">这份填报与父任务共用数据，你只改属于自己的那几条。</p>
			)}
			{!canManage && data.scoped && (
				<p className="text-xs text-muted-foreground">这份填报与父任务共用数据，这里只显示属于执行人的那几条。</p>
			)}
			{canManage && schema.kind === "TABLE" && (
				<p className="text-xs text-muted-foreground">
					需要把这张表分给多位执行人?在「填报模板」页用相同结构另建任务,并为每人配置数据规则。
				</p>
			)}
			<TaskReportExcel
				taskId={taskId}
				schema={schema}
				canEdit={data.canEdit}
				disabled={dirty || save.isPending || blocked}
				onImport={(value) => {
					const next = value as Row | Row[];
					setDraft(next);
					setRowKeys(Array.isArray(next) ? next.map(() => crypto.randomUUID()) : []);
					setDirty(true);
					setIssues([]);
				}}
			/>
			{schema.kind === "TABLE" && rows.length === 0 && <p className="text-sm text-muted-foreground">暂无数据行。</p>}
			<div className={schema.kind === "TABLE" ? "overflow-x-auto" : "grid gap-3"}>
				{schema.kind === "TABLE" ? (
					<table className="w-full min-w-max border-collapse text-sm">
						<thead>
							<tr>
								{schema.fields.map((field) => (
									<th key={field.id} className="border border-border px-2 py-2 text-left">
										{field.label}
										{field.required ? " *" : ""}
									</th>
								))}
								{data.canEdit && <th className="border border-border px-2">操作</th>}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, index) => (
								<tr key={rowKeys[index]}>
									{schema.fields.map((field, column) => (
										<td
											key={field.id}
											className="min-w-40 border border-border p-2"
											onPaste={(event) => {
												const text = event.clipboardData.getData("text");
												// 单格粘贴交给输入框自己处理;带分隔符的才按区域铺开
												if (!text.includes("\t") && !text.includes("\n")) return;
												event.preventDefault();
												setDraft(pasteReportGrid(schema, rows, index, column, text));
												setDirty(true);
												setIssues([]);
											}}
											onKeyDown={(event) => {
												const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
												if (!delta) return;
												const target = event.currentTarget
													.closest("table")
													?.querySelector<HTMLInputElement>(
														`tr:nth-child(${index + delta + 1}) td:nth-child(${column + 1}) input`,
													);
												if (!target || target.disabled) return;
												event.preventDefault();
												target.focus();
											}}
										>
											<ReportField
												field={field}
												value={row[field.id]}
												// 数据范围字段决定这条行归谁 —— 改了就把行交给别人了
												disabled={!data.canEdit || field.readOnly || data.scopeFields.includes(field.id)}
												onChange={(value) => update(index, field.id, value)}
											/>
										</td>
									))}
									{data.canEdit && !data.scoped && (
										<td className="border border-border p-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													setDraft(rows.filter((_, i) => i !== index));
													setRowKeys((keys) => keys.filter((_, i) => i !== index));
													setDirty(true);
												}}
											>
												删除
											</Button>
										</td>
									)}
								</tr>
							))}
						</tbody>
					</table>
				) : (
					schema.fields.map((field) => (
						<DetailRow key={field.id} label={field.label} align="center">
							<ReportField
								field={field}
								value={rows[0][field.id]}
								disabled={!data.canEdit || field.readOnly}
								onChange={(value) => update(0, field.id, value)}
							/>
						</DetailRow>
					))
				)}
			</div>
			{issues.length > 0 && (
				<ul className="grid gap-1 text-sm text-destructive">
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
					{schema.kind === "TABLE" && !data.scoped && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								setRowKeys((keys) => [...keys, crypto.randomUUID()]);
								setDraft([
									...rows,
									Object.fromEntries(
										schema.fields
											.filter((field) => field.defaultValue !== undefined)
											.map((field) => [field.id, field.defaultValue]),
									) as Row,
								]);
								setDirty(true);
							}}
						>
							添加行
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

function ReportField({
	field,
	value,
	disabled,
	onChange,
}: {
	field: TaskReportSchema["fields"][number];
	value: Value | undefined;
	disabled: boolean;
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
				<SelectTrigger aria-label={field.label}>
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
