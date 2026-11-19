import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, GripVertical } from "lucide-react";
import { pinyin } from "pinyin-pro";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { type DraftFieldLike, ReportFieldRow } from "#/components/modules/task-close/report-field-row";
import { TaskActionDialog } from "#/components/modules/task-close/task-action-dialog";
import { TaskReportExcelTemplatePreview } from "#/components/modules/task-close/task-report-excel-template-preview";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Radio, RadioGroup } from "#/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { useFileUpload } from "#/hooks/use-file-upload";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { reportFieldsFromHeaders } from "#/lib/task/report-header-import";
import {
	MAX_REPORT_FILE_BYTES,
	REPORT_FIELD_TYPES,
	REPORT_TOP_FIELD_TYPES,
	type ReportFieldType,
	type ReportTopFieldType,
	type TaskReportSchema,
	taskReportSchema,
} from "#/lib/task/report-spec";
import { cn } from "#/lib/utils";

const TaskReportHeaderImportDialog = lazy(() =>
	import("#/components/modules/task-close/task-report-header-import-dialog").then((module) => ({
		default: module.TaskReportHeaderImportDialog,
	})),
);

/** 字段类型清单 —— 真源在 `lib/task/report-spec.ts`(值与文案只有一份) */
const FIELD_TYPES = REPORT_TOP_FIELD_TYPES;
/** 数组元素里能选的类型:去掉「数组」本身(只允许一层) */
const ITEM_TYPES = REPORT_FIELD_TYPES;
type FieldType = ReportTopFieldType;
type ItemFieldType = ReportFieldType;
/** 数组元素里的一条字段 —— 公共形状在 `report-field-row` 的 `DraftFieldLike` */
type ItemField = DraftFieldLike & { key: string; type: ItemFieldType };
const newItemField = (): ItemField => ({
	key: crypto.randomUUID(),
	id: "",
	idEdited: false,
	label: "",
	type: "text",
	required: false,
	options: [],
});
/**
 * 顶层字段的编辑态 —— 公共形状(`id` / `idEdited` / `label` / `type` / `required` / `options`)
 * 在 `DraftFieldLike`;顶层比元素层多三样:允许为空、数组元素字段、发布时的原值。
 */
type Field = DraftFieldLike & {
	key: string;
	type: FieldType;
	/** 单选:是否允许填「空」(下拉里多一个「（空）」项) */
	allowEmpty: boolean;
	/** 数组类型:元素对象的字段(至少 1 个) */
	itemFields: ItemField[];
	/** 发布时的原值 —— 提交时原样带回,没改动的字段不丢 */
	original?: TaskReportSchema["fields"][number];
};
const newField = (): Field => ({
	key: crypto.randomUUID(),
	id: "",
	idEdited: false,
	label: "",
	type: "text",
	required: false,
	allowEmpty: false,
	options: [],
	itemFields: [],
});

/**
 * 中文名称 → 字段标识预填:拼音小写串,只留字母数字且首字符是字母(与 `fieldId` 正则同口径)。
 * 纯数字 / 符号名称拼不出字母开头时返回空串,交给人自己填。
 */
function slugId(label: string): string {
	const raw = pinyin(label, { toneType: "none", type: "array" }).join("");
	const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "").replace(/^[0-9]+/, "");
	return cleaned.slice(0, 64);
}

/** 表单弹窗的模板候选:reportTemplateList 的一行(只取用得到的字段) */
type RawTemplate = {
	id: string;
	name: string;
	payload: unknown;
	shared: number;
	canManage: boolean;
};

/**
 * 填报模板的新增 / 编辑表单(原「管理填报模板」弹窗的表单部分)。
 *
 * 编辑已有模板 = 直接覆盖其 `payload`(单版本);字段区是**一行式**编辑:
 * 名称 / 标识 / 类型 / 必填 / 删除,选项行只在单选 / 多选时出现;校验错误贴到具体字段行。
 */
