import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { MultiSelect } from "#/components/modules/shared/multi-select";
import { TaskActionDialog } from "#/components/modules/task-close/task-action-dialog";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { SearchSelect } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { partitionReportRows, type ReportDistributionValue } from "#/lib/task-report-distribution";
import { downloadReportWorkbook } from "#/lib/task-report-download";
import { taskReportSchema } from "#/lib/task-report-spec";
import type { TaskReportSummaryOptions } from "#/lib/task-report-summary";
import { formatLocalMinute } from "#/lib/time";

function formatConditionValue(value: ReportDistributionValue): string {
	if (value === null) return "空值";
	if (value === "") return "空字符串";
	if (typeof value === "boolean") return value ? "是" : "否";
	return String(value);
}

export function TaskReportBatchDialog({
	source,
	disabled = false,
}: {
	source?: { taskId: string; taskName: string; versionId: string };
	disabled?: boolean;
} = {}) {
	const trpc = useTRPC();
	const { user } = useRouteContext({ from: "/(main)" });
	const client = useQueryClient();
	const [open, setOpen] = useState(false);
	const [creating, setCreating] = useState(false);
	const [selected, setSelected] = useState("");
	const [name, setName] = useState("");
	const [workflowId, setWorkflowId] = useState("");
	const [versionId, setVersionId] = useState("");
	const [targets, setTargets] = useState<string[]>([]);
	const [sourceTaskId, setSourceTaskId] = useState("");
	const [sourceKeyword, setSourceKeyword] = useState("");
	const [distributionField, setDistributionField] = useState("");
	const [distributionValues, setDistributionValues] = useState<Record<string, string>>({});
	const [distributionFieldsByUser, setDistributionFieldsByUser] = useState<Record<string, string>>({});
	const [due, setDue] = useState("");
	const [requestId, setRequestId] = useState("");
	const [confirmClose, setConfirmClose] = useState(false);
	const [strategy, setStrategy] = useState<"APPEND_ROWS" | "MERGE_BY_KEY" | "AGGREGATE">("APPEND_ROWS");
	const [keyField, setKeyField] = useState("");
	const [metricField, setMetricField] = useState("");
	const [operation, setOperation] = useState<"sum" | "count" | "average">("sum");
	const [page, setPage] = useState(1);
	const batches = useQuery({ ...trpc.taskClose.reportBatchList.queryOptions(), enabled: open });
	const templates = useQuery({ ...trpc.taskClose.reportTemplateList.queryOptions(), enabled: open || creating });
	const sourceTasks = useQuery({
		...trpc.taskClose.taskList.queryOptions({
			mine: true,
			keyword: sourceKeyword.trim() || undefined,
			page: 1,
			pageSize: 100,
		}),
		enabled: creating,
	});
	const sourceReport = useQuery({
		...trpc.taskClose.reportGet.queryOptions({ taskId: sourceTaskId }),
		enabled: creating && !!sourceTaskId,
		staleTime: 0,
		refetchOnMount: "always",
	});
	const workflows = useQuery({ ...trpc.taskClose.workflowList.queryOptions(), enabled: creating });
	const users = useQuery({ ...trpc.user.list.queryOptions(), enabled: open || creating });
	const batch = useQuery({
		...trpc.taskClose.reportBatchGet.queryOptions({ id: selected }),
		enabled: open && !!selected,
	});
	const options: TaskReportSummaryOptions =
		strategy === "APPEND_ROWS"
			? { strategy }
			: strategy === "MERGE_BY_KEY"
				? { strategy, keys: [keyField] }
				: { strategy, keys: keyField ? [keyField] : [], metrics: [{ field: metricField, operation }] };
	const ready = strategy === "APPEND_ROWS" || (strategy === "MERGE_BY_KEY" ? !!keyField : !!metricField);
	const summary = useQuery({
		...trpc.taskClose.reportBatchSummary.queryOptions({ id: selected, page, pageSize: 20, options }),
		enabled: open && !!selected && ready,
	});
	const invalidate = () => client.invalidateQueries(trpc.taskClose.pathFilter());
	const create = useMutation(
		trpc.taskClose.reportBatchCreate.mutationOptions({
			onSuccess: (result) => {
				setCreating(false);
				setOpen(true);
				setSelected(result.id);
				void invalidate();
				toast.success("批次已创建");
			},
			onError: (error) => {
				toastApiError(error);
				if (sourceTaskId) void client.invalidateQueries(trpc.taskClose.reportGet.queryFilter({ taskId: sourceTaskId }));
			},
		}),
	);
	const close = useMutation(
		trpc.taskClose.reportBatchClose.mutationOptions({
			onSuccess: () => {
				setConfirmClose(false);
				void invalidate();
				toast.success("批次已关闭");
			},
			onError: toastApiError,
		}),
	);
	const exportSummary = useMutation(
		trpc.taskClose.reportBatchExcelExport.mutationOptions({
			onSuccess: (result) => downloadReportWorkbook(result.fileBase64, "填报汇总.xlsx"),
			onError: toastApiError,
		}),
	);
	const userOptions = (users.data ?? [])
		.filter((item) => item.id !== user.id)
		.map((item) => ({ value: item.id, label: item.name }));
	const templateOptions = (templates.data ?? []).flatMap((template) =>
		template.versions.map((version) => ({
			value: version.id,
			label: `${template.name} · v${version.version}`,
			schema: version.schema,
		})),
	);
	const schema = taskReportSchema.safeParse(
		templateOptions.find((item) => item.value === batch.data?.batch.version_id)?.schema,
	);
	const fields = schema.success ? schema.data.fields : [];
	const fieldOptions = fields.map((field) => ({ value: field.id, label: field.label }));
	const numberOptions = fields
		.filter((field) => field.type === "integer" || field.type === "decimal")
		.map((field) => ({ value: field.id, label: field.label }));
	const sourceSchema = taskReportSchema.safeParse(sourceReport.data?.version.schema);
	const sourceRows = Array.isArray(sourceReport.data?.report.draft) ? sourceReport.data.report.draft : [];
	const distributionFields =
		sourceSchema.success && sourceSchema.data.kind === "TABLE"
			? sourceSchema.data.fields.filter((field) => field.type !== "multiselect")
			: [];
	const valuesByField = new Map<string, Map<string, number>>();
	const valuesFor = (fieldId: string) => {
		let counts = valuesByField.get(fieldId);
		if (!counts) {
			counts = new Map();
			for (const row of sourceRows) {
				const value =
					row && typeof row === "object" && !Array.isArray(row)
						? ((row as Record<string, unknown>)[fieldId] ?? null)
						: null;
				if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
					const key = JSON.stringify(value);
					counts.set(key, (counts.get(key) ?? 0) + 1);
				}
			}
			valuesByField.set(fieldId, counts);
		}
		return counts;
	};
	const matchingVersion = !sourceTaskId || sourceReport.data?.version.id === versionId;
	const conditions = targets.flatMap((userId) => {
		const field = distributionFieldsByUser[userId] || distributionField;
		const value = distributionValues[userId];
		return field && value !== undefined && valuesFor(field).has(value)
			? [{ userId, field, value: JSON.parse(value) as ReportDistributionValue }]
			: [];
	});
	const partition = partitionReportRows(sourceRows, conditions);
	const unassignedRows = partition.unassigned.length;
	const overlappingRows = partition.overlapping.length;
	const emptyUsers = [...partition.byUser].filter(([, rows]) => rows.length === 0).map(([userId]) => userId);
	const distributionReady =
		!sourceTaskId ||
		(!sourceReport.isFetching &&
			matchingVersion &&
			sourceRows.length > 0 &&
			conditions.length === targets.length &&
			unassignedRows === 0 &&
			overlappingRows === 0 &&
			emptyUsers.length === 0);
	const sourceOptions = (sourceTasks.data?.items ?? []).map((task) => ({ value: task.id, label: task.name }));
	if (source && !sourceOptions.some((option) => option.value === source.taskId))
		sourceOptions.unshift({ value: source.taskId, label: source.taskName });
	const showName = (id: string) => userOptions.find((item) => item.value === id)?.label ?? id;
	const openCreate = () => {
		setName(source ? `${source.taskName.slice(0, 240)} · 填报` : "");
		setWorkflowId("");
		setVersionId(source?.versionId ?? "");
		setTargets([]);
		setSourceTaskId(source?.taskId ?? "");
		setSourceKeyword("");
		setDistributionField("");
		setDistributionValues({});
		setDistributionFieldsByUser({});
		setDue("");
		setRequestId(crypto.randomUUID());
		setCreating(true);
	};
	return (
		<>
			<Button
				variant="outline"
				size={source ? "sm" : "default"}
				disabled={disabled}
				onClick={() => (source ? openCreate() : setOpen(true))}
			>
				{source ? "按条件分发" : "填报批次"}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
					<DialogHeader>
						<DialogTitle>填报批次</DialogTitle>
						<DialogDescription>
							查看各批次的任务进度与有效提交汇总(管理员看得到全部,其他人只看自己发起的)。
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="space-y-5">
						<div className="flex flex-wrap items-center gap-2">
							<Select
								items={(batches.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
								value={selected}
								onValueChange={(value) => {
									setSelected(value ?? "");
									setPage(1);
									setStrategy("APPEND_ROWS");
									setKeyField("");
									setMetricField("");
								}}
							>
								<SelectTrigger className="w-64" aria-label="选择批次">
									<SelectValue placeholder="选择批次" />
								</SelectTrigger>
								<SelectContent>
									{(batches.data ?? []).map((item) => (
										<SelectItem key={item.id} value={item.id}>
											{item.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								size="sm"
								onClick={() => {
									setOpen(false);
									openCreate();
								}}
							>
								新建批次
							</Button>
						</div>
						{batch.data && (
							<>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="text-sm text-muted-foreground">
										{batch.data.batch.status !== "open" ? "已关闭" : batch.data.expired ? "已过截止" : "进行中"} ·
										截止：
										{batch.data.batch.due_at ? formatLocalMinute(batch.data.batch.due_at) : "未设置"} · 已提交{" "}
										{batch.data.tasks.filter((task) => task.reportStatus === "submitted" && !task.deletedAt).length}/
										{batch.data.tasks.length}
									</p>
									{batch.data.batch.status === "open" && (
										<Button variant="outline" size="sm" onClick={() => setConfirmClose(true)}>
											关闭批次
										</Button>
									)}
								</div>
								<section className="grid gap-2">
									<h3 className="font-medium">任务进度</h3>
									<div className="divide-y divide-border rounded-md border border-border">
										{batch.data.tasks.map((task) => (
											<div key={task.taskId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
												<span>
													{task.executorId ? showName(task.executorId) : "未分配"} ·{" "}
													{task.deletedAt
														? "任务已删除"
														: task.reportStatus === "submitted"
															? "已提交"
															: task.reportStatus === "returned"
																? "已退回"
																: "待提交"}
													{task.executorId !== task.targetUserId && (
														<span className="text-muted-foreground">（原指派：{showName(task.targetUserId)}）</span>
													)}
													{task.distribution && (
														<span className="block break-all text-xs text-muted-foreground">
															初始范围：{task.distribution.fieldLabel} = {formatConditionValue(task.distribution.value)}{" "}
															· {task.distribution.rowCount} 行
														</span>
													)}
												</span>
												{!task.deletedAt && (
													<Link
														to="/task-close/$taskId"
														params={{ taskId: task.taskId }}
														className="text-primary hover:underline"
														onClick={() => setOpen(false)}
													>
														查看任务
													</Link>
												)}
											</div>
										))}
									</div>
								</section>
								<section className="grid gap-3">
									<div className="flex items-center justify-between">
										<h3 className="font-medium">有效提交汇总</h3>
										<Button
											size="sm"
											variant="outline"
											disabled={!ready || exportSummary.isPending}
											onClick={() => exportSummary.mutate({ id: selected, options })}
										>
											导出汇总
										</Button>
									</div>
									<div className="flex flex-wrap gap-2">
										<Select
											items={[
												{ value: "APPEND_ROWS", label: "按行追加" },
												{ value: "MERGE_BY_KEY", label: "按业务键合并" },
												{ value: "AGGREGATE", label: "数值汇总" },
											]}
											value={strategy}
											onValueChange={(value) => {
												setStrategy(value === "MERGE_BY_KEY" || value === "AGGREGATE" ? value : "APPEND_ROWS");
												setPage(1);
											}}
										>
											<SelectTrigger className="w-40" aria-label="汇总方式">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="APPEND_ROWS">按行追加</SelectItem>
												<SelectItem value="MERGE_BY_KEY">按业务键合并</SelectItem>
												<SelectItem value="AGGREGATE">数值汇总</SelectItem>
											</SelectContent>
										</Select>
										{strategy !== "APPEND_ROWS" && (
											<Select
												items={fieldOptions}
												value={keyField}
												onValueChange={(value) => {
													setKeyField(value ?? "");
													setPage(1);
												}}
											>
												<SelectTrigger className="w-40" aria-label="业务键">
													<SelectValue placeholder={strategy === "AGGREGATE" ? "分组字段（可选）" : "业务键"} />
												</SelectTrigger>
												<SelectContent>
													{fieldOptions.map((field) => (
														<SelectItem key={field.value} value={field.value}>
															{field.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
										{strategy === "AGGREGATE" && (
											<>
												<Select
													items={numberOptions}
													value={metricField}
													onValueChange={(value) => {
														setMetricField(value ?? "");
														setPage(1);
													}}
												>
													<SelectTrigger className="w-40" aria-label="数值字段">
														<SelectValue placeholder="数值字段" />
													</SelectTrigger>
													<SelectContent>
														{numberOptions.map((field) => (
															<SelectItem key={field.value} value={field.value}>
																{field.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<Select
													items={[
														{ value: "sum", label: "求和" },
														{ value: "count", label: "计数" },
														{ value: "average", label: "平均" },
													]}
													value={operation}
													onValueChange={(value) =>
														setOperation(value === "count" || value === "average" ? value : "sum")
													}
												>
													<SelectTrigger className="w-28" aria-label="聚合方式">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="sum">求和</SelectItem>
														<SelectItem value="count">计数</SelectItem>
														<SelectItem value="average">平均</SelectItem>
													</SelectContent>
												</Select>
											</>
										)}
									</div>
									{summary.isError && <p className="text-sm text-destructive">汇总加载失败，请检查字段配置。</p>}
									{summary.data && (
										<>
											<p className="text-sm text-muted-foreground">
												共 {summary.data.total} 行，{summary.data.conflicts.length} 个冲突
											</p>
											{summary.data.conflicts.map((conflict) => (
												<p
													key={`${conflict.first.submissionId}-${conflict.first.rowIndex}-${conflict.other.submissionId}-${conflict.other.rowIndex}-${conflict.field}`}
													className="text-sm text-destructive"
												>
													{conflict.field}：{conflict.message}（{showName(conflict.first.executorId)} /{" "}
													{showName(conflict.other.executorId)}）
												</p>
											))}
											<div className="divide-y divide-border rounded-md border border-border">
												{summary.data.rows.map((row) => (
													<div
														key={row.sources.map((source) => `${source.submissionId}-${source.rowIndex}`).join("_")}
														className="grid gap-1 p-3 text-sm"
													>
														<p>
															{Object.entries(row.values)
																.map(
																	([key, value]) =>
																		`${fields.find((field) => field.id === key)?.label ?? key}：${Array.isArray(value) ? value.join("、") : String(value ?? PLACEHOLDER_EMPTY)}`,
																)
																.join(" · ")}
														</p>
														<p className="text-xs text-muted-foreground">
															来源：
															{row.sources
																.map((source) => `${showName(source.executorId)} / 第 ${source.rowIndex + 1} 行`)
																.join("、")}
														</p>
													</div>
												))}
											</div>
											<div className="flex items-center gap-2">
												<Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
													上一页
												</Button>
												<span className="text-sm">第 {page} 页</span>
												<Button
													size="sm"
													variant="outline"
													disabled={page * 20 >= summary.data.total}
													onClick={() => setPage(page + 1)}
												>
													下一页
												</Button>
											</div>
										</>
									)}
								</section>
							</>
						)}
					</DialogBody>
				</DialogContent>
			</Dialog>
			<TaskActionDialog
				open={creating}
				onOpenChange={setCreating}
				title="新建填报批次"
				description="每位执行人各生成一条独立任务；超时或关闭后不再接受新提交。"
				pending={create.isPending}
				confirmDisabled={!name.trim() || !workflowId || !versionId || !targets.length || !distributionReady}
				confirmText="创建批次"
				pendingText="创建中…"
				onConfirm={() =>
					create.mutate({
						requestId,
						name: name.trim(),
						workflowId,
						versionId,
						targetUserIds: targets,
						distribution: sourceTaskId
							? {
									sourceTaskId,
									sourceRevision: sourceReport.data?.report.revision ?? 0,
									field: distributionField,
									assignments: conditions,
								}
							: undefined,
						dueAt: due ? new Date(due).toISOString() : null,
					})
				}
			>
				<DetailRow label="批次名称">
					<Input aria-label="批次名称" value={name} onChange={(event) => setName(event.target.value)} />
				</DetailRow>
				<DetailRow label="任务流程">
					<Select
						items={(workflows.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
						value={workflowId}
						onValueChange={(value) => setWorkflowId(value ?? "")}
					>
						<SelectTrigger aria-label="任务流程">
							<SelectValue placeholder="选择流程" />
						</SelectTrigger>
						<SelectContent>
							{(workflows.data ?? []).map((item) => (
								<SelectItem key={item.id} value={item.id}>
									{item.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</DetailRow>
				<DetailRow label="填报模板">
					<Select items={templateOptions} value={versionId} onValueChange={(value) => setVersionId(value ?? "")}>
						<SelectTrigger aria-label="填报模板">
							<SelectValue placeholder="选择模板版本" />
						</SelectTrigger>
						<SelectContent>
							{templateOptions.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</DetailRow>
				<DetailRow label="源任务数据">
					<div className="grid gap-2">
						<Input
							aria-label="搜索源任务"
							placeholder="按任务名称搜索"
							value={sourceKeyword}
							onChange={(event) => setSourceKeyword(event.target.value)}
						/>
						<SearchSelect
							label="源任务"
							value={sourceTaskId}
							onValueChange={(value) => {
								setSourceTaskId(value);
								setDistributionField("");
								setDistributionValues({});
								setDistributionFieldsByUser({});
							}}
							options={sourceOptions}
							placeholder="可选：选择已填好数据的任务"
						/>
						{sourceTaskId && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setSourceTaskId("");
									setDistributionField("");
									setDistributionValues({});
									setDistributionFieldsByUser({});
								}}
							>
								清除源任务
							</Button>
						)}
						{(sourceTasks.data?.total ?? 0) > 100 && (
							<p className="text-sm text-muted-foreground">结果超过 100 条，请输入更具体的任务名称。</p>
						)}
						{sourceTaskId && sourceReport.isFetching && (
							<p className="text-sm text-muted-foreground">正在读取源任务…</p>
						)}
						{sourceTaskId && sourceReport.isError && (
							<p role="alert" className="text-sm text-destructive">
								无法读取源任务填报，请选择有权访问的任务。
							</p>
						)}
						{sourceTaskId && !sourceReport.isFetching && !sourceReport.isError && !matchingVersion && (
							<p className="text-sm text-destructive">源任务必须使用所选的表格模板版本。</p>
						)}
						{sourceTaskId && !sourceReport.isFetching && !sourceReport.isError && matchingVersion && (
							<p className="text-sm text-muted-foreground">
								源数据 {sourceRows.length} 行。选择默认字段，再为每位执行人设置字段和值；所有行必须且只能分配一次。
							</p>
						)}
						{sourceTaskId && !sourceReport.isFetching && !sourceReport.isError && matchingVersion && (
							<Select
								items={distributionFields.map((field) => ({ value: field.id, label: field.label }))}
								value={distributionField}
								onValueChange={(value) => {
									setDistributionField(value ?? "");
									setDistributionValues({});
									setDistributionFieldsByUser({});
								}}
							>
								<SelectTrigger aria-label="默认筛选字段">
									<SelectValue placeholder="选择划分字段" />
								</SelectTrigger>
								<SelectContent>
									{distributionFields.map((field) => (
										<SelectItem key={field.id} value={field.id}>
											{field.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>
				</DetailRow>

				<DetailRow label="执行人">
					<div className="grid gap-2">
						<MultiSelect
							options={userOptions}
							value={targets}
							onChange={(next) => {
								if (next.length > 100) {
									toast.error("最多选择 100 位执行人");
									return;
								}
								setTargets(next);
							}}
							placeholder="搜索执行人"
							maxHeight={120}
						/>

						{sourceTaskId &&
							distributionField &&
							targets.map((id) => {
								const field = distributionFieldsByUser[id] || distributionField;
								const values = [...valuesFor(field)];
								return (
									<div key={id} className="grid min-w-0 grid-cols-2 gap-2 border-t border-border pt-2">
										<span className="col-span-2 break-words text-sm font-medium">{showName(id)}</span>
										<Select
											items={distributionFields.map((item) => ({ value: item.id, label: item.label }))}
											value={field}
											onValueChange={(value) => {
												setDistributionFieldsByUser((current) => ({ ...current, [id]: value ?? "" }));
												setDistributionValues((current) => {
													const next = { ...current };
													delete next[id];
													return next;
												});
											}}
										>
											<SelectTrigger className="w-full min-w-0" aria-label={`${showName(id)}的筛选字段`}>
												<SelectValue placeholder="选择字段" />
											</SelectTrigger>
											<SelectContent>
												{distributionFields.map((item) => (
													<SelectItem key={item.id} value={item.id}>
														{item.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<Select
											items={values.map(([value]) => ({
												value,
												label: formatConditionValue(JSON.parse(value) as ReportDistributionValue),
											}))}
											value={distributionValues[id] ?? ""}
											onValueChange={(value) => setDistributionValues((current) => ({ ...current, [id]: value ?? "" }))}
										>
											<SelectTrigger className="w-full min-w-0" aria-label={`${showName(id)}的数据范围`}>
												<SelectValue placeholder="选择等于的值" />
											</SelectTrigger>
											<SelectContent>
												{values.map(([value, count]) => (
													<SelectItem key={value} value={value}>
														{formatConditionValue(JSON.parse(value) as ReportDistributionValue)}（{count} 行）
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								);
							})}
					</div>
				</DetailRow>
				{sourceTaskId && distributionField && (
					<div className="space-y-1 text-sm" aria-live="polite">
						<p className="text-muted-foreground">
							已配置 {conditions.length} / {targets.length} 位执行人的条件，{unassignedRows} 行未分配，{overlappingRows}{" "}
							行重复命中。
						</p>
						{overlappingRows > 0 && (
							<p className="text-destructive">部分数据同时命中多个条件，请调整以确保每行只分配一次。</p>
						)}
						{unassignedRows > 0 && <p className="text-destructive">请为所有数据行分配执行人。</p>}
						{unassignedRows === 0 && overlappingRows === 0 && emptyUsers.length > 0 && (
							<p className="text-destructive">{emptyUsers.map(showName).join("、")}没有匹配的数据行。</p>
						)}
					</div>
				)}
				<DetailRow label="截止时间">
					<Input
						aria-label="截止时间"
						type="datetime-local"
						value={due}
						onChange={(event) => setDue(event.target.value)}
					/>
				</DetailRow>
			</TaskActionDialog>
			<ConfirmDialog
				open={confirmClose}
				onOpenChange={setConfirmClose}
				title="关闭批次"
				description="关闭后不再接受新的正式提交，已有提交保留。"
				confirmText="关闭批次"
				pendingText="关闭中…"
				isPending={close.isPending}
				onConfirm={() => close.mutate({ id: selected })}
			/>
		</>
	);
}
