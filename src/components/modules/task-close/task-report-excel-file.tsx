import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CloudUpload, Download, FileSpreadsheet, Upload } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { ReportSection } from "#/components/modules/task-close/report-section";
import type { ReportData } from "#/components/modules/task-close/report-types";
import { TaskReportExcel } from "#/components/modules/task-close/task-report-excel";
import { useAttachmentPreview } from "#/components/modules/task-close/use-attachment-preview";
import { Button } from "#/components/ui/button";
import { useFileUpload } from "#/hooks/use-file-upload";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError, trpcErrorCode } from "#/lib/api/error";
import { formatBytes } from "#/lib/format";
import { isRecord } from "#/lib/task/json";
import { MAX_REPORT_FILE_BYTES, type TaskReportSchema } from "#/lib/task/report-spec";

type ExcelTaskReportSchema = Omit<TaskReportSchema, "kind"> & { kind: "EXCEL" };

/** Excel 工作簿独立填报：文件引用作为草稿，保存和提交仍走任务填报接口。 */
export function TaskReportExcelFile({
	taskId,
	schema,
	data,
	parentControls,
}: {
	taskId: string;
	schema: ExcelTaskReportSchema;
	data: ReportData;
	parentControls?: (disabled: boolean) => ReactNode;
}) {
	const trpc = useTRPC();
	const client = useQueryClient();
	const inputRef = useRef<HTMLInputElement>(null);
	const { upload } = useFileUpload();
	const [snapshot, setSnapshot] = useState(() => ({
		fileId: isRecord(data.report.draft) && typeof data.report.draft.fileId === "string" ? data.report.draft.fileId : "",
		revision: data.report.revision,
	}));
	const { fileId, revision } = snapshot;
	const [pendingFile, setPendingFile] = useState<{ id: string; name: string } | null>(null);
	const [conflicted, setConflicted] = useState(false);
	const [uploading, setUploading] = useState(false);
	const remoteChanged = data.report.revision > revision;
	const file = data.files.find((item) => item.id === fileId);
	const preview = useAttachmentPreview<ReportData["files"][number]>(taskId);
	const save = useMutation(
		trpc.taskClose.reportSaveDraft.mutationOptions({
			onSuccess: async (result, variables) => {
				const draft = variables.draft;
				setSnapshot({
					revision: result.revision,
					fileId: isRecord(draft) && typeof draft.fileId === "string" ? draft.fileId : "",
				});
				setPendingFile(null);
				setConflicted(false);
				await client.invalidateQueries(trpc.taskClose.reportGet.queryFilter({ taskId }));
				toast.success("Excel 填报已保存");
			},
			onError: (error) => {
				if (trpcErrorCode(error) === "CONFLICT") setConflicted(true);
				toastApiError(error);
			},
		}),
	);
	const submit = useMutation(
		trpc.taskClose.reportSubmitToParent.mutationOptions({
			onSuccess: async ({ pushed }) => {
				await Promise.all([
					client.invalidateQueries(trpc.taskClose.reportGet.queryFilter()),
					client.invalidateQueries(trpc.taskClose.logList.queryFilter({ taskId })),
				]);
				toast.success(`已提交 ${pushed} 个工作簿给父任务`);
			},
			onError: toastApiError,
		}),
	);
	const busy = uploading || save.isPending || submit.isPending;
	const pickFile = async (next?: File) => {
		if (!next) return;
		if (!next.name.toLowerCase().endsWith(".xlsx")) {
			toast.error("请选择 .xlsx 工作簿");
			return;
		}
		if (next.size > MAX_REPORT_FILE_BYTES) {
			toast.error("工作簿不能超过 5 MB");
			return;
		}
		setUploading(true);
		const result = await upload(next, "private");
		setUploading(false);
		if (!result.ok) {
			toast.error(result.message);
			return;
		}
		setPendingFile({ id: result.row.id, name: next.name });
		try {
			await save.mutateAsync({ taskId, revision, draft: { fileId: result.row.id } });
		} catch {
			/* 保留所选文件，供重新载入后重试。 */
		}
	};
	const reloadSnapshot = async () => {
		try {
			const latest = await client.fetchQuery({ ...trpc.taskClose.reportGet.queryOptions({ taskId }), staleTime: 0 });
			if (!latest) throw new Error("任务没有填报");
			setSnapshot({
				revision: latest.report.revision,
				fileId:
					isRecord(latest.report.draft) && typeof latest.report.draft.fileId === "string"
						? latest.report.draft.fileId
						: "",
			});
			setConflicted(false);
		} catch (error) {
			toastApiError(error);
		}
	};
	const downloadFile = async () => {
		if (!fileId) return;
		try {
			const result = await client.fetchQuery(
				trpc.taskClose.attachmentUrl.queryOptions({ taskId, fileId, download: true }),
			);
			window.open(result.url, "_blank", "noopener,noreferrer");
		} catch (error) {
			toastApiError(error);
		}
	};
	return (
		<ReportSection
			compact
			title="Excel 工作簿填报"
			actions={
				<div className="flex flex-wrap items-center gap-1">
					{parentControls?.(busy || conflicted || remoteChanged || !!pendingFile)}
					<TaskReportExcel taskId={taskId} schema={schema} canEdit={false} disabled={busy} />
					{data.canSubmitToParent && data.canEdit ? (
						<Button
							variant="ghost"
							size="sm"
							disabled={
								busy ||
								conflicted ||
								remoteChanged ||
								!!pendingFile ||
								(data.hasChildren ? data.excelSources.length === 0 : !fileId)
							}
							onClick={() => submit.mutate({ taskId })}
						>
							<CloudUpload className="size-3.5" />
							{submit.isPending ? "提交中…" : "提交给父任务"}
						</Button>
					) : null}
				</div>
			}
		>
			{conflicted || remoteChanged ? (
				<div role="alert" className="mb-2 flex flex-wrap items-center gap-2 text-sm text-destructive">
					填报已被修改，请重新载入后再保存。
					<Button variant="outline" size="sm" disabled={busy} onClick={() => void reloadSnapshot()}>
						重新载入
					</Button>
				</div>
			) : null}
			{pendingFile ? (
				<div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					待保存：{pendingFile.name}
					<Button
						variant="outline"
						size="sm"
						disabled={busy || conflicted || remoteChanged}
						onClick={() => save.mutate({ taskId, revision, draft: { fileId: pendingFile.id } })}
					>
						重试保存
					</Button>
				</div>
			) : null}
			{data.canSubmitToParent ? (
				<p className="mb-2 text-xs text-muted-foreground">本级变化需重新提交，父任务才能看到。</p>
			) : null}
			<div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
				{data.canEdit ? (
					<>
						<input
							ref={inputRef}
							type="file"
							accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
							className="sr-only"
							aria-label="上传 Excel 填报"
							disabled={busy || conflicted || remoteChanged}
							onChange={(event) => {
								void pickFile(event.target.files?.[0]);
								event.currentTarget.value = "";
							}}
						/>
						<Button
							variant="outline"
							size="sm"
							disabled={busy || conflicted || remoteChanged}
							onClick={() => inputRef.current?.click()}
						>
							<Upload className="size-3.5" />
							{uploading ? "上传中…" : fileId ? "更换文件" : "上传填报文件"}
						</Button>
					</>
				) : null}
				{file ? (
					<>
						<FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
						<button
							type="button"
							className="min-w-0 flex-1 truncate text-left text-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
							title={`预览 ${file.name}`}
							disabled={busy}
							onClick={() => preview.preview(file)}
						>
							{file.name}
						</button>
						<span className="text-xs text-muted-foreground">{formatBytes(Number(file.size))}</span>
						<Button variant="ghost" size="sm" disabled={busy} onClick={downloadFile}>
							<Download className="size-3.5" />
							下载原文件
						</Button>
					</>
				) : (
					<span className="text-sm text-muted-foreground">
						{data.canEdit ? "上传符合模板结构的 .xlsx 文件；系统会检查工作表与表头。" : "尚未上传填报文件。"}
					</span>
				)}
			</div>
			{preview.dialog}
		</ReportSection>
	);
}

