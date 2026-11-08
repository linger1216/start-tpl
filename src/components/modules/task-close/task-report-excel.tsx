import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { downloadReportWorkbook } from "#/lib/task-report-download";
import type { TaskReportSchema } from "#/lib/task-report-spec";

export function TaskReportExcel({
	taskId,
	schema,
	canEdit,
	disabled,
	onImport,
}: {
	taskId: string;
	schema: TaskReportSchema;
	canEdit: boolean;
	disabled: boolean;
	onImport: (value: unknown) => void;
}) {
	const trpc = useTRPC();
	const inputRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	const [fileBase64, setFileBase64] = useState("");
	const [mapping, setMapping] = useState<Record<string, number>>({});
	const download = useMutation(
		trpc.taskClose.reportExcelDownload.mutationOptions({
			onSuccess: (result, variables) => {
				downloadReportWorkbook(result.fileBase64, variables.templateOnly ? "填报模板.xlsx" : "填报数据.xlsx");
			},
			onError: toastApiError,
		}),
	);
	const preview = useMutation(
		trpc.taskClose.reportExcelPreview.mutationOptions({
			onSuccess: (result) => {
				setMapping(result.mapping);
				setOpen(true);
			},
			onError: toastApiError,
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
		const encoded = btoa(raw);
		setFileBase64(encoded);
		preview.mutate({ taskId, fileBase64: encoded });
	};
	const columns = (preview.data?.headers ?? []).map((header, index) => ({
		value: String(index),
		label: `${index + 1}. ${header || "空列"}`,
	}));
	const previewRows =
		preview.data?.value == null
			? []
			: (Array.isArray(preview.data.value) ? preview.data.value : [preview.data.value])
					.slice(0, 20)
					.map((row, index) => ({ row, rowNumber: preview.data?.rowNumbers[index] ?? 0 }));
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={download.isPending}
					onClick={() => download.mutate({ taskId, templateOnly: true })}
				>
					下载 Excel 模板
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={download.isPending || disabled}
					onClick={() => download.mutate({ taskId, templateOnly: false })}
				>
					导出当前填报
				</Button>
				{canEdit && (
					<>
						<Button
							size="sm"
							variant="outline"
							disabled={preview.isPending || disabled}
							onClick={() => inputRef.current?.click()}
						>
							导入 Excel
						</Button>
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
					</>
				)}
			</div>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
					<DialogHeader>
						<DialogTitle>导入预览</DialogTitle>
						<DialogDescription>核对列映射和数据；确认后写入草稿，正式提交仍需单独确认。</DialogDescription>
					</DialogHeader>
					<DialogBody className="space-y-4">
						{preview.data && (
							<>
								<div className="grid gap-2">
									{schema.fields.map((field) => (
										<div key={field.id} className="flex items-center gap-3">
											<span className="w-36 shrink-0 text-sm">{field.label}</span>
											<Select
												items={columns}
												value={mapping[field.id] >= 0 ? String(mapping[field.id]) : ""}
												onValueChange={(value) => setMapping({ ...mapping, [field.id]: Number(value) })}
											>
												<SelectTrigger aria-label={`${field.label} 对应列`}>
													<SelectValue placeholder="选择列" />
												</SelectTrigger>
												<SelectContent>
													{columns.map((column) => (
														<SelectItem key={column.value} value={column.value}>
															{column.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									))}
								</div>
								<Button
									variant="outline"
									size="sm"
									disabled={preview.isPending}
									onClick={() => preview.mutate({ taskId, fileBase64, mapping })}
								>
									重新校验映射
								</Button>
								{preview.data.mappingError && <p className="text-sm text-destructive">{preview.data.mappingError}</p>}
								{preview.data.issues.map((issue) => (
									<p key={`${issue.excelRow}-${issue.field}-${issue.message}`} className="text-sm text-destructive">
										{issue.excelRow ? `第 ${issue.excelRow} 行 · ` : ""}
										{schema.fields.find((field) => field.id === issue.field)?.label ?? issue.field}：{issue.message}
									</p>
								))}
								{preview.data.value !== null && (
									<div className="overflow-x-auto">
										<table className="w-full min-w-max border-collapse text-sm">
											<thead>
												<tr>
													{schema.fields.map((field) => (
														<th key={field.id} className="border border-border p-2 text-left">
															{field.label}
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												{previewRows.map(({ row, rowNumber }) => (
													<tr key={rowNumber}>
														{schema.fields.map((field) => (
															<td key={field.id} className="border border-border p-2">
																{Array.isArray(row[field.id])
																	? (row[field.id] as unknown[]).join("、")
																	: String(row[field.id] ?? PLACEHOLDER_EMPTY)}
															</td>
														))}
													</tr>
												))}
											</tbody>
										</table>
										<p className="mt-2 text-xs text-muted-foreground">最多预览前 20 行。</p>
									</div>
								)}
							</>
						)}
					</DialogBody>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setOpen(false)}>
							取消
						</Button>
						<Button
							disabled={
								preview.isPending ||
								!preview.data ||
								preview.data.value === null ||
								!!preview.data.mappingError ||
								preview.data.issues.length > 0 ||
								JSON.stringify(mapping) !== JSON.stringify(preview.data.mapping)
							}
							onClick={() => {
								if (preview.data?.value != null) {
									onImport(preview.data.value);
									setOpen(false);
									toast.success("已导入草稿");
								}
							}}
						>
							确认导入
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
