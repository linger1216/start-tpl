import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { pinyin } from "pinyin-pro";
import { useEffect, useState } from "react";
import { ActionIconButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
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
import { Radio, RadioGroup } from "#/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { TagInput } from "#/components/ui/tag-input";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { type TaskReportSchema, taskReportSchema } from "#/lib/task-report-spec";
import { cn } from "#/lib/utils";

const FIELD_TYPES = [
	{ value: "text", label: "文本" },
	{ value: "integer", label: "整数" },
	{ value: "decimal", label: "小数" },
	{ value: "date", label: "日期" },
	{ value: "datetime", label: "日期时间" },
	{ value: "select", label: "单选" },
	{ value: "multiselect", label: "多选" },
] as const;
type FieldType = (typeof FIELD_TYPES)[number]["value"];
type Field = {
	key: string;
	id: string;
	/** 用户是否手动改过标识 —— 改过就不再随名称自动生成 */
	idEdited: boolean;
	label: string;
	type: FieldType;
	required: boolean;
	/** 单选:是否允许填「空」(下拉里多一个「（空）」项) */
	allowEmpty: boolean;
	/** 单选 / 多选的候选值(直接喂给 `ui/tag-input` 的 TagInput) */
	options: string[];
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
		trpc.taskClose.reportTemplatePublish.mutationOptions({
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
	const submit = () => {
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
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle>{templateId ? `编辑填报模板 · ${name || "(未命名)"}` : "新增填报模板"}</DialogTitle>
					<DialogDescription>
						{templateId
							? "保存即覆盖当前结构;已绑定的任务会使用新结构填报。"
							: "定义任务的填报表单结构;发布后供任务绑定。字段标识随名称自动生成,可手动修改。"}
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="space-y-3 py-1">
					<DetailRow label="模板名称" htmlFor="report-template-name">
						<Input
							id="report-template-name"
							aria-label="模板名称"
							value={name}
							className="h-8"
							onChange={(event) => setName(event.target.value)}
						/>
					</DetailRow>
					<DetailRow label="可见性">
						<span className="flex items-center gap-2 text-sm text-muted-foreground">
							<Switch aria-label="所有人可见" checked={shared} onCheckedChange={(next) => setShared(next === true)} />
							{shared ? "所有人可见" : "仅自己可见"}
						</span>
					</DetailRow>
					<DetailRow label="填报形式">
						<RadioGroup value={kind} onValueChange={(value) => setKind(value === "TABLE" ? "TABLE" : "OBJECT")}>
							<Radio value="OBJECT">表单</Radio>
							<Radio value="TABLE">表格</Radio>
						</RadioGroup>
					</DetailRow>
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">
								字段
								<span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
									{fields.length} / 100
								</span>
							</span>
							<Button variant="outline" size="sm" disabled={fields.length >= 100} onClick={addField}>
								添加字段
							</Button>
						</div>
						{fields.map((field, index) => (
							<div
								key={field.key}
								className={cn(
									"space-y-2 rounded-md border p-2.5",
									fieldErrors[field.key] ? "border-destructive" : "border-border",
								)}
							>
								<div className="flex flex-wrap items-center gap-2">
									<span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
										{index + 1}
									</span>
									<Input
										aria-label={`字段 ${index + 1} 名称`}
										placeholder="字段名称"
										value={field.label}
										className="h-8 min-w-40 flex-1"
										onChange={(event) => {
											const label = event.target.value;
											// 标识没被手动改过就随名称自动生成(pinyin 预填),改过则只更新名称
											update(field.key, { label, ...(field.idEdited ? {} : { id: slugId(label) }) });
										}}
									/>
									<Input
										aria-label={`字段 ${index + 1} 标识`}
										placeholder="自动生成,可修改"
										value={field.id}
										className="h-8 w-32 font-mono text-xs"
										onChange={(event) => update(field.key, { id: event.target.value, idEdited: true })}
									/>
									<Select
										items={FIELD_TYPES}
										value={field.type}
										onValueChange={(value) => update(field.key, { type: (value ?? "text") as FieldType })}
									>
										<SelectTrigger aria-label={`字段 ${index + 1} 类型`} size="sm" className="w-28">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{FIELD_TYPES.map((type) => (
												<SelectItem key={type.value} value={type.value}>
													{type.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
										<Checkbox
											aria-label={`字段 ${index + 1} 必填`}
											checked={field.required}
											onCheckedChange={(required) => update(field.key, { required, allowEmpty: false })}
										/>
										必填
									</span>
									{field.type === "select" && (
										<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
											<Checkbox
												aria-label={`字段 ${index + 1} 允许为空`}
												checked={field.allowEmpty}
												onCheckedChange={(allowEmpty) => update(field.key, { allowEmpty, required: false })}
											/>
											允许为空
										</span>
									)}
									<ActionIconButton
										label={`删除字段 ${index + 1}`}
										tone="danger"
										disabled={fields.length === 1}
										onClick={() => setFields(fields.filter((item) => item.key !== field.key))}
									>
										<X className="size-3.5" />
									</ActionIconButton>
								</div>
								{(field.type === "select" || field.type === "multiselect") && (
									<TagInput
										value={field.options.map((value) => ({ value }))}
										onChange={(next) => update(field.key, { options: next.map((entry) => entry.value) })}
										max={100}
										placeholder="选项,逗号分隔或逐条回车添加(至少 1 项,不能重复)"
									/>
								)}
								{fieldErrors[field.key] ? <p className="text-xs text-destructive">{fieldErrors[field.key]}</p> : null}
							</div>
						))}
					</div>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
				</DialogBody>

				<DialogFooter>
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button disabled={pending} onClick={submit}>
						{pending ? "发布中…" : "发布模板"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
