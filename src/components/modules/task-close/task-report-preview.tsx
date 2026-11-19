import { ReportField } from "#/components/modules/task-close/report-fields";
import { DetailRow } from "#/components/ui/detail-row";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { MAX_ATTACHMENTS } from "#/lib/task/payload";
import type { TaskReportSchema } from "#/lib/task/report-spec";

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
			{schema.kind === "EXCEL" ? (
				<div className="grid gap-2 rounded-md border border-border p-3 text-sm">
					<p>子任务上传 Excel 工作簿；系统保留模板表头并合并数据行。</p>
					<p className="text-muted-foreground">
						汇总工作表：{schema.excel?.sheetName} · 数据从第 {schema.excel?.dataStartRow} 行开始
					</p>
				</div>
			) : schema.kind === "TABLE" ? (
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
	if (field.type === "attachment")
		return <span className="text-sm text-muted-foreground">附件:填报时上传(最多 {MAX_ATTACHMENTS} 个)</span>;
	if (field.type === "array")
		return (
			<span className="text-sm text-muted-foreground">
				数组:填报时可「添加」多条 ——
				{(field.itemFields ?? []).map((item) => item.label).join(" / ") || "未配置元素字段"}
			</span>
		);
	return <ReportField field={field} value={undefined} disabled onChange={() => {}} />;
}
