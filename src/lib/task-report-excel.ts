import * as XLSX from "xlsx";
import { fromBuffer } from "yauzl";
import { type TaskReportSchema, validateTaskReport } from "./task-report-spec";

const MAX_FILE = 5 * 1024 * 1024;
const MAX_UNPACKED = 20 * 1024 * 1024;
const MAX_ENTRIES = 150;
const MAX_ROWS = 10000;
const MAX_COLUMNS = 100;

/** 先逐项解压并累计实际字节，再交给 XLSX 解析，防止伪造尺寸的压缩炸弹。 */
async function inspectArchive(buffer: Buffer): Promise<void> {
	if (buffer.length > MAX_FILE || buffer.length < 4) throw new Error("文件大小无效，最大 5 MB");
	await new Promise<void>((resolve, reject) => {
		fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
			if (error || !zip) {
				reject(new Error("文件不是有效的 XLSX"));
				return;
			}
			let total = 0;
			let entries = 0;
			let failed = false;
			const fail = (message: string) => {
				if (failed) return;
				failed = true;
				zip.close();
				reject(new Error(message));
			};
			zip.on("error", () => fail("XLSX 压缩包损坏"));
			zip.on("end", () => {
				if (!failed) resolve();
			});
			zip.on("entry", (entry) => {
				entries++;
				const name = entry.fileName.toLowerCase();
				if (
					entries > MAX_ENTRIES ||
					entry.uncompressedSize > MAX_UNPACKED ||
					name.includes("vbaproject") ||
					name.includes("externallinks/") ||
					name.includes("embeddings/") ||
					name.includes("activex/")
				) {
					fail("文件包含不允许的内容或超过限制");
					return;
				}
				if (/\/$/.test(name)) {
					zip.readEntry();
					return;
				}
				zip.openReadStream(entry, (streamError, stream) => {
					if (streamError || !stream) {
						fail("无法读取 XLSX 内容");
						return;
					}
					const inspect = name.endsWith(".xml") || name.endsWith(".rels");
					const chunks: Buffer[] = [];
					let size = 0;
					stream.on("data", (chunk: Buffer) => {
						size += chunk.length;
						total += chunk.length;
						if (total > MAX_UNPACKED || size > MAX_UNPACKED) {
							stream.destroy();
							fail("文件解压后超过 20 MB");
						} else if (inspect) chunks.push(chunk);
					});
					stream.on("error", () => fail("XLSX 内容损坏"));
					stream.on("end", () => {
						if (failed) return;
						if (inspect) {
							const xml = Buffer.concat(chunks).toString("utf8");
							if (
								/<!DOCTYPE|<!ENTITY|TargetMode\s*=|vbaProject/i.test(xml) ||
								(name.startsWith("xl/worksheets/") && /<(?:\w+:)?f(?:\s|\/?>)/i.test(xml))
							) {
								fail("不支持公式、宏或外部链接");
								return;
							}
						}
						zip.readEntry();
					});
				});
			});
			zip.readEntry();
		});
	});
}

/** 安全输出为字符串单元格；Excel 不会把用户文本解析成公式。 */
function cellValue(value: unknown): string | number | boolean {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "boolean") return value;
	const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
	let start = 0;
	while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/.test(text[start]))) start++;
	return "=+-@".includes(text[start] ?? "\uffff") ? `'${text}` : text;
}

export function createReportWorkbook(schema: TaskReportSchema, data: unknown = []): Buffer {
	const rows =
		schema.kind === "TABLE"
			? Array.isArray(data)
				? data
				: []
			: data && typeof data === "object" && !Array.isArray(data)
				? [data]
				: [];
	if (rows.length > MAX_ROWS || schema.fields.length > MAX_COLUMNS) throw new Error("导出数据超过限制");
	// 表头只写**中文名**:字段英文 id 是内部标识,不外泄也不要求填表人理解
	const values = [
		schema.fields.map((field) => field.label),
		...rows.map((row) => schema.fields.map((field) => cellValue((row as Record<string, unknown>)[field.id]))),
	];
	const sheet = XLSX.utils.aoa_to_sheet(values);
	sheet["!cols"] = schema.fields.map(() => ({ wch: 22 }));
	const book = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(book, sheet, "填报");
	return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

export async function previewReportWorkbook(schema: TaskReportSchema, fileBase64: string) {
	if (fileBase64.length > Math.ceil(MAX_FILE / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(fileBase64))
		throw new Error("文件编码或大小无效");
	const buffer = Buffer.from(fileBase64, "base64");
	await inspectArchive(buffer);
	let book: XLSX.WorkBook;
	try {
		book = XLSX.read(buffer, {
			type: "buffer",
			cellFormula: true,
			cellDates: false,
			bookVBA: true,
			sheetRows: MAX_ROWS + 2,
		});
	} catch {
		throw new Error("无法解析 XLSX 文件");
	}
	if (book.SheetNames.length !== 1 || book.vbaraw) throw new Error("只接受单个无宏工作表");
	const sheet = book.Sheets[book.SheetNames[0]];
	const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1:A1");
	if (range.e.r > MAX_ROWS || range.e.c >= MAX_COLUMNS) throw new Error("工作表行列超过限制");
	for (const [address, cell] of Object.entries(sheet))
		if (!address.startsWith("!") && (cell.f || cell.F || cell.l)) throw new Error("不支持公式或链接单元格");
	const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
	const header = matrix[0] ?? [];
	const selected = Object.fromEntries(
		schema.fields.map((field) => [field.id, header.findIndex((cell) => String(cell ?? "").trim() === field.label)]),
	);
	const positions = schema.fields.map((field) => selected[field.id]);
	if (
		positions.some((position) => !Number.isInteger(position) || position < 0 || position >= header.length) ||
		new Set(positions).size !== positions.length
	)
		throw new Error("文件表头对不上模板字段 —— 请用「下载模版」填写后再导入");
	const rows = matrix
		.slice(1)
		.map((row, index) => ({ row, excelRow: index + 2 }))
		.filter(({ row }) => row.some((value) => value !== null && value !== ""));
	if (schema.kind === "OBJECT" && rows.length > 1) throw new Error("表单只允许一行数据");
	const parsed = rows.map(({ row }) =>
		Object.fromEntries(
			schema.fields.map((field) => {
				const raw = row[selected[field.id]];
				let value: unknown = raw === null || raw === undefined || raw === "" ? null : raw;
				if (field.readOnly) value = field.defaultValue ?? null;
				else if ((field.type === "integer" || field.type === "decimal") && typeof value === "string" && value.trim()) {
					const number = Number(value);
					if (Number.isFinite(number)) value = number;
				} else if (field.type === "multiselect" && typeof value === "string")
					value = value
						.split(/[;；]/)
						.map((item) => item.trim())
						.filter(Boolean);
				else if (
					(field.type === "text" || field.type === "select" || field.type === "date" || field.type === "datetime") &&
					value !== null
				)
					value = String(value);
				return [field.id, value];
			}),
		),
	);
	const value = schema.kind === "TABLE" ? parsed : (parsed[0] ?? {});
	return {
		value,
		/** 逐字段校验结果,`excelRow` 是它在文件里的行号(报"第几行错了"用) */
		issues: validateTaskReport(schema, value).map((issue) => ({
			...issue,
			excelRow: rows[issue.row ?? 0]?.excelRow ?? null,
		})),
	};
}
