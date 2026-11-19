import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DepartmentUserSelect } from "#/components/modules/shared/department-user-select";
import { TaskActionDialog } from "#/components/modules/task-close/task-action-dialog";
import { AttachmentChips, TaskAttachmentAddButton } from "#/components/modules/task-close/task-content-attachments";
import { TaskLinkEditor } from "#/components/modules/task-close/task-link-editor";
import { TaskReminderConfigEditor } from "#/components/modules/task-close/task-reminder-config";
import { TaskReportExcel } from "#/components/modules/task-close/task-report-excel";
import { TaskScopeEditor } from "#/components/modules/task-close/task-scope-editor";
import { useAttachmentPreview } from "#/components/modules/task-close/use-attachment-preview";
import { ActionIconButton } from "#/components/ui/action-button";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { DatePicker } from "#/components/ui/date-picker";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import type { SearchSelectOption } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { useTRPC } from "#/integrations/trpc/react";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskPriority } from "#/lib/task/close-spec";
import { blankBlock, MAX_ATTACHMENTS, MAX_LINKS, type TaskAttachment, type TaskLinkBlock } from "#/lib/task/payload";
import { reminderSummaryOf, type TaskReminderConfig, taskReminderConfigSchema } from "#/lib/task/reminder-spec";
import { taskReportSchema } from "#/lib/task/report-spec";
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

/**
 * 优先级 Select 的固定选项 —— 「未设置」放最前,允许保留旧值不变。
 *
 * **value 一律是字符串**:Base UI 的 `Select` 只收 `string`,而落库的 `priority` 是 `0|1|2|null`。
 * 之前硬把 number 塞进去(靠 `as unknown as string` 骗过类型),这里统一 `"null"` / `"0"` / `"1"` / `"2"`,
 * 进出各转一次 —— 转换只在 `parsePriority` 一处。
 */
const PRIORITY_OPTIONS: { value: string; label: string }[] = [
	{ value: "null", label: "未设置" },
	...TASK_PRIORITIES.map((value) => ({ value: String(value), label: TASK_PRIORITY_LABEL[value] })),
];

/** `"0"|"1"|"2"` → `0|1|2`;其余(含 `"null"` / 空串)一律「未设置」 */
function parsePriority(value: string | null): TaskPriority | null {
	const n = Number(value);
	return (TASK_PRIORITIES as readonly number[]).includes(n) ? (n as TaskPriority) : null;
}

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
	reminderConfig: TaskReminderConfig;
	hasChildren: boolean;
};

/** 两种模式共有的字段 */
type TaskFormCommon = {
	name: string;
	description: string | null;
	dueAt: string | null;
	/** 提交时:`null` = 没选,`0|1|2` = 选定档;接口上 `undefined` 表示「不动旧值」,**这里**总是显式传值 */
	priority: number | null;
	reminderConfig: TaskReminderConfig;
};

/**
 * **创建**任务的载荷 —— 流程模板 / 填报模板 / 执行人都在这一步定死,之后各有自己的接口。
 * 附件只传 id(`sys_file.id`),不传对象。
 */
export type CreateTaskPayload = TaskFormCommon & {
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
	attachments: string[];
};

/** **编辑**任务的载荷 —— 只有任务本身的字段,流程 / 填报 / 执行人不可改 */
export type EditTaskPayload = TaskFormCommon & {
	links: TaskLinkBlock[];
	attachments: string[];
};

/**
 * 提交方向与模式**绑在一起**:编辑态只能配 `onEdit`(收 `EditTaskPayload`),创建态只能配 `onCreate`。
 * 之前是一个联合入参 `onSubmit(payload: CreateTaskPayload | EditTaskPayload)`,两个调用点各自 `as` 一次 ——
 * 类型等于没约束。
 */
