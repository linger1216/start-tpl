import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, FileText, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { StatItem } from "#/components/modules/shared/stat-cards";
import { TaskReportTemplateDetail } from "#/components/modules/task-close/task-report-template-detail";
import { TaskReportTemplateForm } from "#/components/modules/task-close/task-report-template-form";
import { TemplateCard, TemplateCardPageShell } from "#/components/modules/task-close/template-card";
import { useConfirm } from "#/components/modules/task-close/use-confirm";

import { Tag } from "#/components/ui/tag";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { taskReportSchema } from "#/lib/task/report-spec";
import { formatLocalMinute } from "#/lib/time";

/** 卡片页用到的模板投影:`reportTemplateList` 的一行(与 `workflowList` 同形,时间一律 ISO) */
export type ReportTemplateRow = {
	id: string;
	name: string;
	creator_id: string;
	payload: unknown;
	shared: number;
	canManage: boolean;
	createdAt: string | null;
	updatedAt: string | null;
};

/** 把 `payload` 解成模板定义(解析失败给空结构,卡片显示「结构无效」) */
function parsedReportTemplate(row: ReportTemplateRow) {
	const result = taskReportSchema.safeParse(row.payload);
	return result.success ? result.data : { kind: "OBJECT" as const, fields: [] };
}

/**
 * 任务闭环 ▸ 填报模板 —— 卡片页(与「流程模板」同款版式)。
 *
 * 模板是**单版本**:编辑即覆盖 `payload`,已绑定任务保留结构快照。
 * 授权走按钮权限点(`sys:tc_report_template:add/edit/remove`),按钮只是可见性投影,真正拦截在服务端。
 */
export function TaskReportTemplatesPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const canAdd = useHasPerm("sys:tc_report_template:add");
	const canEdit = useHasPerm("sys:tc_report_template:edit");
	const canRemove = useHasPerm("sys:tc_report_template:remove");

	const [form, setForm] = useState<{ templateId: string | null } | null>(null);
	const [detailId, setDetailId] = useState<string | null>(null);
	const del = useConfirm<ReportTemplateRow>();

	const listQuery = useQuery(trpc.taskClose.reportTemplateList.queryOptions());

	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.reportTemplateList.queryFilter());
	const removeMutation = useMutation(
		trpc.taskClose.reportTemplateRemove.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: del.dismiss,
				message: () => "模板已删除,已有任务保留原结构",
			}),
			onError: toastApiError,
		}),
	);

	const rows = useMemo(() => (listQuery.data ?? []) as ReportTemplateRow[], [listQuery.data]);
	const detailRow = rows.find((row) => row.id === detailId) ?? null;

	const stats = useMemo<StatItem[]>(() => {
		const sums = rows.reduce(
			(acc, row) => {
				const def = parsedReportTemplate(row);
				return {
					fields: acc.fields + def.fields.length,
					shared: acc.shared + (row.shared === 1 ? 1 : 0),
				};
			},
			{ fields: 0, shared: 0 },
		);
		return [
			{
				key: "templates",
				label: "填报模板",
				value: listQuery.isError ? "—" : rows.length,
				Icon: FileText,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
			},
			{
				key: "fields",
				label: "字段",
				value: listQuery.isError ? "—" : sums.fields,
				Icon: ClipboardList,
				tone: "bg-hue-violet-soft text-hue-violet-fg",
			},
			{
				key: "shared",
				label: "分享中",
				value: listQuery.isError ? "—" : sums.shared,
				Icon: Share2,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
			},
		];
	}, [rows, listQuery.isError]);

	const openEdit = (row: ReportTemplateRow) => setForm({ templateId: row.id });
	const openCreate = () => setForm({ templateId: null });

	return (
		<TemplateCardPageShell
			title="填报模板"
			description="任务的填报表单结构：字段集合与类型。编辑影响后续绑定，已绑定任务保留原有结构。"
			stats={stats}
			emptyIcon={<FileText className="size-6" />}
			emptyDescription="填报模板定义任务的表单结构(字段 / 类型 / 必填)。建任务时绑定模板，执行人按任务的结构快照填报。"
			isEmpty={rows.length === 0}
			isPending={listQuery.isPending}
			isError={listQuery.isError}
			isFetching={listQuery.isFetching}
			canAdd={canAdd}
			onCreate={openCreate}
			onRefresh={() => void listQuery.refetch()}
			cards={rows.map((row) => (
				<ReportTemplateCard
					key={row.id}
					row={row}
					canEdit={canEdit && row.canManage}
					canRemove={canRemove && row.canManage}
					onView={() => setDetailId(row.id)}
					onEdit={() => openEdit(row)}
					onDelete={() => del.ask(row)}
				/>
			))}
		>
			<TaskReportTemplateForm
				open={form !== null}
				onOpenChange={(next) => {
					if (!next) setForm(null);
				}}
				templates={listQuery.data ?? []}
				initialTemplateId={form?.templateId ?? null}
			/>

			<TaskReportTemplateDetail
				row={detailRow}
				open={detailId !== null}
				onOpenChange={(next) => {
					if (!next) setDetailId(null);
				}}
				onEdit={
					canEdit && detailRow?.canManage
						? (row) => {
								setDetailId(null);
								openEdit(row);
							}
						: undefined
				}
			/>

			<del.Dialog
				title="删除填报模板"
				description={(t) => `「${t.name}」会被软删,列表里不再出现;已绑定任务的填报数据保留,但不能再用于新任务。`}
				isPending={removeMutation.isPending}
				onConfirm={(t) => removeMutation.mutate({ id: t.id })}
			/>
		</TemplateCardPageShell>
	);
}

