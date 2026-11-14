import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MultiSelect } from "#/components/modules/shared/multi-select";
import { TaskAttachmentPreview } from "#/components/modules/task-close/task-attachment-preview";
import { AttachmentChips, TaskAttachmentAddButton } from "#/components/modules/task-close/task-content-attachments";
import { TaskLinkEditor } from "#/components/modules/task-close/task-link-editor";
import { TaskReportExcel } from "#/components/modules/task-close/task-report-excel";
import { ActionButton, ActionIconButton } from "#/components/ui/action-button";
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
import { RANDOM_PALETTE, stableIndex } from "#/lib/tag-color";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskPriority } from "#/lib/task-close-spec";
import { blankBlock, type TaskAttachment, type TaskLinkBlock } from "#/lib/task-payload";
import { taskReportSchema } from "#/lib/task-report-spec";
import { formatLocalDate } from "#/lib/time";
import { cn } from "#/lib/utils";

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
 * 二级分区:标题 + 一行摘要的折叠条。
 *
 * 只有本弹窗用(链接 / 附件 / 填报三个可选区),所以留在本文件里,不升到 `ui/`。
 * 折叠走 `styles.css` 的 `.collapse-grid`(0fr → 1fr);收起时给 `inert`,
 * 否则隐藏的输入框仍然能被 Tab 进去。
 */
function FoldSection({
	title,
	meta,
	open,
	onToggle,
	action,
	children,
}: {
	title: string;
	meta: string;
	open: boolean;
	onToggle: () => void;
	/** 区块级动作(本弹窗里就是各区的「+」),放在标题行最右端 —— 与折叠开关并排但不嵌套 */
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="border-t border-border">
			<div className="flex h-9 items-center gap-2">
				<button
					type="button"
					aria-expanded={open}
					onClick={onToggle}
					className="flex min-w-0 flex-1 items-baseline gap-2 text-left text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/25"
				>
					<span className="shrink-0 text-xs font-medium tracking-wider">{title}</span>
					<span className="min-w-0 flex-1 truncate text-xs">{meta}</span>
					<ChevronDown
						className={cn(
							"size-3.5 shrink-0 self-center transition-transform duration-150 ease-brand",
							open && "rotate-180",
						)}
					/>
				</button>
				{open ? action : null}
			</div>
			<div inert={!open} className={cn("collapse-grid", open && "is-open")}>
				<div>
					<div className="pb-3">{children}</div>
				</div>
			</div>
		</section>
	);
}

/**
 * 新建 / 编辑任务。
 *
 * 新建:`taskCreate`(选模板 + 选执行人,可多选 —— 多人时各下发一条子任务);编辑:`taskUpdate`(只改名称 / 描述 / 截止 / 优先级)。
 * **一件事一个接口**,所以这里也按模式分派,不做「一个提交按钮打两个接口」。
 *
 * 版式:基本信息是主线(常显),填报 / 链接 / 附件是可选区,收成摘要条;
 * 页头摘要条 + 页脚缺项提示都从表单状态派生,不另存一份。
 */
