import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { TaskActionDialog } from "#/components/modules/task-close/task-action-dialog";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { type TaskReportSchema, taskReportSchema } from "#/lib/task-report-spec";

const FIELD_TYPES = [
	{ value: "text", label: "文本" },
	{ value: "integer", label: "整数" },
	{ value: "decimal", label: "小数" },
	{ value: "date", label: "日期" },
	{ value: "datetime", label: "日期时间" },
	{ value: "select", label: "单选" },
	{ value: "multiselect", label: "多选" },
	{ value: "boolean", label: "是否" },
] as const;
type FieldType = (typeof FIELD_TYPES)[number]["value"];
type Field = {
	key: string;
	id: string;
	label: string;
	type: FieldType;
	required: boolean;
	options: string;
	original?: TaskReportSchema["fields"][number];
};
const newField = (n: number): Field => ({
	key: crypto.randomUUID(),
	id: `field${n}`,
	label: "",
	type: "text",
	required: false,
	options: "",
});

export function TaskReportDesigner() {
	const trpc = useTRPC();
	const client = useQueryClient();
	const [open, setOpen] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const canRemove = useHasPerm("sys:tc_report_template:remove");
	const [templateId, setTemplateId] = useState("");
	const [baseVersionId, setBaseVersionId] = useState("");
	const [baseSchema, setBaseSchema] = useState<TaskReportSchema | null>(null);
	const templates = useQuery({ ...trpc.taskClose.reportTemplateList.queryOptions(), enabled: open });
	const [name, setName] = useState("");
	const [kind, setKind] = useState<"OBJECT" | "TABLE">("OBJECT");
	const [fields, setFields] = useState<Field[]>([]);
	const [error, setError] = useState("");
	const create = useMutation(
		trpc.taskClose.reportTemplateCreate.mutationOptions({
			onSuccess: () => {
				setOpen(false);
				void client.invalidateQueries(trpc.taskClose.reportTemplateList.queryFilter());
				toast.success("模板已发布");
			},
			onError: toastApiError,
		}),
	);
	const publish = useMutation(
		trpc.taskClose.reportTemplatePublish.mutationOptions({
			onSuccess: () => {
				setOpen(false);
				void client.invalidateQueries(trpc.taskClose.reportTemplateList.queryFilter());
				toast.success("新版本已发布，已有任务仍使用原版本");
			},
			onError: toastApiError,
		}),
	);
	const remove = useMutation(
		trpc.taskClose.reportTemplateRemove.mutationOptions({
			onSuccess: () => {
				setConfirmRemove(false);
				selectTemplate("");
				void client.invalidateQueries(trpc.taskClose.reportTemplateList.queryFilter());
				toast.success("模板已删除，已有任务保留原版本");
			},
			onError: toastApiError,
		}),
	);
	const selectTemplate = (id: string) => {
		setTemplateId(id);
		setBaseVersionId("");
		setError("");
		if (!id) {
			setName("");
			setKind("OBJECT");
			setBaseSchema(null);
			setFields([newField(1)]);
			return;
		}
		setBaseSchema(null);
		const template = templates.data?.find((item) => item.id === id && item.canManage);
		const parsed = taskReportSchema.safeParse(template?.versions[0]?.schema);
		if (!template || !parsed.success) {
			setError("模板结构无效，无法编辑");
			return;
		}
		setName(template.name);
		setBaseVersionId(template.versions[0].id);
		setKind(parsed.data.kind);
		setBaseSchema(parsed.data);
		setFields(
			parsed.data.fields.map((field) => ({
				key: crypto.randomUUID(),
				id: field.id,
				label: field.label,
				type: field.type,
				required: field.required,
				options: field.options?.join("，") ?? "",
				original: field,
			})),
		);
	};
	const update = (key: string, patch: Partial<Field>) =>
		setFields((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
	const submit = () => {
		const result = taskReportSchema.safeParse({
			...(baseSchema ?? { id: "report" }),
			kind,
			fields: fields.map((field) => ({
				...field.original,
				id: field.id.trim(),
				label: field.label.trim(),
				type: field.type,
				required: field.required,
				options:
					field.type === "select" || field.type === "multiselect"
						? field.original?.options && field.options === field.original.options.join("，")
							? field.original.options
							: field.options
									.split(/[,，\n]/)
									.map((item) => item.trim())
									.filter(Boolean)
						: undefined,
			})),
		});
		if (!name.trim() || !result.success) {
			setError(
				!name.trim()
					? "请填写模板名称"
					: ((!result.success ? result.error.issues[0]?.message : undefined) ?? "模板结构无效"),
			);
			return;
		}
		setError("");
		if (templateId)
			publish.mutate({ id: templateId, name: name.trim(), expectedVersionId: baseVersionId, schema: result.data });
		else create.mutate({ name: name.trim(), schema: result.data });
	};
	return (
		<>
			<Button
				size="sm"
				variant="outline"
				onClick={() => {
					selectTemplate("");
					setOpen(true);
				}}
			>
				管理填报模板
			</Button>
			<TaskActionDialog
				open={open}
				onOpenChange={setOpen}
				title="管理填报模板"
				description="选择已有模板可发布新版本，已绑定的任务继续使用原版本。"
				pending={create.isPending || publish.isPending}
				confirmDisabled={create.isPending || publish.isPending || (!!templateId && !baseSchema)}
				confirmText="发布模板"
				pendingText="发布中…"
				onConfirm={submit}
			>
				<DetailRow label="选择模板">
					<Select
						items={[
							{ value: "new", label: "新增模板" },
							...(templates.data ?? [])
								.filter((template) => template.canManage)
								.map((template) => ({ value: template.id, label: template.name })),
						]}
						value={templateId || "new"}
						onValueChange={(value) => selectTemplate(value === "new" ? "" : (value ?? ""))}
					>
						<SelectTrigger aria-label="选择模板">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="new">新增模板</SelectItem>
							{(templates.data ?? [])
								.filter((template) => template.canManage)
								.map((template) => (
									<SelectItem key={template.id} value={template.id}>
										{template.name}
									</SelectItem>
								))}
						</SelectContent>
					</Select>
				</DetailRow>
				{templateId && canRemove && (
					<DetailRow label="删除模板">
						<Button type="button" variant="destructive" size="sm" onClick={() => setConfirmRemove(true)}>
							删除模板
						</Button>
					</DetailRow>
				)}
				<DetailRow label="模板名称">
					<Input aria-label="模板名称" value={name} onChange={(event) => setName(event.target.value)} />
				</DetailRow>
				<DetailRow label="填报形式">
					<Select
						items={[
							{ value: "OBJECT", label: "表单" },
							{ value: "TABLE", label: "表格" },
						]}
						value={kind}
						onValueChange={(value) => setKind(value === "TABLE" ? "TABLE" : "OBJECT")}
					>
						<SelectTrigger aria-label="填报形式">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="OBJECT">表单</SelectItem>
							<SelectItem value="TABLE">表格</SelectItem>
						</SelectContent>
					</Select>
				</DetailRow>
				<div className="grid gap-3">
					<div className="flex items-center justify-between">
						<span className="text-sm font-medium">字段</span>
						<Button
							variant="outline"
							size="sm"
							disabled={fields.length >= 100}
							onClick={() => {
								let number = 1;
								while (fields.some((field) => field.id === `field${number}`)) number++;
								setFields([...fields, newField(number)]);
							}}
						>
							添加字段
						</Button>
					</div>
					{fields.map((field, index) => (
						<div key={field.key} className="grid gap-2 rounded-md border border-border p-3">
							<div className="flex items-center justify-between">
								<span className="text-sm font-medium">字段 {index + 1}</span>
								<Button
									variant="ghost"
									size="sm"
									disabled={fields.length === 1}
									onClick={() => setFields(fields.filter((item) => item.key !== field.key))}
								>
									删除
								</Button>
							</div>
							<Input
								aria-label={`字段 ${index + 1} 名称`}
								placeholder="字段名称"
								value={field.label}
								onChange={(event) => update(field.key, { label: event.target.value })}
							/>
							<Input
								aria-label={`字段 ${index + 1} 标识`}
								placeholder="字段标识，例如 amount"
								value={field.id}
								onChange={(event) => update(field.key, { id: event.target.value })}
							/>
							<Select
								items={FIELD_TYPES}
								value={field.type}
								onValueChange={(value) => update(field.key, { type: (value ?? "text") as FieldType })}
							>
								<SelectTrigger aria-label={`字段 ${index + 1} 类型`}>
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
							{(field.type === "select" || field.type === "multiselect") && (
								<Input
									aria-label={`字段 ${index + 1} 选项`}
									placeholder="选项，用逗号分隔"
									value={field.options}
									onChange={(event) => update(field.key, { options: event.target.value })}
								/>
							)}
							<span className="flex items-center gap-2 text-sm">
								<Checkbox
									aria-label={`字段 ${index + 1} 必填`}
									checked={field.required}
									onCheckedChange={(required) => update(field.key, { required })}
								/>
								必填
							</span>
						</div>
					))}
				</div>
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
			</TaskActionDialog>
			<ConfirmDialog
				open={confirmRemove}
				onOpenChange={setConfirmRemove}
				title="删除填报模板"
				description={`确定删除“${name}”？删除后无法用于新任务，已绑定的任务和填报数据会保留。`}
				isPending={remove.isPending}
				onConfirm={() => remove.mutate({ id: templateId })}
			/>
		</>
	);
}
