import { useQuery } from "@tanstack/react-query";
import { ChevronDown, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MultiSelect } from "#/components/modules/shared/multi-select";
import { TaskAttachmentPicker } from "#/components/modules/task-close/task-content-attachments";
import { TaskLinkEditor } from "#/components/modules/task-close/task-link-editor";
import { TaskReportExcel } from "#/components/modules/task-close/task-report-excel";
import { ActionIconButton } from "#/components/ui/action-button";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { DatePicker } from "#/components/ui/date-picker";
import { DetailRow } from "#/components/ui/detail-row";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import type { SearchSelectOption } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { useTRPC } from "#/integrations/trpc/react";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskPriority } from "#/lib/task-close-spec";
import type { TaskAttachment, TaskLinkBlock } from "#/lib/task-payload";
import { taskReportSchema } from "#/lib/task-report-spec";
import { formatLocalDate } from "#/lib/time";

/** ISO → 本地 `YYYY-MM-DD`(日期选择器只认这个形状;空值回空串) */
function toDateInput(iso: string | null | undefined): string {
	return iso ? formatLocalDate(iso) : "";
}

/** 本地 `YYYY-MM-DD` → ISO(按本地 0 点算,避免 `new Date("YYYY-MM-DD")` 当 UTC 差一天) */
function fromDateInput(date: string): string | null {
	return date ? new Date(`${date}T00:00:00`).toISOString() : null;
}

/** 优先级 Select 的固定选项 —— 「未设置」(null)放最前,允许保留旧值不变 */
const PRIORITY_OPTIONS: { value: TaskPriority | null; label: string }[] = [
	{ value: null, label: "未设置" },
	...TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_LABEL[value] })),
];

/** 编辑态回填 —— 模板与成员是建任务时定的,之后各有自己的接口;链接 / 附件随任务本身走 */
export type TaskFormEditing = {
	id: string;
	name: string;
	description: string | null;
	dueAt: string | null;
	/** `0|1|2|null` —— 服务端的 `tinyint(1)` 读出来是 number,严格档位不在这里断,在 server zod 上校验 */
	priority: number | null;
	links: TaskLinkBlock[];
	attachments: TaskAttachment[];
};

export type TaskFormPayload = {
	name: string;
	description: string | null;
	dueAt: string | null;
	/** 提交时:`null` = 没选,`0|1|2` = 选定档;接口上 `undefined` 表示「不动旧值」,**这里**总是显式传值 */
	priority: number | null;
	workflowId: string;
	/** 绑定填报模板;`rows` = 文件导入带进来的初始行 */
	report: {
		reportId: string;
		rows?: Array<Record<string, string | number | boolean | string[] | null>>;
	} | null;
	/** 数据规则(仅表格模板):过滤条件组(AND),决定本任务看到源数据的哪些行 */
	reportFilter: Array<{ field: string; value: string | number | boolean | null }>;
	/** 执行人(可多选:多个 = 每人各下发一条子任务)+ 各自的数据范围(空数组 = 全部数据) */
	executors: Array<{ userId: string; filter: Array<{ field: string; value: string | number | boolean | null }> }>;
	links: TaskLinkBlock[];
	/** 附件 id 列表(`sys_file.id`) */
	attachments: string[];
};

type Option = SearchSelectOption<string>;

/**
 * 新建 / 编辑任务。
 *
 * 新建:`taskCreate`(选模板 + 选执行人,可多选 —— 多人时各下发一条子任务);编辑:`taskUpdate`(只改名称 / 描述 / 截止 / 优先级)。
 * **一件事一个接口**,所以这里也按模式分派,不做「一个提交按钮打两个接口」。
 */
