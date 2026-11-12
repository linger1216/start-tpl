import { Checkbox } from "#/components/ui/checkbox";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import type { TaskReportSchema } from "#/lib/task-report-spec";

/** 字段类型码 → 中文名(预览与字段清单共用一份,别在调用点再抄) */
export const REPORT_FIELD_TYPE_LABELS: Record<TaskReportSchema["fields"][number]["type"], string> = {
	text: "文本",
	integer: "整数",
	decimal: "小数",
	date: "日期",
	datetime: "日期时间",
	select: "单选",
	multiselect: "多选",
};

/**
 * 填报模板的**只读预览** —— 按schema渲染出「填报人将会看到的表单」。
 *
 * 所有控件一律 disabled:预览只回答「长什么样、什么顺序、哪些必填」,不在这里填值。
 * OBJECT 渲染成竖排表单;TABLE 渲染成「表头 + 一条空行」的网格。
 */
export function TaskReportPreview({ schema }: { schema: TaskReportSchema }) {
	return (
		<div className="space-y-3">
			<p className="text-xs text-muted-foreground">预览只读 —— 填报时的控件与顺序即此。</p>
			{schema.kind === "TABLE" ? (
				<div className="overflow-x-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								{schema.fields.map((field) => (
									<TableHead key={field.id}>{previewLabel(field)}</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableRow>
								{schema.fields.map((field) => (
									<TableCell key={field.id} className="text-muted-foreground">
										—
									</TableCell>
								))}
							</TableRow>
						</TableBody>
					</Table>
				</div>
			) : (
				<div className="space-y-0">
					{schema.fields.map((field) => (
						<DetailRow key={field.id} label={previewLabel(field)}>
							<PreviewControl field={field} />
						</DetailRow>
					))}
				</div>
			)}
		</div>
	);
}

/** 展示名:必填字段带星标 */
function previewLabel(field: TaskReportSchema["fields"][number]): string {
	return field.required ? `${field.label} *` : field.label;
}

/** 按类型渲染一个**禁用**的占位控件(值一律为空) */
function PreviewControl({ field }: { field: TaskReportSchema["fields"][number] }) {
	switch (field.type) {
		case "integer":
			return <Input type="number" placeholder="0" disabled className="h-8 max-w-48" />;
		case "decimal":
			return <Input type="number" step="any" placeholder="0.00" disabled className="h-8 max-w-48" />;
		case "date":
			return <Input type="date" disabled className="h-8 max-w-48" />;
		case "datetime":
			return <Input type="datetime-local" disabled className="h-8 max-w-48" />;
		case "select":
			return (
				<Select
					items={[
						...(field.allowEmpty ? [{ value: null, label: "（空）" }] : []),
						...(field.options ?? []).map((option) => ({ value: option, label: option })),
					]}
					disabled
				>
					<SelectTrigger aria-label={`${field.label} 选项`} disabled className="h-8 max-w-48">
						<SelectValue placeholder="从选项中选择" />
					</SelectTrigger>
					<SelectContent>
						{field.allowEmpty && <SelectItem value={null}>（空）</SelectItem>}
						{(field.options ?? []).map((option) => (
							<SelectItem key={option} value={option}>
								{option}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case "multiselect":
			return (
				<span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
					{(field.options ?? []).map((option) => (
						<span key={option} className="flex items-center gap-1.5 text-sm">
							<Checkbox disabled /> {option}
						</span>
					))}
				</span>
			);
		default:
			return <Input placeholder="文本" disabled className="h-8 max-w-72" />;
	}
}
