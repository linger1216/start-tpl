import { useMutation, useQuery } from "@tanstack/react-query";
import { CloudUpload, Plus, Save } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { ReportField } from "#/components/modules/task-close/report-fields";
import { ReportValueView } from "#/components/modules/task-close/report-readonly";
import { ReportSection } from "#/components/modules/task-close/report-section";
import { fieldColWidth, type ReportData, type Row, type Value } from "#/components/modules/task-close/report-types";
import { TaskReportExcel } from "#/components/modules/task-close/task-report-excel";
import { useConfirm } from "#/components/modules/task-close/use-confirm";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { TableResizeHandle } from "#/components/ui/table-resize-handle";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError, trpcErrorCode } from "#/lib/api/error";
import { stableJson } from "#/lib/task/json";
import {
	asFormValue,
	asTableValue,
	pasteReportGrid,
	reportRowsOf,
	type TaskReportSchema,
	updateKeyedItem,
	validateTaskReport,
} from "#/lib/task/report-spec";

import { cn } from "#/lib/utils";

/** 填报与说明、自由回复独立，数据和授权都由服务端提供。 */
export function TaskReport({ taskId }: { taskId: string }) {
	const trpc = useTRPC();
	const report = useQuery(trpc.taskClose.reportGet.queryOptions({ taskId }));
	const [reloadKey, setReloadKey] = useState(0);
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
	if (!report.data)
		return (
			<ReportSection>
				<p className="text-sm text-muted-foreground">此任务没有配置填报。</p>
			</ReportSection>
		);
	if (report.data.hasChildren)
		return (
			<TaskReportComposed
				taskId={taskId}
				data={report.data}
				onReload={async () => {
					await report.refetch();
					setReloadKey((key) => key + 1);
				}}
				reloadKey={reloadKey}
			/>
		);
	return (
		<TaskReportEditor
			key={`${report.data.report.id}:${report.data.template.id}:${reloadKey}`}
			taskId={taskId}
			schema={report.data.template.schema}
			data={report.data}
			onReload={async () => {
				await report.refetch();
				setReloadKey((key) => key + 1);
			}}
		/>
	);
}

/**
 * 父任务填报 —— 两块**常显、没有开关**:**子任务结构化填报汇总**在上,**母版**在下(母版可直接编辑)。
 *
 * 组合行是**读时拼出来的**,不落表。数组字段**不占列**:换行 + 缩进挂在行下面单独渲染 ——
 * 放进列里会把整列撑得很宽,内容反而看不见。
 */
function TaskReportComposed({
	taskId,
	data,
	onReload,
	reloadKey,
}: {
	taskId: string;
	data: ReportData;
	/** 母版编辑器冲突后的「重新载入」 */
	onReload: () => Promise<void>;
	reloadKey: number;
}) {
	const schema = data.template.schema;
	const scalarFields = schema.fields.filter((field) => field.type !== "array");
	const arrayFields = schema.fields.filter((field) => field.type === "array");
	const owned = data.composed.filter((entry) => entry.owner);
	const master = data.composed.filter((entry) => !entry.owner);
	return (
		<>
			<ReportSection
				title="子任务结构化填报汇总"
				actions={<TaskReportExcel taskId={taskId} schema={schema} canEdit={false} />}
			>
				{owned.length === 0 ? (
					<p className="text-sm text-muted-foreground">还没有子任务提交填报。</p>
				) : (
					<ComposedTable
						taskId={taskId}
						scalarFields={scalarFields}
						arrayFields={arrayFields}
						rows={owned}
						files={data.files}
						showOwner
					/>
				)}
			</ReportSection>
			{data.canEdit ? (
				<TaskReportEditor
					key={`master:${data.report.id}:${data.template.id}:${reloadKey}`}
					sectionTitle="母版"
					note="这是母版,可直接改;保存会按各子任务的范围重新下发一份草稿(覆盖他们尚未提交的编辑)。"
					taskId={taskId}
					schema={schema}
					data={data}
					onReload={onReload}
				/>
			) : (
				<ReportSection title="母版">
					{master.length === 0 ? (
						<p className="text-sm text-muted-foreground">母版行已全部由子任务认领。</p>
					) : (
						<ComposedTable
							taskId={taskId}
							scalarFields={scalarFields}
							arrayFields={arrayFields}
							rows={master}
							files={data.files}
							showOwner={false}
						/>
					)}
				</ReportSection>
			)}
		</>
	);
}