type TaskFormSubmit =
	| { editing: TaskFormEditing; onEdit: (payload: EditTaskPayload) => void; onCreate?: undefined }
	| { editing: null; onCreate: (payload: CreateTaskPayload) => void; onEdit?: undefined };

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
	compact = false,
}: {
	title: string;
	meta: string;
	open: boolean;
	onToggle: () => void;
	/** 区块级动作(本弹窗里就是各区的「+」),放在标题行最右端 —— 与折叠开关并排但不嵌套 */
	action?: React.ReactNode;
	compact?: boolean;
	children: React.ReactNode;
}) {
	return (
		<section className="border-t border-border">
			<div className={cn("flex items-center gap-2", compact ? "h-8" : "h-9")}>
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
					<div className={compact ? "pb-2" : "pb-3"}>{children}</div>
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
	workflowOptions = [],
	userOptions,
	...submit
}: TaskFormSubmit & {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	pending: boolean;
	/** 只有新建态用得到(编辑态流程模板不可改);不传就当作空 */
	workflowOptions?: Option[];
	userOptions: Option[];
}) {
	const editing = submit.editing;
	const trpc = useTRPC();
	const templates = useQuery({ ...trpc.taskClose.reportTemplateList.queryOptions(), enabled: open && !editing });
	const [reportTemplateId, setReportTemplateId] = useState("");
	/** 三个可选区的展开态(收起时不卸载,填到一半的东西不丢) */
	const [fold, setFold] = useState({ report: false, links: false, attach: false, reminder: false });
	const [importedRows, setImportedRows] = useState<Array<Record<string, string | number | boolean | string[] | null>>>(
		[],
	);
	/** 数据范围:key = 执行人 id(没选执行人时用 `""` 表示任务本身);不配 = 全部数据 */
	const [rules, setRules] = useState<Record<string, { field: string; value: string }>>({});
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [due, setDue] = useState("");
	/** `null` = 未设置;`0|1|2` = P0/P1/P2。DB 列是 tinyint,运行时是 number */
	const [reminderConfig, setReminderConfig] = useState<TaskReminderConfig>(() =>
		taskReminderConfigSchema.parse(undefined),
	);
	const [priority, setPriority] = useState<number | null>(null);
	const [workflowId, setWorkflowId] = useState("");
	const [executorIds, setExecutorIds] = useState<string[]>([]);
	const [links, setLinks] = useState<TaskLinkBlock[]>([]);
	const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
	/** 预览已保存任务的附件 */
	const preview = useAttachmentPreview<TaskAttachment>(editing?.id);

	// 打开时回填;模板缺省取第一个,避免"没选模板点保存"这种可避免的报错
	// biome-ignore lint/correctness/useExhaustiveDependencies: 打开时取一次初始值，后台刷新不能覆盖用户输入
	useEffect(() => {
		if (!open) return;
		setName(editing?.name ?? "");
		setDescription(editing?.description ?? "");
		setDue(toDateInput(editing?.dueAt));
		setPriority(editing?.priority ?? null);
		setReminderConfig(editing?.reminderConfig ?? taskReminderConfigSchema.parse(undefined));
		setWorkflowId(editing ? "" : (workflowOptions[0]?.value ?? ""));
		setExecutorIds([]);
		setReportTemplateId("");
		setFold({ report: false, links: false, attach: false, reminder: false });
		resetReportRule();
		setLinks(editing?.links ?? []);
		setAttachments(editing?.attachments ?? []);
	}, [open]);

	// 流程列表可能在弹窗打开后才返回，只补尚未选择的默认值。
	useEffect(() => {
		if (open && !editing && !workflowId && workflowOptions[0]) setWorkflowId(workflowOptions[0].value);
	}, [open, editing, workflowId, workflowOptions]);

	const reminderValid = taskReminderConfigSchema.safeParse(reminderConfig).success;
	const canSubmit = name.trim().length > 0 && (editing !== null || workflowId.length > 0) && reminderValid;
	/** 页脚缺项提示:只列真必填(截止 / 描述 / 执行人都可空) */
	const missingRequired = [name.trim() ? null : "任务名称", editing || workflowId ? null : "流程模板"].filter(
		(item): item is string => item !== null,
	);

	/** 清空带数下发的全部选择(换模板 / 换来源 / 打开弹窗时) */
	const resetReportRule = () => {
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
	/** 过滤字段 —— 与服务端 `taskCreate` 的判据逐字同口径:多选(值是数组)与附件(值是 id 列表)不能做等值比较 */
	const filterFieldOptions = selectedFields.filter(
		(field) => field.type !== "multiselect" && field.type !== "attachment",
	);
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
		<TaskActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title={editing ? "编辑任务" : "新增任务"}
			description={
				editing
					? "可改名称 / 描述 / 截止时间 / 优先级;成员与状态走详情页。"
					: "状态从模板的初始状态开始;执行人能发起「改状态」动作。"
			}
			pending={pending}
			confirmDisabled={!canSubmit}
			confirmText="保存"
			pendingText="保存中…"
			contentClassName="sm:max-w-2xl"
			bodyClassName={editing ? "space-y-2 py-1" : "space-y-1 py-1"}
			footerNote={
				missingRequired.length ? (
					<span className="text-xs leading-5 tracking-wide text-muted-foreground sm:mr-auto">
						还缺 {missingRequired.length} 项必填:{missingRequired.join("、")}
					</span>
				) : !reminderValid ? (
					<button
						type="button"
						className="text-xs text-destructive sm:mr-auto"
						onClick={() => setFold((prev) => ({ ...prev, reminder: true }))}
					>
						请完善通知提醒方式
					</button>
				) : executorIds.length > 1 ? (
					<span className="text-xs leading-5 tracking-wide text-muted-foreground sm:mr-auto">
						将下发 {executorIds.length} 条任务
					</span>
				) : null
			}
			onConfirm={() => {
				const common = {
					name: name.trim(),
					description: description.trim() || null,
					dueAt: fromDateInput(due),
					priority,
					reminderConfig,
					links,
					attachments: attachments.map((file) => file.id),
				};
				// 编辑态只认任务本身的字段;流程 / 填报 / 执行人在创建时定死
				if (submit.editing) return submit.onEdit(common);
				submit.onCreate({
					...common,
					workflowId,
					report: reportTemplateId
						? {
								reportId: reportTemplateId,
								...(importedRows.length ? { rows: importedRows } : {}),
							}
						: null,
					reportFilter: ruleToFilter(rules[""]),
					executors: executorIds.map((id) => ({ userId: id, filter: ruleToFilter(rules[id]) })),
				});
			}}
			afterContent={preview.dialog}
		>
			{editing ? (
				<Alert variant="warn" title={editing.hasChildren ? "保存后将同步子任务" : "编辑范围"} className="mb-3">
					{editing.hasChildren
						? "名称会同步并覆盖下级任务当前名称；说明、截止时间、优先级和提醒只更新未在下级单独修改过的值。链接、附件会同步，且保留下级自行添加的内容。流程状态和执行人不随本次编辑同步。填报母版需单独保存；保存表格母版会覆盖下级尚未提交的填报草稿。"
						: "本次修改仅影响这条任务；流程模板与执行人是建任务时确定的。"}
				</Alert>
			) : null}

			<section>
				<h3 className="mb-1 flex max-w-xl items-baseline gap-2 font-heading text-base font-bold tracking-[-0.01em] text-foreground">
					基本信息
					<span className="flex-1 self-center border-t border-border" />
				</h3>
				<DetailRow label="任务名称" htmlFor="tc-name" className={cn("max-w-xl", !editing && "py-1")}>
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
						<DetailRow label="流程模板" className={cn("max-w-xl", !editing && "py-1")}>
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
						<DetailRow label="执行人" className="max-w-xl flex-col gap-1 py-1 [&>div]:w-full">
							<div className="min-w-0 space-y-1.5">
								<DepartmentUserSelect options={userOptions} value={executorIds} onChange={setExecutorIds} compact />
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
				<DetailRow label="截止时间" htmlFor="tc-due" className={cn("max-w-xl", !editing && "py-1")}>
					<DatePicker id="tc-due" value={due} onChange={setDue} placeholder="选择日期" />
				</DetailRow>

				<DetailRow label="优先级" className={cn("max-w-xl", !editing && "py-1")}>
					<Select
						items={PRIORITY_OPTIONS}
						value={priority === null ? "null" : String(priority)}
						onValueChange={(next) => setPriority(parsePriority(next))}
					>
						<SelectTrigger size="sm" className="w-full">
							<SelectValue placeholder="未设置" />
						</SelectTrigger>
						<SelectContent>
							{PRIORITY_OPTIONS.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</DetailRow>

				{/* 描述移到最后:前面几个字段填完通常已经想清楚了;多数任务描述很短,rows=2 够 */}
				<DetailRow label="描述" htmlFor="tc-desc" hint="可空" className={cn("max-w-xl", !editing && "py-1")}>
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
					compact={!editing}
					meta={
						reportTemplateId
							? [selectedTemplate?.name ?? "已选模板", importedRows.length ? `已导入 ${importedRows.length} 行` : null]
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
							<TaskScopeEditor
								rows={importedRows}
								fields={filterFieldOptions}
								targets={ruleTargets}
								rules={rules}
								onChange={setRules}
							/>
						) : (
							<p className="text-sm text-destructive">填报模板结构无效,无法导入。</p>
						)
					) : null}
				</FoldSection>
			)}

			<FoldSection
				title="链接区"
				compact={!editing}
				meta={
					links.length
						? [
								`${links.length} / ${MAX_LINKS}`,
								links
									.slice(0, 2)
									.map((block) => block.url)
									.join("、"),
							]
								.filter(Boolean)
								.join(" · ")
						: `0 / ${MAX_LINKS} · 还没有链接`
				}
				open={fold.links}
				onToggle={() => setFold((prev) => ({ ...prev, links: !prev.links }))}
				action={
					<Button
						variant="ghost"
						size="xs"
						className="size-6 p-0 text-muted-foreground"
						aria-label="添加链接"
						title="添加链接"
						disabled={pending || links.length >= MAX_LINKS}
						onClick={() => setLinks((prev) => [...prev, blankBlock()])}
					>
						<Plus className="size-3.5" />
					</Button>
				}
			>
				<TaskLinkEditor value={links} onChange={setLinks} disabled={pending} />
			</FoldSection>

			<FoldSection
				title="附件区"
				compact={!editing}
				meta={
					attachments.length
						? [
								`${attachments.length} / 20`,
								attachments
									.slice(0, 2)
									.map((file) => file.name)
									.join("、"),
							].join(" · ")
						: `0 / ${MAX_ATTACHMENTS} · 还没有附件`
				}
				open={fold.attach}
				onToggle={() => setFold((prev) => ({ ...prev, attach: !prev.attach }))}
				action={
					<TaskAttachmentAddButton
						value={attachments}
						onChange={setAttachments}
						disabled={pending}
						compact={!editing}
					/>
				}
			>
				{/* 附件:选完即传,提交只带 id 列表(与评论附件同一链路);点条目就地预览 */}
				<AttachmentChips
					attachments={attachments}
					onOpen={editing ? preview.preview : undefined}
					onRemove={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))}
					disabled={pending}
				/>
			</FoldSection>
			<FoldSection
				title="通知"
				compact={!editing}
				meta={reminderSummaryOf(reminderConfig)}
				open={fold.reminder}
				onToggle={() => setFold((prev) => ({ ...prev, reminder: !prev.reminder }))}
			>
				<TaskReminderConfigEditor value={reminderConfig} onChange={setReminderConfig} dueAt={fromDateInput(due)} />
			</FoldSection>
		</TaskActionDialog>
	);
}