/**
 * 一张模板卡片 —— 版式对齐「流程模板」卡:图标 + 分享标识/动作在同一行、标题 + 一行说明、
 * 一块浅底预览(字段清单,必填带星标)、底部 meta 胶囊。**整卡可点开详情**,行内动作 `stopPropagation`。
 */
function ReportTemplateCard({
	row,
	canEdit,
	canRemove,
	onView,
	onEdit,
	onDelete,
}: {
	row: ReportTemplateRow;
	canEdit: boolean;
	canRemove: boolean;
	onView: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const def = parsedReportTemplate(row);
	return (
		<TemplateCard
			name={row.name || "(未命名模板)"}
			viewLabel={`查看填报模板 ${row.name}`}
			icon={<FileText className="size-4.5" />}
			badge={
				row.shared === 1 ? (
					<Tag variant="secondary" className="h-7 gap-1 px-2 text-xs">
						<Share2 className="size-3" aria-hidden />
						分享
					</Tag>
				) : (
					<span className="flex h-7 items-center px-2 text-xs text-muted-foreground">仅自己</span>
				)
			}
			description={
				<>
					{def.kind === "TABLE" ? "表格填报" : "表单填报"} · {def.fields.length} 个字段
				</>
			}
			preview={
				def.fields.length ? (
					<div className="flex flex-wrap items-center gap-1.5">
						{def.fields.map((field) => (
							<span
								key={field.id}
								title={field.id}
								className="inline-flex items-center gap-1 rounded-sm bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
							>
								{field.label}
								{field.required ? <span className="text-destructive">*</span> : null}
							</span>
						))}
					</div>
				) : (
					<span className="text-xs text-muted-foreground">结构无效或未定义字段</span>
				)
			}
			meta={
				<>
					<span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
						{row.updatedAt ? `更新于 ${formatLocalMinute(row.updatedAt)}` : PLACEHOLDER_EMPTY}
					</span>
					{row.canManage ? null : (
						<span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
							仅可查看
						</span>
					)}
				</>
			}
			canEdit={canEdit}
			canRemove={canRemove}
			onView={onView}
			onEdit={onEdit}
			onDelete={onDelete}
		/>
	);
}