export function TaskCloseForm({
	open,
	onOpenChange,
	pending,
	editing,
	workflowOptions,
	userOptions,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	pending: boolean;
	/** 非空 = 编辑态 */
	editing: TaskFormEditing | null;
	workflowOptions: Option[];
	userOptions: Option[];
	onSubmit: (payload: TaskFormPayload) => void;
}) {
	const trpc = useTRPC();
	const templates = useQuery({ ...trpc.taskClose.reportTemplateList.queryOptions(), enabled: open && !editing });
	const [reportTemplateId, setReportTemplateId] = useState("");
	/** 带数下发:展开「数据」才配 —— 导入的行 + 各执行人各自的数据范围 */
	const [dataOpen, setDataOpen] = useState(false);
	const [importedRows, setImportedRows] = useState<Array<Record<string, string | number | boolean | string[] | null>>>(
		[],
	);
	/** 数据范围:key = 执行人 id(没选执行人时用 `""` 表示任务本身);不配 = 全部数据 */
	const [rules, setRules] = useState<Record<string, { field: string; value: string }>>({});
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [due, setDue] = useState("");
	/** `null` = 未设置;`0|1|2` = P0/P1/P2。DB 列是 tinyint,运行时是 number */
	const [priority, setPriority] = useState<number | null>(null);
	const [workflowId, setWorkflowId] = useState("");
	const [executorIds, setExecutorIds] = useState<string[]>([]);
	const [links, setLinks] = useState<TaskLinkBlock[]>([]);
	const [attachments, setAttachments] = useState<TaskAttachment[]>([]);

	// 打开时回填;模板缺省取第一个,避免"没选模板点保存"这种可避免的报错
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetReportRule 读写的各 state 都以 open 为闸,只在打开瞬间生效
	useEffect(() => {
		if (!open) return;
		setName(editing?.name ?? "");
		setDescription(editing?.description ?? "");
		setDue(toDateInput(editing?.dueAt));
		setPriority(editing?.priority ?? null);
		setWorkflowId(editing ? "" : (workflowOptions[0]?.value ?? ""));
		setExecutorIds([]);
		setReportTemplateId("");
		resetReportRule();
		setLinks(editing?.links ?? []);
		setAttachments(editing?.attachments ?? []);
	}, [open, editing, workflowOptions]);

	const canSubmit = name.trim().length > 0 && (editing !== null || workflowId.length > 0);

	/** 清空带数下发的全部选择(换模板 / 换来源 / 打开弹窗时) */
	const resetReportRule = () => {
		setDataOpen(false);
		setImportedRows([]);
		setRules({});
	};

	// ── 带数下发(仅表格模板):Excel 模版导入的行 + 过滤条件 ──
	const selectedTemplate = (templates.data ?? []).find((template) => template.id === reportTemplateId);
	const selectedKind = ((selectedTemplate?.payload as { kind?: string } | null)?.kind ?? "OBJECT") as
		| "OBJECT"
		| "TABLE";
	const selectedFields = ((
		selectedTemplate?.payload as { fields?: Array<{ id: string; label: string; type: string }> } | null
	)?.fields ?? []) as Array<{ id: string; label: string; type: string }>;
	const selectedSchema = useMemo(
		() => (selectedTemplate ? taskReportSchema.safeParse(selectedTemplate.payload) : null),
		[selectedTemplate],
	);
	/** 过滤字段(multiselect 不做过滤:值是数组,等值比较没意义) */
	const filterFieldOptions = selectedFields.filter((field) => field.type !== "multiselect");
	/** 一行数据里某字段出现过的值(下拉候选) */
	const valuesOf = (field: string) => {
		const seen = new Map<string, unknown>();
		for (const row of importedRows) {
			const value =
				row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>)[field] : null;
			const key = JSON.stringify(value ?? null);
			if (!seen.has(key)) seen.set(key, value ?? null);
		}
		return [...seen.entries()].map(([key, value]) => ({ value: key, label: String(value ?? "空") }));
	};
	/** 一条规则命中的行数(规则 = field + value 的等值;空规则 = 全部行) */
	const matchedOf = (rule?: { field: string; value: string }) => {
		if (!rule?.field || !rule.value) return importedRows.length;
		const target = JSON.parse(rule.value);
		return importedRows.filter((row) => ((row as Record<string, unknown>)[rule.field] ?? null) === target).length;
	};
	/** 规则的接口形态:一条等值条件 */
	const ruleToFilter = (rule?: { field: string; value: string }) =>
		rule?.field && rule.value
			? [{ field: rule.field, value: JSON.parse(rule.value) as string | number | boolean | null }]
			: [];
	/** 规则挂在谁身上:选了执行人 = 每人一条;没选 = 任务本身 */
	const ruleTargets = executorIds.length
		? executorIds.map((id) => ({ key: id, label: userOptions.find((option) => option.value === id)?.label ?? id }))
		: [{ key: "", label: "本任务" }];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle>{editing ? "编辑任务" : "新建任务"}</DialogTitle>
					<DialogDescription>
						{editing
							? "可改名称 / 描述 / 截止时间 / 优先级;成员与状态走详情页。"
							: "状态从模板的初始状态开始;执行人能发起「改状态」动作。"}
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="space-y-4 py-1">
					<section className="space-y-1">
						<h3 className="mb-1 text-sm font-medium text-foreground">基本信息</h3>
						<DetailRow label="任务名称" htmlFor="tc-name">
							<Input
								id="tc-name"
								className="h-9 text-base sm:h-8 sm:text-sm"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="比如:3 号机组巡检"
							/>
						</DetailRow>

						<DetailRow label="描述" htmlFor="tc-desc">
							<Textarea
								id="tc-desc"
								rows={3}
								className="text-base sm:text-sm"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="补充说明(可空)"
							/>
						</DetailRow>
						{editing ? null : (
							<>
								<DetailRow label="流程模板">
									<Select
										items={workflowOptions}
										value={workflowId || null}
										onValueChange={(next) => setWorkflowId(next ? String(next) : "")}
									>
										<SelectTrigger size="sm" className="w-full">
											<SelectValue placeholder="请选择流程模板" />
										</SelectTrigger>
										<SelectContent>
											{workflowOptions.map((item) => (
												<SelectItem key={item.value} value={item.value}>
													{item.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</DetailRow>
								<DetailRow label="执行人">
									<div className="space-y-1.5">
										<MultiSelect
											options={userOptions}
											value={executorIds}
											onChange={setExecutorIds}
											placeholder="搜索姓名…"
											emptyText="没有匹配的人"
											maxHeight={132}
										/>
										{executorIds.length > 1 ? (
											<Alert variant="warn" title="注意" className="mt-1">
												<span className="inline-flex items-start gap-1.5">
													<TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn-fg" />
													<span>选了 {executorIds.length} 位执行人,会各自下发 1 条任务。</span>
												</span>
											</Alert>
										) : (
											<p className="text-xs text-muted-foreground">可不选,之后再指派。</p>
										)}
									</div>
								</DetailRow>
							</>
						)}
						<DetailRow label="截止时间" htmlFor="tc-due">
							<DatePicker id="tc-due" value={due} onChange={setDue} placeholder="选择日期" />
						</DetailRow>

						<DetailRow label="优先级">
							<Select
								items={PRIORITY_OPTIONS}
								value={priority}
								onValueChange={(next) => {
									// `next` 可能是 `0|1|2` 或在「未设置」分支里被传回 `""`,
									// 统一归到 number | null:空串 / 非 number / 越界 → null
									const raw = next as unknown;
									setPriority(typeof raw === "number" && (raw === 0 || raw === 1 || raw === 2) ? raw : null);
								}}
							>
								<SelectTrigger size="sm" className="w-full">
									<SelectValue placeholder="未设置" />
								</SelectTrigger>
								<SelectContent>
									{PRIORITY_OPTIONS.map((item) => (
										<SelectItem key={String(item.value ?? "null")} value={item.value as unknown as string}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</DetailRow>
					</section>

					{editing ? null : (
						<section className="space-y-1 border-t border-border pt-4">
							<h3 className="mb-1 text-sm font-medium text-foreground">填报区</h3>
							<DetailRow label="填报模板">
								<div className="flex items-center gap-2">
									<Select
										value={reportTemplateId || null}
										onValueChange={(value) => {
											setReportTemplateId(value ?? "");
											resetReportRule();
										}}
										items={(templates.data ?? []).map((template) => ({
											value: template.id,
											label: template.name,
										}))}
									>
										<SelectTrigger className="min-w-48 flex-1" aria-label="填报模板">
											<SelectValue placeholder="不配置填报" />
										</SelectTrigger>
										<SelectContent>
											{(templates.data ?? []).map((template) => (
												<SelectItem key={template.id} value={template.id}>
													{template.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									{reportTemplateId ? (
										<>
											<ActionIconButton
												label="清除填报模板"
												onClick={() => {
													setReportTemplateId("");
													resetReportRule();
												}}
											>
												<X className="size-3.5" />
											</ActionIconButton>
											{selectedKind === "TABLE" ? (
												<ActionIconButton
													label={dataOpen ? "收起数据配置" : "展开数据配置(导入 Excel、按人划范围)"}
													onClick={() => setDataOpen((prev) => !prev)}
												>
													<ChevronDown
														className={`size-3.5 transition-transform duration-150 ease-brand ${dataOpen ? "rotate-180" : ""}`}
													/>
												</ActionIconButton>
											) : null}
										</>
									) : null}
								</div>
							</DetailRow>

							{reportTemplateId && selectedKind === "TABLE" && !dataOpen ? (
								<p className="text-xs text-muted-foreground">点右侧箭头展开数据配置:导入 Excel,并按人划范围。</p>
							) : null}

							{reportTemplateId && selectedKind === "TABLE" && dataOpen ? (
								selectedSchema?.success ? (
									<div className="space-y-2 rounded-lg bg-secondary/40 p-3">
										<TaskReportExcel
											reportId={reportTemplateId}
											schema={selectedSchema.data}
											canEdit
											disabled={false}
											onImport={(value) => {
												setImportedRows((Array.isArray(value) ? value : [value]) as typeof importedRows);
											}}
										/>
										{importedRows.length > 0 && filterFieldOptions.length > 0 ? (
											<div className="space-y-1.5 border-t border-border pt-2">
												<p className="text-xs text-muted-foreground">
													数据范围 —— 不配就是全部 {importedRows.length} 行
												</p>
												{ruleTargets.map((target) => {
													const rule = rules[target.key];
													const values = rule?.field ? valuesOf(rule.field) : [];
													const setRule = (next: { field: string; value: string }) =>
														setRules((prev) => ({ ...prev, [target.key]: next }));
													return (
														<div
															key={target.key || "self"}
															className="grid grid-cols-[5rem_8rem_8rem_minmax(0,1fr)] items-center gap-2"
														>
															<span className="truncate text-xs text-muted-foreground" title={target.label}>
																{target.label}
															</span>
															<Select
																items={filterFieldOptions.map((field) => ({ value: field.id, label: field.label }))}
																value={rule?.field || null}
																onValueChange={(value) => setRule({ field: value ?? "", value: "" })}
															>
																<SelectTrigger size="sm" className="w-full" aria-label={`${target.label} 数据范围字段`}>
																	<SelectValue placeholder="不限字段" />
																</SelectTrigger>
																<SelectContent>
																	{filterFieldOptions.map((field) => (
																		<SelectItem key={field.id} value={field.id}>
																			{field.label}
																		</SelectItem>
																	))}
																</SelectContent>
															</Select>
															<Select
																items={values}
																value={rule?.value || null}
																disabled={!rule?.field}
																onValueChange={(value) => {
																	if (!rule?.field) return;
																	setRule({ field: rule.field, value: value ?? "" });
																}}
															>
																<SelectTrigger size="sm" className="w-full" aria-label={`${target.label} 数据范围值`}>
																	<SelectValue placeholder={rule?.field ? "选择值" : "先选字段"} />
																</SelectTrigger>
																<SelectContent>
																	{values.map((item) => (
																		<SelectItem key={item.value} value={item.value}>
																			{item.label}
																		</SelectItem>
																	))}
																</SelectContent>
															</Select>
															<span className="text-xs text-muted-foreground tabular-nums">
																{rule?.field && rule.value ? `匹配 ${matchedOf(rule)} 行` : "全部数据"}
															</span>
														</div>
													);
												})}
											</div>
										) : null}
									</div>
								) : (
									<p className="text-sm text-destructive">填报模板结构无效,无法导入。</p>
								)
							) : null}
						</section>
					)}

					<TaskLinkEditor value={links} onChange={setLinks} disabled={pending} />

					<section className="space-y-1 border-t border-border pt-4">
						<h3 className="mb-1 text-sm font-medium text-foreground">附件区</h3>
						{/* 附件:选完即传,提交只带 id 列表(与评论附件同一链路) */}
						<TaskAttachmentPicker value={attachments} onChange={setAttachments} disabled={pending} />
					</section>
				</DialogBody>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
						取消
					</Button>
					<Button
						disabled={pending || !canSubmit}
						onClick={() =>
							onSubmit({
								name: name.trim(),
								description: description.trim() || null,
								dueAt: fromDateInput(due),
								priority,
								workflowId,
								report: reportTemplateId
									? {
											reportId: reportTemplateId,
											...(importedRows.length ? { rows: importedRows } : {}),
										}
									: null,
								reportFilter: ruleToFilter(rules[""]),
								executors: executorIds.map((id) => ({ userId: id, filter: ruleToFilter(rules[id]) })),
								links,
								attachments: attachments.map((file) => file.id),
							})
						}
					>
						{pending ? "保存中…" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
