import { Download, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";

import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { toErrorMessage } from "#/lib/api/error";
import { type ImportField, type ImportResult, type ImportRow, writeTemplate } from "#/lib/excel";

// 类型已归拢到 lib/excel;此处 re-export 保持既有 import 路径兼容
export type { ImportField, ImportResult, ImportRow };

type Parsed = {
	rows: ImportRow[];
	warnings: string[];
};

/** 解析 xlsx -> 字段配置映射的行 */
function parseWorkbook(buffer: ArrayBuffer, fields: ImportField[]): Parsed {
	const warnings: string[] = [];
	try {
		const wb = XLSX.read(buffer, { type: "array" });
		const first = wb.SheetNames[0];
		if (!first) return { rows: [], warnings: ["Excel 中没有工作表"] };
		const sheet = wb.Sheets[first];
		if (!sheet) return { rows: [], warnings: ["工作表中没有数据"] };
		const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
			defval: "",
		});

		const labels = fields.map((f) => f.label);
		const rows: ImportRow[] = [];
		json.forEach((row, i) => {
			const out: ImportRow = {};
			let missingRequired = false;
			for (const f of fields) {
				// 同时支持中文列头(f.label)和英文 key(f.key)
				const raw = row[f.label] ?? row[f.key] ?? "";
				// 只接受标量值(string/number/boolean);对象(公式/富单元格)按空处理,
				// 避免 String(object) 落入 "[object Object]"
				const val =
					typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? String(raw).trim() : "";
				out[f.key] = val;
				if (f.required && !val) {
					missingRequired = true;
				}
			}
			if (missingRequired) {
				warnings.push(
					`第 ${i + 2} 行: 缺少必填列「${labels.filter((_, fi) => fields[fi]?.required).join("/")}」,已跳过`,
				);
				return;
			}
			rows.push(out);
		});
		return { rows, warnings };
	} catch (err) {
		return {
			rows: [],
			warnings: [`Excel 解析失败: ${toErrorMessage(err)}`],
		};
	}
}

/**
 * 通用 Excel 导入对话框(仅支持 .xlsx/.xls)。
 * - 字段配置化:通过 fields 定义列头/必填/列宽
 * - 提供「下载模板」:自动生成含指定列头 + 空行的模板
 * - 解析后逐行调用 onSubmit(通常触发后端 import procedure)
 */
export function ExcelImportDialog({
	open,
	onOpenChange,
	title,
	description,
	fields,
	onSubmit,
	isPending,
	fileNamePrefix = "导入模板",
	options,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	title: string;
	description?: string;
	fields: ImportField[];
	/** 同步或异步都接受:mock 表写回是同步的,真后端导入会是异步的 */
	onSubmit: (rows: ImportRow[]) => ImportResult | undefined | Promise<ImportResult | undefined>;
	isPending: boolean;
	fileNamePrefix?: string;
	/** 调用方自定义的导入选项(如「清空后导入」「跳过重复」),渲染在文件选择区下方 */
	options?: React.ReactNode;
}) {
	const fileRef = useRef<HTMLInputElement | null>(null);
	const [parsed, setParsed] = useState<Parsed | null>(null);
	const [result, setResult] = useState<ImportResult | null>(null);

	function reset() {
		setParsed(null);
		setResult(null);
		if (fileRef.current) fileRef.current.value = "";
	}

	async function handleFile(file: File) {
		if (!file.name.toLowerCase().endsWith(".xlsx") && !file.name.toLowerCase().endsWith(".xls")) {
			setParsed({ rows: [], warnings: ["仅支持 Excel 文件(.xlsx/.xls)"] });
			return;
		}
		const buffer = await file.arrayBuffer();
		setParsed(parseWorkbook(buffer, fields));
	}

	function downloadTemplate() {
		// 写盘统一走 `lib/excel.ts`(全站唯一写盘点);模板列宽沿用原来的默认 20
		writeTemplate({
			columns: fields.map((field) => ({ ...field, width: field.width ?? 20 })),
			fileName: fileNamePrefix,
		});
	}

	async function handleImport() {
		if (!parsed || parsed.rows.length === 0) return;
		const r = await onSubmit(parsed.rows);
		if (r) setResult(r);
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) reset();
				onOpenChange(v);
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description ?? "仅支持 Excel(.xlsx/.xls)。可先下载模板填写后导入。"}</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="flex flex-wrap items-center gap-2">
						<input
							ref={fileRef}
							type="file"
							accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
							className="hidden"
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f) void handleFile(f);
							}}
						/>
						<Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
							<Upload className="size-3.5" />
							选择 Excel 文件
						</Button>
						<Button variant="outline" size="sm" onClick={downloadTemplate}>
							<Download className="size-3.5" />
							下载模板
						</Button>
					</div>

					{options}

					{parsed && (
						<div className="rounded-xl border border-border bg-secondary/40 p-3 text-xs">
							{parsed.warnings.length > 0 && (
								<ul className="mb-1.5 space-y-0.5 text-danger">
									{parsed.warnings.map((w) => (
										<li key={w} className="flex items-start gap-1">
											<TriangleAlert className="mt-0.5 size-3 shrink-0" />
											<span>{w}</span>
										</li>
									))}
								</ul>
							)}
							<div className="flex items-center gap-1.5 text-muted-foreground">
								<FileSpreadsheet className="size-4" />
								共解析 {parsed.rows.length} 行待导入
							</div>
						</div>
					)}

					{result && (
						<div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-border bg-secondary/40 p-3 text-xs">
							<div className="font-medium text-foreground">
								共 {result.total ?? parsed?.rows.length ?? 0} 条 · 已导入{" "}
								<span className="text-success-fg">{result.created}</span> 条
								{result.duplicates && result.duplicates.length > 0 && (
									<>
										{" "}
										· 重复 <span className="text-warn-fg">{result.duplicates.length}</span> 条
									</>
								)}
								{result.errors.length > 0 && (
									<>
										{" "}
										· 失败 <span className="text-danger">{result.errors.length}</span> 条
									</>
								)}
							</div>

							{result.duplicates && result.duplicates.length > 0 && (
								<div>
									<div className="mb-1 text-warn-fg">重复(已跳过):</div>
									<ul className="space-y-0.5 text-muted-foreground">
										{result.duplicates.map((d) => (
											<li key={`dup-${d.index}`}>
												第 {d.index + 1} 行:{d.message}
											</li>
										))}
									</ul>
								</div>
							)}

							{result.errors.length > 0 && (
								<div>
									<div className="mb-1 text-danger">失败:</div>
									<ul className="space-y-0.5 text-muted-foreground">
										{result.errors.map((e) => (
											<li key={`err-${e.index}`}>
												第 {e.index + 1} 行:{e.message}
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button onClick={handleImport} disabled={!parsed || parsed.rows.length === 0 || isPending}>
						{isPending ? "导入中…" : "导入"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