export function TaskReportTemplateForm({
	open,
	onOpenChange,
	templates,
	initialTemplateId,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	templates: RawTemplate[];
	initialTemplateId: string | null;
}) {
	const trpc = useTRPC();
	const client = useQueryClient();
	const dictionaries = useQuery({ ...trpc.dict.reportOptions.queryOptions(), enabled: open });
	const [templateId, setTemplateId] = useState("");
	const [shared, setShared] = useState(false);
	const [name, setName] = useState("");
	const [kind, setKind] = useState<"OBJECT" | "TABLE" | "EXCEL">("OBJECT");
	const [fields, setFields] = useState<Field[]>([]);
	const [excelTemplateFileId, setExcelTemplateFileId] = useState("");
	const [excelTemplateFileName, setExcelTemplateFileName] = useState("");
	const [excelSheetNames, setExcelSheetNames] = useState<string[]>([]);
	const [excelSheetName, setExcelSheetName] = useState("");
	const [excelDataStartRow, setExcelDataStartRow] = useState("1");
	const [uploadingExcelTemplate, setUploadingExcelTemplate] = useState(false);
	const [excelPreviewOpen, setExcelPreviewOpen] = useState(false);
	const { upload } = useFileUpload();
	const excelTemplateInputId = "report-excel-template-file";
	const [headerImportOpen, setHeaderImportOpen] = useState(false);
	/** 顶层错误(名称 / 结构性)与**贴到具体字段行**的错误分开 —— 改哪行清哪行的错 */
	const [error, setError] = useState("");
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const invalidate = () => client.invalidateQueries(trpc.taskClose.reportTemplateList.queryFilter());
	const create = useMutation(
		trpc.taskClose.reportTemplateCreate.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => onOpenChange(false), message: () => "模板已发布" }),
			onError: toastApiError,
		}),
	);
	const publish = useMutation(
		trpc.taskClose.reportTemplateUpdate.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => onOpenChange(false), message: () => "模板已保存" }),
			onError: toastApiError,
		}),
	);

	const selectTemplate = (id: string) => {
		setTemplateId(id);
		setError("");
		setFieldErrors({});
		if (!id) {
			setName("");
			setKind("OBJECT");
			setShared(false);
			setFields([newField()]);
			setExcelTemplateFileId("");
			setExcelTemplateFileName("");
			setExcelSheetNames([]);
			setExcelSheetName("");
			setExcelDataStartRow("1");
			return;
		}
		const template = templates.find((item) => item.id === id && item.canManage);
		const parsed = taskReportSchema.safeParse(template?.payload);
		if (!template || !parsed.success) {
			setName("");
			setKind("OBJECT");
			setShared(false);
			setFields([]);
			setExcelTemplateFileId("");
			setExcelSheetNames([]);
			setExcelSheetName("");
			setError("模板结构无效，无法编辑");
			return;
		}
		setName(template.name);
		setShared(template.shared === 1);
		setKind(parsed.data.kind);
		setExcelTemplateFileId(parsed.data.excel?.templateFileId ?? "");
		setExcelTemplateFileName(parsed.data.excel ? "已关联工作簿模板" : "");
		setExcelSheetNames(parsed.data.excel ? [parsed.data.excel.sheetName] : []);
		setExcelSheetName(parsed.data.excel?.sheetName ?? "");
		setExcelDataStartRow(String(parsed.data.excel?.dataStartRow ?? 1));
		setFields(
			parsed.data.fields.map((field) => ({
				key: crypto.randomUUID(),
				id: field.id,
				// 已发布的标识被填报数据引用,不随名称再自动生成
				idEdited: true,
				label: field.label,
				type: field.type,
				required: field.required,
				allowEmpty: field.allowEmpty,
				options: field.options ?? [],
				itemFields: (field.itemFields ?? []).map((item) => ({
					key: crypto.randomUUID(),
					id: item.id,
					// 已发布的标识被填报数据引用,不再随名称自动生成
					idEdited: true,
					label: item.label,
					type: item.type as ItemFieldType,
					required: item.required,
					options: item.options ?? [],
				})),
				original: field,
			})),
		);
	};
	const uploadExcelTemplate = async (file?: File) => {
		if (!file) return;
		if (!file.name.toLowerCase().endsWith(".xlsx")) {
			toast.error("请选择 .xlsx 工作簿");
			return;
		}
		if (file.size > MAX_REPORT_FILE_BYTES) {
			toast.error("工作簿不能超过 5 MB");
			return;
		}
		let sheetNames: string[];
		try {
			const book = XLSX.read(await file.arrayBuffer(), { type: "array", bookVBA: true });
			if (book.vbaraw || book.SheetNames.length === 0) throw new Error("工作簿无效");
			sheetNames = book.SheetNames;
		} catch {
			toast.error("无法读取工作簿，请检查文件是否有效");
			return;
		}
		setUploadingExcelTemplate(true);
		const result = await upload(file, "private");
		setUploadingExcelTemplate(false);
		if (!result.ok) {
			toast.error(result.message);
			return;
		}
		setExcelTemplateFileId(result.row.id);
		setExcelTemplateFileName(file.name);
		setExcelSheetNames(sheetNames);
		setExcelSheetName(sheetNames[0] ?? "");
		toast.success("工作簿模板已上传");
	};

	// 打开时按调用方的意图选模板(行「编辑」进来的带 id,「新增」进来的为空);关闭不清,免得关闭动画闪空
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectTemplate 闭包读的 templates / 各 state 都以 open 为闸,只在打开瞬间生效
	useEffect(() => {
		if (open) selectTemplate(initialTemplateId ?? "");
	}, [open, initialTemplateId]);

	const update = (key: string, patch: Partial<Field>) => {
		setFieldErrors((errors) => {
			if (!errors[key]) return errors;
			const next = { ...errors };
			delete next[key];
			return next;
		});
		setFields((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
	};
	const addField = () => setFields([...fields, newField()]);
	const importFieldsFromHeaders = (headers: string[]) => {
		const available = Math.max(0, 100 - fields.length);
		const imported = reportFieldsFromHeaders(
			headers,
			fields.map((field) => field.id),
			slugId,
		);
		const added = imported.fields.slice(0, available).map((field) => ({
			...newField(),
			id: field.id,
			idEdited: true,
			label: field.label,
		}));
		if (added.length === 0) {
			toast.error("没有可创建的字段；请检查表头是否为空或超过 100 字。");
			return;
		}
		setFields((current) => [...current, ...added]);
		const skipped = imported.skippedLong + Math.max(0, imported.fields.length - available);
		if (skipped > 0) toast.warning(`已创建 ${added.length} 个字段，另有 ${skipped} 个表头未创建。`);
		else toast.success(`已创建 ${added.length} 个字段`);
	};
	// 字段顺序拖拽(HTML5 DnD,与字典项 / 列设置面板同款):整行可拖,拖过谁谁高亮,松手落在那一行
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);
	const reorder = (from: number, to: number) =>
		setFields((items) => {
			if (from === to) return items;
			const next = [...items];
			const [moved] = next.splice(from, 1);
			if (!moved) return items;
			next.splice(to, 0, moved);
			return next;
		});
	/** 数组元素字段的增删改(只动某一行的 itemFields) */
	const setItems = (fieldKey: string, updater: (items: ItemField[]) => ItemField[]) =>
		setFields((items) =>
			items.map((item) => (item.key === fieldKey ? { ...item, itemFields: updater(item.itemFields) } : item)),
		);
	const addItem = (fieldKey: string) => setItems(fieldKey, (items) => [...items, newItemField()]);
	const removeItem = (fieldKey: string, itemKey: string) =>
		setItems(fieldKey, (items) => items.filter((item) => item.key !== itemKey));
	const updateItem = (fieldKey: string, itemKey: string, patch: Partial<ItemField>) =>
		setItems(fieldKey, (items) => items.map((item) => (item.key === itemKey ? { ...item, ...patch } : item)));
	const editableTemplate =
		!templateId ||
		templates.some(
			(template) =>
				template.id === templateId && template.canManage && taskReportSchema.safeParse(template.payload).success,
		);
	const submit = () => {
		if (!editableTemplate || uploadingExcelTemplate) return;
		const result = taskReportSchema.safeParse({
			id: "report",
			kind,
			fields:
				kind === "EXCEL"
					? []
					: fields.map((field) => ({
							...field.original,
							id: field.id.trim(),
							label: field.label.trim(),
							type: field.type,
							required: field.required,
							allowEmpty: field.type === "select" && field.allowEmpty,
							options: field.type === "select" || field.type === "multiselect" ? field.options : undefined,
							itemFields:
								field.type === "array"
									? field.itemFields.map((item) => ({
											id: item.id.trim(),
											label: item.label.trim(),
											type: item.type,
											required: item.required,
											options: item.type === "select" || item.type === "multiselect" ? item.options : undefined,
										}))
									: undefined,
						})),
			excel:
				kind === "EXCEL"
					? { templateFileId: excelTemplateFileId, sheetName: excelSheetName, dataStartRow: Number(excelDataStartRow) }
					: undefined,
		});
		if (!name.trim() || !result.success) {
			// 错误贴到字段(zod 的 path 带 fields 下标就落到那一行);结构性 / 名称问题留在顶部
			const top: string[] = [];
			const byKey: Record<string, string> = {};
			for (const issue of result.success ? [] : result.error.issues) {
				const [section, index] = issue.path;
				const key = section === "fields" && typeof index === "number" ? fields[index]?.key : undefined;
				if (key) {
					byKey[key] ??= issue.message;
					continue;
				}
				top.push(issue.message);
			}
			setError(!name.trim() ? "请填写模板名称" : (top[0] ?? "模板结构无效"));
			setFieldErrors(byKey);
			return;
		}
		setError("");
		setFieldErrors({});
		if (templateId) publish.mutate({ id: templateId, name: name.trim(), payload: result.data, shared });
		else create.mutate({ name: name.trim(), payload: result.data, shared });
	};

	const pending = create.isPending || publish.isPending || uploadingExcelTemplate;
	return (
		<TaskActionDialog
			open={open}
			onOpenChange={(next) => {
				if (!pending) {
					if (!next) setHeaderImportOpen(false);
					onOpenChange(next);
				}
			}}
			title={templateId ? `编辑填报模板 · ${name || "(未命名)"}` : "新增填报模板"}
			description={
				templateId
					? "保存会更新模板;已绑定的任务保留原有结构。"
					: "定义任务的填报表单结构;发布后供任务绑定。字段标识随名称自动生成,可手动修改。"
			}
			pending={pending}
			confirmDisabled={!editableTemplate}
			confirmText="发布模板"
			pendingText="发布中…"
			onConfirm={submit}
			contentClassName="sm:max-w-2xl"
			bodyClassName="space-y-2 py-1"
		>
			<DetailRow label="模板名称" htmlFor="report-template-name" align="center" className="py-1">
				<Input
					id="report-template-name"
					aria-label="模板名称"
					value={name}
					className="h-8"
					onChange={(event) => setName(event.target.value)}
				/>
			</DetailRow>
			<DetailRow label="可见性" align="center" className="py-1">
				<span className="flex items-center gap-2 text-sm text-muted-foreground">
					<Switch aria-label="所有人可见" checked={shared} onCheckedChange={(next) => setShared(next === true)} />
					{shared ? "所有人可见" : "仅自己可见"}
				</span>
			</DetailRow>
			<DetailRow label="填报形式" align="center" className="py-1">
				<RadioGroup
					value={kind}
					onValueChange={(value) => {
						const next = value === "TABLE" || value === "EXCEL" ? value : "OBJECT";
						setKind(next);
						if (next === "EXCEL") setFields([]);
						else if (fields.length === 0) setFields([newField()]);
					}}
				>
					<Radio value="OBJECT">表单</Radio>
					<Radio value="TABLE">表格</Radio>
					<Radio value="EXCEL">Excel 文件</Radio>
				</RadioGroup>
			</DetailRow>
			{kind === "EXCEL" ? (
				<div className="grid gap-2 rounded-md border border-border p-3">
					<DetailRow label="工作簿模板" align="center" className="py-0">
						<div className="flex min-w-0 items-center gap-2">
							<Input
								id={excelTemplateInputId}
								className="sr-only"
								type="file"
								accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
								disabled={uploadingExcelTemplate || pending}
								onChange={(event) => {
									void uploadExcelTemplate(event.target.files?.[0]);
									event.currentTarget.value = "";
								}}
							/>
							<Button
								variant="outline"
								size="sm"
								disabled={uploadingExcelTemplate || pending}
								onClick={() => document.getElementById(excelTemplateInputId)?.click()}
							>
								<FileSpreadsheet className="size-3.5" />
								{uploadingExcelTemplate ? "上传中…" : excelTemplateFileId ? "更换工作簿" : "选择工作簿"}
							</Button>
							{excelTemplateFileId ? (
								<button
									type="button"
									className="min-w-0 truncate text-left text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
									title="预览工作簿模板"
									disabled={uploadingExcelTemplate || pending}
									onClick={() => setExcelPreviewOpen(true)}
								>
									{excelTemplateFileName || "已关联工作簿模板"}
								</button>
							) : (
								<span className="truncate text-xs text-muted-foreground">仅支持 .xlsx，最大 5 MB</span>
							)}
						</div>
					</DetailRow>
					<DetailRow label="汇总工作表" align="center" className="py-0">
						<Select value={excelSheetName || null} onValueChange={(value) => setExcelSheetName(value ?? "")}>
							<SelectTrigger className="h-8" aria-label="汇总工作表">
								<SelectValue placeholder="选择工作表" />
							</SelectTrigger>
							<SelectContent>
								{excelSheetNames.map((sheet) => (
									<SelectItem key={sheet} value={sheet}>
										{sheet}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailRow>
					<DetailRow label="数据起始行" align="center" className="py-0">
						<Input
							aria-label="数据起始行"
							className="h-8 max-w-32"
							type="number"
							min={1}
							max={10000}
							step={1}
							value={excelDataStartRow}
							onChange={(event) => setExcelDataStartRow(event.target.value)}
						/>
						<span className="ml-2 text-xs text-muted-foreground">从此行到最后一个非空行按数据汇总</span>
					</DetailRow>
					<p className="text-xs text-muted-foreground">子任务上传同结构工作簿；起始行之前的表头会保留。</p>
				</div>
			) : null}
			{kind !== "EXCEL" && (
				<div className="space-y-1.5">
					<div className="flex items-center justify-between">
						<span className="text-sm font-medium">
							字段
							<span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
								{fields.length} / 100
							</span>
						</span>
						<div className="flex items-center gap-1.5">
							{!templateId ? (
								<Button
									variant="ghost"
									size="sm"
									disabled={fields.length >= 100}
									onClick={() => setHeaderImportOpen(true)}
								>
									<FileSpreadsheet className="size-3.5" />从 Excel 导入
								</Button>
							) : null}
							<Button variant="outline" size="sm" disabled={fields.length >= 100} onClick={addField}>
								添加字段
							</Button>
						</div>
					</div>
					{fields.map((field, index) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: 行只承载拖放(HTML5 DnD);真正可操作的是把手与各输入框
						<div
							key={field.key}
							draggable
							onDragStart={() => setDragIndex(index)}
							onDragEnd={() => {
								setDragIndex(null);
								setOverIndex(null);
							}}
							onDragOver={(event) => {
								event.preventDefault();
								setOverIndex(index);
							}}
							onDrop={(event) => {
								event.preventDefault();
								if (dragIndex !== null) reorder(dragIndex, index);
								setDragIndex(null);
								setOverIndex(null);
							}}
							className={cn(
								"space-y-1.5 rounded-md border p-2",
								fieldErrors[field.key] ? "border-destructive" : "border-border",
								dragIndex === index && "opacity-50",
								overIndex === index && dragIndex !== null && dragIndex !== index
									? "bg-brand-faint ring-1 ring-primary/40"
									: "",
							)}
						>
							<ReportFieldRow
								prefix="字段"
								handle={
									<GripVertical aria-hidden="true" className="size-3.5 shrink-0 cursor-grab text-muted-foreground/50" />
								}
								index={index}
								field={field}
								typeOptions={FIELD_TYPES}
								dictionaries={dictionaries.data ?? []}
								dictionariesLoading={dictionaries.isPending}
								dictionariesError={dictionaries.isError}
								showAllowEmpty
								deriveId={slugId}
								onPatch={(patch) => update(field.key, patch as Partial<Field>)}
								onRemove={() => setFields(fields.filter((item) => item.key !== field.key))}
								removeDisabled={fields.length === 1}
							/>
							{field.type === "array" && (
								<div className="space-y-1.5 rounded-md border border-dashed border-border p-2">
									<div className="flex items-center justify-between gap-2">
										<span className="text-xs font-medium text-muted-foreground">数组内的字段(至少 1 个;不带数组)</span>
										<Button
											variant="outline"
											size="sm"
											disabled={field.itemFields.length >= 50}
											onClick={() => addItem(field.key)}
										>
											添加元素字段
										</Button>
									</div>
									{field.itemFields.map((item, itemIndex) => (
										<div key={item.key} className="flex flex-wrap items-center gap-2">
											<ReportFieldRow
												prefix="元素字段"
												index={itemIndex}
												field={item}
												typeOptions={ITEM_TYPES}
												dictionaries={dictionaries.data ?? []}
												dictionariesLoading={dictionaries.isPending}
												dictionariesError={dictionaries.isError}
												deriveId={slugId}
												onPatch={(patch) => updateItem(field.key, item.key, patch as Partial<ItemField>)}
												onRemove={() => removeItem(field.key, item.key)}
												removeDisabled={field.itemFields.length === 1}
											/>
										</div>
									))}
								</div>
							)}
							{fieldErrors[field.key] ? <p className="text-xs text-destructive">{fieldErrors[field.key]}</p> : null}
						</div>
					))}
				</div>
			)}
			{(!editableTemplate || error) && (
				<p role="alert" className="text-sm text-destructive">
					{!editableTemplate ? "模板不可用或无权编辑，请关闭后刷新。" : error}
				</p>
			)}
			{!templateId ? (
				<Suspense fallback={null}>
					<TaskReportHeaderImportDialog
						open={headerImportOpen}
						onOpenChange={setHeaderImportOpen}
						remaining={Math.max(0, 100 - fields.length)}
						onImport={importFieldsFromHeaders}
					/>
				</Suspense>
			) : null}
			<TaskReportExcelTemplatePreview
				fileId={excelTemplateFileId}
				fileName={excelTemplateFileName || "工作簿模板.xlsx"}
				open={excelPreviewOpen}
				onOpenChange={setExcelPreviewOpen}
			/>
		</TaskActionDialog>
	);
}
