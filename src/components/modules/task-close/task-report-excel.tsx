import { useMutation } from "@tanstack/react-query";
import { Download, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { downloadReportWorkbook } from "#/lib/task-report-download";
import type { TaskReportSchema } from "#/lib/task-report-spec";

/** 一次导入的结果:成功 / 失败条数 + 失败原因(最多列前几条) */
type ImportOutcome = { ok: number; failed: number; messages: string[] };

/**
 * Excel 导入 / 导出 —— 两种视角共用一个组件:
 * - `taskId`:任务详情里的填报(可导出当前数据);
 * - `reportId`:建任务前先拿模板填数据(只能下载模版 + 导入)。
 *
 * **交互**:「下载 Excel 模版」拿到单行中文表头的模版;「文件导入」直接开系统文件框,
 * 选完即解析 —— 通过就落值并报「成功 N 条 · 失败 M 条」,有失败行则整批不落值并列出原因。
 * 文件内容只在当前请求内解析,不落库。
 */
export function TaskReportExcel({
	taskId,
	reportId,
	schema,
	canEdit,
	disabled,
	onImport,
}: {
	taskId?: string;
	reportId?: string;
	schema: TaskReportSchema;
	canEdit: boolean;
	disabled: boolean;
	onImport: (value: unknown) => void;
}) {
	const trpc = useTRPC();
	const inputRef = useRef<HTMLInputElement>(null);
	const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

	/** 服务端只认一个:任务视角或模板视角(调用点保证传了其中之一) */
	const source = taskId ? { taskId } : { reportId: reportId ?? "" };
	const downloadTemplate = useMutation(
		trpc.taskClose.reportExcelDownload.mutationOptions({
			onSuccess: (result) => downloadReportWorkbook(result.fileBase64, "填报模版.xlsx"),
			onError: toastApiError,
		}),
	);
	const exportData = useMutation(
		trpc.taskClose.reportExcelDownload.mutationOptions({
			onSuccess: (result) => downloadReportWorkbook(result.fileBase64, "填报数据.xlsx"),
			onError: toastApiError,
		}),
	);
	const preview = useMutation(
		trpc.taskClose.reportExcelPreview.mutationOptions({
			onSuccess: (result) => {
				const rows = Array.isArray(result.value) ? result.value.length : result.value ? 1 : 0;
				const failedRows = new Set(result.issues.map((issue) => issue.row).filter((row) => row !== null));
				const failed = failedRows.size;
				setOutcome({
					ok: rows - failed,
					failed,
					messages: result.issues.slice(0, 5).map((issue) => {
						const field = schema.fields.find((item) => item.id === issue.field)?.label ?? issue.field;
						return `${issue.excelRow ? `第 ${issue.excelRow} 行 · ` : ""}${field}${field ? ":" : ""}${issue.message}`;
					}),
				});
				// 有失败行就整批不落值,改好文件再选一次
				if (failed === 0) onImport(result.value);
			},
			onError: (error) => {
				setOutcome(null);
				toastApiError(error);
			},
		}),
	);

	const chooseFile = async (file: File | undefined) => {
		if (!file) return;
		if (file.size > 5 * 1024 * 1024) {
			toast.error("文件不能超过 5 MB");
			return;
		}
		const bytes = new Uint8Array(await file.arrayBuffer());
		let raw = "";
		for (let offset = 0; offset < bytes.length; offset += 32768)
			raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
		setOutcome(null);
		preview.mutate({ ...source, fileBase64: btoa(raw) });
	};

	return (
		<div className="space-y-1.5">
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={downloadTemplate.isPending}
					onClick={() => downloadTemplate.mutate({ ...source, templateOnly: true })}
				>
					<Download className="size-3.5" />
					下载 Excel 模版
				</Button>
				{taskId && (
					<Button
						size="sm"
						variant="outline"
						disabled={exportData.isPending || disabled}
						onClick={() => exportData.mutate({ taskId, templateOnly: false })}
					>
						<Upload className="size-3.5" />
						导出当前填报
					</Button>
				)}
				{canEdit && (
					<Button
						size="sm"
						variant="outline"
						disabled={disabled || preview.isPending}
						onClick={() => inputRef.current?.click()}
					>
						<FileSpreadsheet className="size-3.5" />
						{preview.isPending ? "解析中…" : "文件导入"}
					</Button>
				)}
				<Input
					ref={inputRef}
					type="file"
					accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
					className="hidden"
					onChange={(event) => {
						void chooseFile(event.target.files?.[0]);
						event.target.value = "";
					}}
				/>
			</div>
			{outcome ? (
				<div className="space-y-1 rounded-lg border border-border bg-secondary/40 p-2.5 text-xs">
					<div className="font-medium text-foreground">
						成功 <span className="text-success-fg">{outcome.ok}</span> 条 · 失败{" "}
						<span className={outcome.failed > 0 ? "text-danger" : "text-muted-foreground"}>{outcome.failed}</span> 条
					</div>
					{outcome.messages.map((message) => (
						<p key={message} className="flex items-start gap-1 text-danger">
							<TriangleAlert className="mt-0.5 size-3 shrink-0" />
							<span>{message}</span>
						</p>
					))}
					{outcome.failed > 0 ? <p className="text-muted-foreground">改好文件再选一次。</p> : null}
				</div>
			) : null}
			{schema.fields.length > 0 ? (
				<p className="text-xs text-muted-foreground">列顺序:{schema.fields.map((field) => field.label).join(" / ")}</p>
			) : null}
		</div>
	);
}
