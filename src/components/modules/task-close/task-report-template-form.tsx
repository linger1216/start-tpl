import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { pinyin } from "pinyin-pro";
import { useEffect, useState } from "react";
import { type DraftFieldLike, ReportFieldRow } from "#/components/modules/task-close/report-field-row";
import { TaskActionDialog } from "#/components/modules/task-close/task-action-dialog";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Radio, RadioGroup } from "#/components/ui/radio-group";
import { Switch } from "#/components/ui/switch";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import {
	REPORT_FIELD_TYPES,
	REPORT_TOP_FIELD_TYPES,
	type ReportFieldType,
	type ReportTopFieldType,
	type TaskReportSchema,
	taskReportSchema,
} from "#/lib/task/report-spec";
import { cn } from "#/lib/utils";

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
	const [kind, setKind] = useState<"OBJECT" | "TABLE">("OBJECT");
	const [fields, setFields] = useState<Field[]>([]);
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
			return;
		}
		const template = templates.find((item) => item.id === id && item.canManage);
		const parsed = taskReportSchema.safeParse(template?.payload);
		if (!template || !parsed.success) {
			setName("");
			setKind("OBJECT");
			setShared(false);
			setFields([]);
			setError("模板结构无效，无法编辑");
			return;
		}
		setName(template.name);
		setShared(template.shared === 1);
		setKind(parsed.data.kind);
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
		if (!editableTemplate) return;
		const result = taskReportSchema.safeParse({
			id: "report",
			kind,
			fields: fields.map((field) => ({
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

	const pending = create.isPending || publish.isPending;
	return (
		<TaskActionDialog
			open={open}
			onOpenChange={(next) => {
				if (!pending) onOpenChange(next);
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
				<RadioGroup value={kind} onValueChange={(value) => setKind(value === "TABLE" ? "TABLE" : "OBJECT")}>
					<Radio value="OBJECT">表单</Radio>
					<Radio value="TABLE">表格</Radio>
				</RadioGroup>
			</DetailRow>
			<div className="space-y-1.5">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">
						字段
						<span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">{fields.length} / 100</span>
					</span>
					<Button variant="outline" size="sm" disabled={fields.length >= 100} onClick={addField}>
						添加字段
					</Button>
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
			{(!editableTemplate || error) && (
				<p role="alert" className="text-sm text-destructive">
					{!editableTemplate ? "模板不可用或无权编辑，请关闭后刷新。" : error}
				</p>
			)}
		</TaskActionDialog>
	);
}