/** 父级汇总只展示每份子任务文件的归属与状态，合并内容通过「导出填报」下载。 */
export function TaskReportExcelSummary({
	taskId,
	schema,
	data,
}: {
	taskId: string;
	schema: ExcelTaskReportSchema;
	data: ReportData;
}) {
	const files = new Map(data.files.map((file) => [file.id, file]));
	const preview = useAttachmentPreview<ReportData["files"][number]>(taskId);
	return (
		<ReportSection
			compact
			title="子任务 Excel 汇总"
			actions={<TaskReportExcel taskId={taskId} schema={schema} canEdit={false} />}
		>
			{data.excelSources.length === 0 ? (
				<p className="text-sm text-muted-foreground">还没有可汇总的子任务文件。</p>
			) : (
				<div className="divide-y divide-border rounded-md border border-border">
					{data.excelSources.map((source) => (
						<div
							key={`${source.taskId}:${source.fileId}`}
							className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm"
						>
							<FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
							<span className="w-32 shrink-0 truncate text-muted-foreground">{source.ownerName}</span>
							{files.get(source.fileId) ? (
								<button
									type="button"
									className="min-w-0 flex-1 truncate text-left text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
									title={`预览 ${files.get(source.fileId)?.name}`}
									onClick={() => {
										const file = files.get(source.fileId);
										if (file) preview.preview(file);
									}}
								>
									{files.get(source.fileId)?.name}
								</button>
							) : (
								<span className="min-w-0 flex-1 truncate text-muted-foreground">工作簿不可用</span>
							)}
							<span className="shrink-0 text-xs text-muted-foreground">{source.submitted ? "已提交" : "待提交"}</span>
						</div>
					))}
				</div>
			)}
			{preview.dialog}
		</ReportSection>
	);
}
