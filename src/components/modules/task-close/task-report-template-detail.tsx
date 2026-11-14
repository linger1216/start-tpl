import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { TaskReportPreview } from "#/components/modules/task-close/task-report-preview";
import type { ReportTemplateRow } from "#/components/modules/task-close/task-report-templates-page";
import { Tag } from "#/components/ui/tag";
import { taskReportSchema } from "#/lib/task-report-spec";

/**
 * 填报模板详情 —— **就是预览**:按 payload 渲染出「填报人会看到的表单」(只读),
 * 不单独列字段清单(字段数 / 可见性在卡片上,标识与选项在预览的控件与占位里)。
 */
export function TaskReportTemplateDetail({
	row,
	open,
	onOpenChange,
	onEdit,
}: {
	row: ReportTemplateRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit?: (row: ReportTemplateRow) => void;
}) {
	const parsed = row ? taskReportSchema.safeParse(row.payload) : null;
	return (
		<DetailDialog
			open={open}
			onOpenChange={onOpenChange}
			title={`填报模板 · ${row?.name ?? ""}`}
			description="编辑影响后续绑定；已绑定任务保留原有结构。"
			tag={parsed?.success ? <Tag variant="outline">{parsed.data.kind === "TABLE" ? "表格" : "表单"}</Tag> : null}
			meta={
				row
					? {
							id: row.id,
							createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
							updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
						}
					: null
			}
			onEdit={row && onEdit ? () => onEdit(row) : undefined}
		>
			{row && parsed?.success ? (
				<TaskReportPreview schema={parsed.data} />
			) : (
				<p className="text-sm text-destructive">模板结构无效,无法展示;请联系管理员重建。</p>
			)}
		</DetailDialog>
	);
}