/** 组合视图的一张只读表:标量字段成列,数组字段换行 + 缩进挂在行下面。 */
function ComposedTable({
	taskId,
	scalarFields,
	arrayFields,
	rows,
	files,
	showOwner,
}: {
	taskId: string;
	scalarFields: ReportData["template"]["schema"]["fields"];
	arrayFields: ReportData["template"]["schema"]["fields"];
	rows: ReportData["composed"];
	files: ReportData["files"];
	showOwner: boolean;
}) {
	const columnCount = scalarFields.length + (showOwner ? 1 : 0);
	return (
		<div className="min-w-0 overflow-x-auto">
			<table className="w-full border-collapse text-left text-sm">
				<thead>
					<tr className="border-b border-border text-xs text-muted-foreground">
						{showOwner ? (
							<th scope="col" className="w-28 whitespace-nowrap px-2 py-1 font-normal">
								执行人
							</th>
						) : null}
						{scalarFields.map((field) => (
							<th key={field.id} scope="col" className={cn(fieldColWidth(field), "px-2 py-1 font-normal")}>
								{field.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{rows.map((entry, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: 组合行是读时派生、没有稳定 id;只读展示,顺序即身份
						<Fragment key={`${entry.owner ?? "own"}-${index}`}>
							<tr className="align-top">
								{showOwner ? (
									<td className="whitespace-nowrap px-2 py-1 text-xs text-muted-foreground">
										{entry.owner ? `由 ${entry.ownerName ?? "执行人"} 填报` : "母版"}
									</td>
								) : null}
								{scalarFields.map((field) => (
									<td key={field.id} className="px-2 py-1 break-words">
										<ReportValueView taskId={taskId} field={field} value={entry.row[field.id] as Value} files={files} />
									</td>
								))}
							</tr>
							{arrayFields.length > 0 ? (
								<tr>
									<td colSpan={columnCount} className="px-2 pb-2">
										<div className="grid gap-3 pl-6">
											{arrayFields.map((field) => (
												<div key={field.id} className="grid gap-1">
													<span className="text-xs text-muted-foreground">{field.label}</span>
													<ReportValueView
														taskId={taskId}
														field={field}
														value={entry.row[field.id] as Value}
														files={files}
													/>
												</div>
											))}
										</div>
									</td>
								</tr>
							) : null}
						</Fragment>
					))}
				</tbody>
			</table>
		</div>
	);
}

function TaskReportEditor({
	taskId,
	schema,
	data,
	onReload,
	sectionTitle,
	note,
}: {
	taskId: string;
	schema: TaskReportSchema;
	data: ReportData;
	/** 冲突后「重新载入」:重新拉服务端版本并重建编辑器(丢弃本地未保存内容) */
	onReload: () => Promise<void>;
	/** 区块标题(默认「结构化填报」;父任务详情里用它标「母版」) */
	sectionTitle?: string;
	/** 标题下的一句说明(母版:保存会重新下发) */
	note?: ReactNode;
}) {
	const trpc = useTRPC();
	const [draft, setDraft] = useState<Row | Row[]>(data.report.draft as Row | Row[]);
	// 删除或异步上传需按行身份定位；按位置复用的 useStableKeys 无法保留删除后的身份。
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
	/** 待确认删除的数据行 —— 用 rowKey 而不是下标,避免确认期间数据变化误删别的行 */
	const del = useConfirm<{ key: string; index: number }>();
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
				if (stableJson(draftRef.current) === stableJson(variables.draft)) setDirty(false);
			},
			onError: (error) => {
				if (trpcErrorCode(error) === "CONFLICT") {
					setConflicted(true);
					toast.error("填报已被他人修改，本地内容尚未保存；可复制后「重新载入」。");
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
			const found = reportRowsOf(schema, draft).length === 0 ? [] : validateTaskReport(schema, draft);
			setIssues(found);
			if (found.length > 0) return;
			save.mutate({ taskId, revision, draft });
		}, 600);
		return () => window.clearTimeout(timer);
	}, [dirty, conflicted, saveFailed, save.isPending, data.canEdit, taskId, revision, draft, save.mutate, schema]);
	const rows = reportRowsOf(schema, draft) as Row[];
	const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
	const currentPage = Math.min(page, totalPages);
	const pageStart = (currentPage - 1) * pageSize;
	const pageRows = rows.slice(pageStart, pageStart + pageSize);
	/** 这个格子有没有被校验点名 —— 有就把输入框标红,不用人对着下面的清单逐条找 */
	const invalidOf = (row: number, field: string) =>
		issues.some((issue) => issue.field === field && (issue.row === null || issue.row === row));
	/**
	 * 改一格。用 `setDraft(prev => …)` 的**函数式**更新:`value` 可能是异步拿到的
	 * (附件上传要几秒),写回时必须基于**当时最新的草稿**,而不是发起时的快照 ——
	 * 否则上传期间别人(或用户自己)对同一行数组的新增 / 删除会被这次写回抹掉。
	 */
	const update = (index: number, field: string, value: Value, generation: number, rowKey?: string) => {
		if (generation !== generationRef.current || (rowKey && !rowKeysRef.current.includes(rowKey))) return;
		const keys = rowKeysRef.current;
		setDraft((prev) => {
			const current = reportRowsOf(schema, prev) as Row[];
			const next = rowKey
				? updateKeyedItem(current, keys, rowKey, (row) => ({ ...row, [field]: value }))
				: current.map((row, i) => (i === index ? { ...row, [field]: value } : row));
			return schema.kind === "TABLE" ? asTableValue(next) : asFormValue(next);
		});
		markDirty();
		setIssues([]);
	};
	/** 手动「提交」= 把子任务当前填报复制成父任务可见的那一版(不改 revision)。 */
	const sync = useMutation(
		trpc.taskClose.reportSubmitToParent.mutationOptions({
			onSuccess: () => toast.success("已提交给父任务"),
			onError: toastApiError,
		}),
	);
	/** 手动「保存」:把防抖里那一次立刻落库(父任务只读组合视图,没有保存按钮) */
	const saveNow = async () => {
		if (conflicted || saveFailed) {
			toast.error("上次保存未成功,请先按提示处理");
			return;
		}
		const found = reportRowsOf(schema, draft).length === 0 ? [] : validateTaskReport(schema, draft);
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
	const busy = sync.isPending;
	return (
		<ReportSection
			title={sectionTitle}
			actions={
				<div className="flex items-center">
					{data.canEdit ? (
						data.canSubmitToParent ? (
							<Button
								variant="ghost"
								size="sm"
								disabled={busy || save.isPending || dirty || conflicted}
								onClick={() => sync.mutate({ taskId })}
							>
								<CloudUpload className="size-3.5" />
								{sync.isPending ? "提交中…" : "提交给父任务"}
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
			{note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
			{conflicted && (
				<div role="alert" className="flex items-center gap-2 text-sm text-destructive">
					填报已被他人修改，本地内容尚未保存。
					<Button variant="outline" size="sm" disabled={save.isPending} onClick={() => void onReload()}>
						重新载入
					</Button>
				</div>
			)}
			<del.Dialog
				title={`删除第 ${(del.target?.index ?? 0) + 1} 行`}
				description={() => "这一行会从当前填报草稿中移除；自动保存后无法撤销。"}
				onConfirm={(t) => {
					const index = rowKeysRef.current.indexOf(t.key);
					if (index >= 0) {
						setDraft((prev) => (Array.isArray(prev) ? prev.filter((_, i) => i !== index) : prev));
						replaceRowKeys(rowKeysRef.current.filter((_, i) => i !== index));
						markDirty();
					}
					del.dismiss();
				}}
			/>
			<div className="grid gap-4">
				{schema.kind === "TABLE" ? <p className="text-sm text-muted-foreground">共 {rows.length} 条数据</p> : null}
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
														// 函数式更新:粘贴期间的其他改动(并发)不会被这次写回抹掉
														setDraft((prev) =>
															pasteReportGrid(schema, Array.isArray(prev) ? (prev as Row[]) : [], index, column, text),
														);
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
														onClick={() => del.ask({ key: rowKey, index })}
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