export function TaskForm({
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
	/** 三个可选区的展开态(收起时不卸载,填到一半的东西不丢) */
	const [fold, setFold] = useState({ report: false, links: false, attach: false });
	/** 数据范围卡片的展开态:key = 执行人 id(null = 都收起) */
	const [scopeOpen, setScopeOpen] = useState<string | null>(null);
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
	/** 预览已保存任务的附件 */
	const [previewAttachment, setPreviewAttachment] = useState<TaskAttachment | null>(null);

	// 打开时回填;模板缺省取第一个,避免"没选模板点保存"这种可避免的报错
	// biome-ignore lint/correctness/useExhaustiveDependencies: 打开时取一次初始值，后台刷新不能覆盖用户输入
	useEffect(() => {
		if (!open) return;
		setName(editing?.name ?? "");
		setDescription(editing?.description ?? "");
		setDue(toDateInput(editing?.dueAt));
		setPriority(editing?.priority ?? null);
		setWorkflowId(editing ? "" : (workflowOptions[0]?.value ?? ""));
		setExecutorIds([]);
		setReportTemplateId("");
		setFold({ report: false, links: false, attach: false });
		resetReportRule();
		setLinks(editing?.links ?? []);
		setAttachments(editing?.attachments ?? []);
	}, [open]);

	// 流程列表可能在弹窗打开后才返回，只补尚未选择的默认值。
	useEffect(() => {
		if (open && !editing && !workflowId && workflowOptions[0]) setWorkflowId(workflowOptions[0].value);
	}, [open, editing, workflowId, workflowOptions]);

	const canSubmit = name.trim().length > 0 && (editing !== null || workflowId.length > 0);
	/** 页脚缺项提示:只列真必填(截止 / 描述 / 执行人都可空) */
	const missingRequired = [name.trim() ? null : "任务名称", editing || workflowId ? null : "流程模板"].filter(
		(item): item is string => item !== null,
	);

	/** 清空带数下发的全部选择(换模板 / 换来源 / 打开弹窗时) */
	const resetReportRule = () => {
		setScopeOpen(null);
		setImportedRows([]);
		setRules({});
	};

	// ── 带数下发(仅表格模板):Excel 模版导入的行 + 过滤条件 ──
	const selectedTemplate = (templates.data ?? []).find((template) => template.id === reportTemplateId);
	const selectedSchema = useMemo(
		() => (selectedTemplate ? taskReportSchema.safeParse(selectedTemplate.payload) : null),
		[selectedTemplate],
	);
	const selectedKind = selectedSchema?.success ? selectedSchema.data.kind : "OBJECT";
	const selectedFields = selectedSchema?.success ? selectedSchema.data.fields : [];
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
	/** 卡片上那句「字段 = 值」 */
	const ruleSummaryOf = (rule?: { field: string; value: string }) => {
		if (!rule?.field) return "全部数据";
		const fieldLabel = filterFieldOptions.find((field) => field.id === rule.field)?.label ?? rule.field;
		if (!rule.value) return `${fieldLabel} = 未选值`;
		return `${fieldLabel} = ${String(JSON.parse(rule.value) ?? "空")}`;
	};
	/** 规则挂在谁身上:选了执行人 = 每人一条;没选 = 任务本身 */
	const ruleTargets = executorIds.length
		? executorIds.map((id) => ({ key: id, label: userOptions.find((option) => option.value === id)?.label ?? id }))
		: [{ key: "", label: "本任务" }];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle>{editing ? "编辑任务" : "新增任务"}</DialogTitle>
					<DialogDescription>
						{editing
							? "可改名称 / 描述 / 截止时间 / 优先级;成员与状态走详情页。"
							: "状态从模板的初始状态开始;执行人能发起「改状态」动作。"}
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="space-y-2 py-1">
					{editing ? (
						<Alert variant="danger" title="批注" className="mb-3">
							本次修改只影响这条任务本身;流程模板与执行人是建任务时定的,到任务详情页调整。
						</Alert>
					) : null}

					<section>
						<h3 className="mb-1 flex max-w-xl items-baseline gap-2 font-heading text-base font-bold tracking-[-0.01em] text-foreground">
							基本信息
							<span className="flex-1 self-center border-t border-border" />
						</h3>
						<DetailRow label="任务名称" htmlFor="tc-name" className="max-w-xl">
							<Input
								id="tc-name"
								aria-required="true"
								className="h-9 text-base sm:h-8 sm:text-sm"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="比如:3 号机组巡检"
							/>
						</DetailRow>

						{editing ? null : (
							<>
								<DetailRow label="流程模板" className="max-w-xl">
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
								<DetailRow label="执行人" className="max-w-xl">
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
											<Alert variant="warn" title="注意">
												选了 <b className="tabular-nums">{executorIds.length}</b> 位执行人,会各自下发 1 条任务,共{" "}
												<b className="tabular-nums">{executorIds.length}</b> 条。
											</Alert>
										) : (
											<p className="text-xs text-muted-foreground">可不选,之后再指派。</p>
										)}
									</div>
								</DetailRow>
							</>
						)}
						<DetailRow label="截止时间" htmlFor="tc-due" className="max-w-xl">
							<DatePicker id="tc-due" value={due} onChange={setDue} placeholder="选择日期" />
						</DetailRow>

						<DetailRow label="优先级" className="max-w-xl">
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

						{/* 描述移到最后:前面几个字段填完通常已经想清楚了;多数任务描述很短,rows=2 够 */}
						<DetailRow label="描述" htmlFor="tc-desc" hint="可空" className="max-w-xl">
							<Textarea
								id="tc-desc"
								rows={2}
								className="text-base sm:text-sm"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="补充说明"
							/>
						</DetailRow>
					</section>

					{editing ? null : (
						<FoldSection
							title="填报区"
							meta={
								reportTemplateId
									? [
											selectedTemplate?.name ?? "已选模板",
											importedRows.length ? `已导入 ${importedRows.length} 行` : null,
										]
											.filter(Boolean)
											.join(" · ")
									: "未配置 · 选表格模板后可导入 Excel 并按人划范围"
							}
							open={fold.report}
							onToggle={() => setFold((prev) => ({ ...prev, report: !prev.report }))}
						>
							<DetailRow
								label="填报模板"
								hint={
									reportTemplateId && selectedKind === "TABLE"
										? "需先导入 Excel 底表,再为每位执行人划定数据范围。"
										: undefined
								}
							>
								<div className="flex flex-wrap items-center gap-2">
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
											{/* 下载模版 / 文件导入:排在「清除」右边,只出图标,不占一条 */}
											{selectedKind === "TABLE" && selectedSchema?.success ? (
												<TaskReportExcel
													reportId={reportTemplateId}
													schema={selectedSchema.data}
													canEdit
													disabled={false}
													onImport={(value) => {
														setImportedRows((Array.isArray(value) ? value : [value]) as typeof importedRows);
													}}
												/>
											) : null}
										</>
									) : null}
								</div>
							</DetailRow>

							{reportTemplateId && selectedKind === "TABLE" ? (
								selectedSchema?.success ? (
									<div className="space-y-2.5">
										{importedRows.length > 0 ? (
											<div className="flex items-center gap-2 rounded-md border border-hue-blue-line bg-hue-blue-soft px-3 py-2">
												<span className="text-xs font-medium text-hue-blue-fg">已导入</span>
												<span className="text-sm font-semibold text-hue-blue-fg tabular-nums">
													{importedRows.length}
												</span>
												<span className="text-xs text-hue-blue-fg">行 · 列顺序见「ⓘ」</span>
											</div>
										) : (
											<p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
												还没有数据。用「文件导入」选一份 Excel,或用「下载模版」先填。
											</p>
										)}
										{importedRows.length > 0 && filterFieldOptions.length > 0 ? (
											<div className="space-y-2">
												<p className="text-xs font-medium tracking-wider text-muted-foreground">数据范围 · 按执行人</p>
												<div className="space-y-2">
													{ruleTargets.map((target) => {
														const rule = rules[target.key];
														const values = rule?.field ? valuesOf(rule.field) : [];
														const opened = scopeOpen === target.key;
														const hit = matchedOf(rule);
														const avatarTone = RANDOM_PALETTE[stableIndex(target.key || "self", RANDOM_PALETTE.length)];
														const setRule = (next: { field: string; value: string }) =>
															setRules((prev) => ({ ...prev, [target.key]: next }));
														return (
															<article
																key={target.key || "self"}
																className={cn(
																	"overflow-hidden rounded-md border transition-colors",
																	opened ? "border-hue-blue-line" : "border-border",
																)}
															>
																<div className="flex items-center gap-2.5 px-3 py-2">
																	{/* 点色圆头像(同 Tag 的稳定哈希选色,同人同色) */}
																	<span
																		className={cn(
																			"flex size-6.5 shrink-0 items-center justify-center rounded-full text-xs font-bold leading-none",
																			avatarTone,
																		)}
																	>
																		{target.label.slice(0, 1)}
																	</span>
																	<span
																		className="min-w-0 max-w-28 shrink-0 truncate text-sm font-medium text-foreground"
																		title={target.label}
																	>
																		{target.label}
																	</span>
																	<span
																		className={cn(
																			"min-w-0 flex-1 truncate text-xs",
																			rule?.field ? "text-foreground" : "text-muted-foreground",
																		)}
																	>
																		{ruleSummaryOf(rule)}
																	</span>
																	<span
																		className={cn(
																			"shrink-0 rounded-sm px-1.5 py-0.5 text-xs tabular-nums",
																			hit > 0 ? "bg-success-soft text-success-fg" : "bg-danger-soft text-danger-fg",
																		)}
																	>
																		命中 {hit} 行
																	</span>
																	<ActionButton onClick={() => setScopeOpen(opened ? null : target.key)}>
																		{opened ? "收起" : "编辑"}
																	</ActionButton>
																	<ActionIconButton
																		label={`清除 ${target.label} 的数据范围`}
																		disabled={!rule?.field}
																		onClick={() => {
																			setRules((prev) => {
																				const next = { ...prev };
																				delete next[target.key];
																				return next;
																			});
																			setScopeOpen(null);
																		}}
																	>
																		<X className="size-3.5" />
																	</ActionIconButton>
																</div>
																{opened ? (
																	<div className="grid grid-cols-2 gap-2 border-t border-hue-blue-line bg-hue-blue-soft/50 px-3 py-2.5">
																		<div>
																			<span className="mb-1 block text-[11px] tracking-wider text-muted-foreground">
																				字段
																			</span>
																			<Select
																				items={filterFieldOptions.map((field) => ({
																					value: field.id,
																					label: field.label,
																				}))}
																				value={rule?.field || null}
																				onValueChange={(value) => setRule({ field: value ?? "", value: "" })}
																			>
																				<SelectTrigger
																					size="sm"
																					className="w-full"
																					aria-label={`${target.label} 数据范围字段`}
																				>
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
																		</div>
																		<div>
																			<span className="mb-1 block text-[11px] tracking-wider text-muted-foreground">
																				值
																			</span>
																			<Select
																				items={values}
																				value={rule?.value || null}
																				disabled={!rule?.field}
																				onValueChange={(value) => {
																					if (!rule?.field) return;
																					setRule({ field: rule.field, value: value ?? "" });
																				}}
																			>
																				<SelectTrigger
																					size="sm"
																					className="w-full"
																					aria-label={`${target.label} 数据范围值`}
																				>
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
																		</div>
																	</div>
																) : null}
															</article>
														);
													})}
												</div>
												<p className="text-xs text-muted-foreground">
													未划范围的人默认拿到全部 {importedRows.length} 行；多个执行人的范围必须互斥。
												</p>
											</div>
										) : null}
									</div>
								) : (
									<p className="text-sm text-destructive">填报模板结构无效,无法导入。</p>
								)
							) : null}
						</FoldSection>
					)}

					<FoldSection
						title="链接区"
						meta={
							links.length
								? [
										`${links.length} / 30`,
										links
											.slice(0, 2)
											.map((block) => block.url)
											.join("、"),
									]
										.filter(Boolean)
										.join(" · ")
								: "0 / 30 · 还没有链接"
						}
						open={fold.links}
						onToggle={() => setFold((prev) => ({ ...prev, links: !prev.links }))}
						action={
							<Button
								variant="outline"
								size="icon-sm"
								aria-label="添加链接"
								title="添加链接"
								disabled={pending || links.length >= 30}
								onClick={() => setLinks((prev) => [...prev, blankBlock()])}
							>
								<Plus className="size-4" />
							</Button>
						}
					>
						<TaskLinkEditor value={links} onChange={setLinks} disabled={pending} />
					</FoldSection>

					<FoldSection
						title="附件区"
						meta={
							attachments.length
								? [
										`${attachments.length} / 20`,
										attachments
											.slice(0, 2)
											.map((file) => file.name)
											.join("、"),
									].join(" · ")
								: "0 / 20 · 还没有附件"
						}
						open={fold.attach}
						onToggle={() => setFold((prev) => ({ ...prev, attach: !prev.attach }))}
						action={<TaskAttachmentAddButton value={attachments} onChange={setAttachments} disabled={pending} />}
					>
						{/* 附件:选完即传,提交只带 id 列表(与评论附件同一链路);点条目就地预览 */}
						<AttachmentChips
							attachments={attachments}
							onOpen={editing ? setPreviewAttachment : undefined}
							onRemove={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))}
							disabled={pending}
						/>
					</FoldSection>
				</DialogBody>
				<DialogFooter>
					{missingRequired.length ? (
						<span className="text-xs leading-5 tracking-wide text-muted-foreground sm:mr-auto">
							还缺 {missingRequired.length} 项必填:{missingRequired.join("、")}
						</span>
					) : executorIds.length > 1 ? (
						<span className="text-xs leading-5 tracking-wide text-muted-foreground sm:mr-auto">
							将下发 {executorIds.length} 条任务
						</span>
					) : null}
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
			{editing && (
				<TaskAttachmentPreview
					taskId={editing.id}
					attachment={previewAttachment}
					open={previewAttachment !== null}
					onOpenChange={(next) => {
						if (!next) setPreviewAttachment(null);
					}}
				/>
			)}
		</Dialog>
	);
}
