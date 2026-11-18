import { FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";

type SheetPreview = { name: string; rows: string[][] };

function rowsOf(sheet: XLSX.WorkSheet): string[][] {
	return XLSX.utils
		.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true, range: 0 })
		.slice(0, 200)
		.map((row) => row.map((cell) => (cell == null ? "" : String(cell).trim())));
}

/** 新建填报模板时,选择工作表和表头行,只读取列名、不导入数据行。 */
export function TaskReportHeaderImportDialog({
	open,
	onOpenChange,
	remaining,
	onImport,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	remaining: number;
	onImport: (headers: string[]) => void;
}) {
	const fileRef = useRef<HTMLInputElement | null>(null);
	const [sheets, setSheets] = useState<SheetPreview[]>([]);
	const [sheetName, setSheetName] = useState("");
	const [headerIndex, setHeaderIndex] = useState(0);
	const [fileName, setFileName] = useState("");
	const [error, setError] = useState("");
	const rows = sheets.find((sheet) => sheet.name === sheetName)?.rows ?? [];
	const headers = rows[headerIndex] ?? [];
	const fieldCount = headers.filter((header) => header.trim() && header.length <= 100).length;
	const skippedLong = headers.filter((header) => header.trim() && header.length > 100).length;
	const headerOccurrences = new Map<string, number>();
	const headerItems = headers.map((header) => {
		const occurrence = (headerOccurrences.get(header) ?? 0) + 1;
		headerOccurrences.set(header, occurrence);
		return { header, key: `${header}-${occurrence}` };
	});
	const headerRows = rows
		.map((row, index) => ({ row, index }))
		.filter(({ row }) => row.some((cell) => cell.trim()))
		.slice(0, 100);

	async function readFile(file: File) {
		setError("");
		setFileName(file.name);
		try {
			const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
			const next = workbook.SheetNames.flatMap((name) => {
				const sheet = workbook.Sheets[name];
				if (!sheet) return [];
				const rows = rowsOf(sheet);
				return rows.some((row) => row.some((cell) => cell.trim())) ? [{ name, rows }] : [];
			});
			if (next.length === 0) {
				setSheets([]);
				setError("文件中没有可读取的工作表或数据。");
				return;
			}
			setSheets(next);
			setSheetName(next[0]?.name ?? "");
			const firstHeader = next[0]?.rows.findIndex((row) => row.some((cell) => cell.trim())) ?? 0;
			setHeaderIndex(Math.max(0, firstHeader));
		} catch {
			setSheets([]);
			setError("Excel 文件读取失败，请确认文件未损坏后重试。");
		}
	}

	function reset() {
		setSheets([]);
		setSheetName("");
		setHeaderIndex(0);
		setFileName("");
		setError("");
		if (fileRef.current) fileRef.current.value = "";
	}

	function importFields() {
		onImport(headers);
		onOpenChange(false);
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-xl`}>
				<DialogHeader>
					<DialogTitle>从 Excel 创建字段</DialogTitle>
					<DialogDescription>
						选择工作表和表头行（扫描前 200 行），按列名追加文本字段；不会导入表格中的数据行。
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="grid min-h-0 content-start gap-3 py-1">
					<div className="flex flex-wrap items-center gap-2">
						<input
							ref={fileRef}
							type="file"
							accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
							className="hidden"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (file) void readFile(file);
							}}
						/>
						<Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
							<Upload className="size-3.5" />
							选择 Excel
						</Button>
						{fileName ? (
							<span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
								<FileSpreadsheet className="size-3.5 shrink-0" />
								{fileName}
							</span>
						) : null}
					</div>
					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}
					{sheets.length > 0 ? (
						<div className="grid gap-2 sm:grid-cols-2">
							{sheets.length > 1 ? (
								<div className="grid gap-1 text-xs text-muted-foreground">
									工作表
									<Select
										items={sheets.map((sheet) => ({ value: sheet.name, label: sheet.name }))}
										value={sheetName}
										onValueChange={(value) => {
											setSheetName(value ?? "");
											setHeaderIndex(0);
										}}
									>
										<SelectTrigger size="sm" aria-label="工作表">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{sheets.map((sheet) => (
												<SelectItem key={sheet.name} value={sheet.name}>
													{sheet.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							) : null}
							<div className="grid gap-1 text-xs text-muted-foreground">
								表头行
								<Select
									items={headerRows.map(({ row, index }) => ({
										value: String(index),
										label: `第 ${index + 1} 行 · ${row
											.filter(Boolean)
											.slice(0, 4)
											.map((cell) => cell.slice(0, 20))
											.join(" / ")}`,
									}))}
									value={String(headerIndex)}
									onValueChange={(value) => setHeaderIndex(value ? Number(value) : 0)}
								>
									<SelectTrigger size="sm" aria-label="表头行">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{headerRows.map(({ row, index }) => (
											<SelectItem key={index} value={String(index)}>
												第 {index + 1} 行 ·{" "}
												{row
													.filter(Boolean)
													.slice(0, 4)
													.map((cell) => cell.slice(0, 20))
													.join(" / ")}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					) : null}
					{fieldCount > 0 || skippedLong > 0 ? (
						<div className="grid gap-1 rounded-md border border-border bg-muted/30 p-2">
							<p className="text-xs text-muted-foreground">识别到 {fieldCount} 个可用表头</p>
							{skippedLong > 0 ? (
								<p className="text-xs text-muted-foreground">另有 {skippedLong} 个表头超过 100 字，创建时会跳过。</p>
							) : null}
							<div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
								{headerItems.map(({ header, key }) =>
									header ? (
										<span key={key} className="rounded border border-border bg-background px-1.5 py-0.5 text-xs">
											{header}
										</span>
									) : null,
								)}
							</div>
						</div>
					) : null}
					{fieldCount > remaining ? (
						<p role="alert" className="text-xs text-destructive">
							当前模板还可添加 {remaining} 个字段，请选择表头较少的行。
						</p>
					) : null}
				</DialogBody>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button disabled={fieldCount === 0 || fieldCount > remaining} onClick={importFields}>
						创建 {fieldCount} 个字段
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
