import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import {
	parsedReportTemplate,
	type ReportTemplateRow,
} from "#/components/modules/task-close/task-close-report-templates-page";
import { TaskReportPreview } from "#/components/modules/task-close/task-report-preview";
import { Tag } from "#/components/ui/tag";
import { taskReportSchema } from "#/lib/task-report-spec";

/**
 * 填报模板详情 —— **就是预览**:按 payload 渲染出「填报人会看到的表单」(只读),
 * 不单独列字段清单(字段数 / 可见性在卡片上,标识与选项在预览的控件与占位里)。
 */
export function TaskCloseReportTemplatesDetail({
	row,
	open,
	onOpenChange,
	onEdit,
}: {
	row: ReportTemplateRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: ReportTemplateRow) => void;
}) {
	const def = row ? parsedReportTemplate(row) : null;
	const parsed = row ? taskReportSchema.safeParse(row.payload) : null;
	return (
		<DetailDialog
			open={open}
			onOpenChange={onOpenChange}
			title={`填报模板 · ${row?.name ?? ""}`}
			description="编辑保存即覆盖当前结构,已绑定任务会用新结构填报。"
			tag={row ? <Tag variant="outline">{def?.kind === "TABLE" ? "表格" : "表单"}</Tag> : null}
			meta={
				row
					? {
							id: row.id,
							createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
							updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
						}
					: null
			}
			onEdit={() => row && onEdit(row)}
			editDisabled={row ? !row.canManage : false}
		>
			{row && parsed?.success ? (
				<TaskReportPreview schema={parsed.data} />
			) : (
				<p className="text-sm text-destructive">模板结构无效,无法展示;请联系管理员重建。</p>
			)}
		</DetailDialog>
	);
}
