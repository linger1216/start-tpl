import * as XLSX from "xlsx";
import { fromBuffer } from "yauzl";
import { formatLocalDateTime, parseLocalDateText, parseLocalDateTime } from "../time";
import { isRecord } from "./json";
import { MAX_REPORT_FILE_BYTES, MAX_REPORT_ROWS, type TaskReportSchema, validateTaskReport } from "./report-spec";

const MAX_UNPACKED = 20 * 1024 * 1024;
const MAX_ENTRIES = 150;
const MAX_ROWS = MAX_REPORT_ROWS;
const MAX_COLUMNS = 100;

/**
 * 工作表名。导出**父任务**与普通任务一样,都是两张:`填报(可读)` · `填报`(首列「执行人」,
 * 母版行 + 各子任务已提交的行,读时组合);「下载模版」只有一张 `填报`。
 *
 * ⚠️ **导入只认 `填报`(`data`)那张**(机器格式)。
 */
const REPORT_SHEETS = {
	data: "填报",
	readable: "填报(可读)",
} as const;

/** 先逐项解压并累计实际字节，再交给 XLSX 解析，防止伪造尺寸的压缩炸弹。 */
async function inspectArchive(buffer: Buffer): Promise<void> {
	if (buffer.length > MAX_REPORT_FILE_BYTES || buffer.length < 4) throw new Error("文件大小无效，最大 5 MB");
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

/** 字段的可导出形状(顶层字段与数组元素字段共用) */
type ReadableField = {
	id: string;
	label: string;
	type: TaskReportSchema["fields"][number]["type"];
	itemFields?: ReadonlyArray<ReadableField>;
};

/** 防公式注入:以 `= + - @` 开头的文本前面加个引号,Excel 才不会当公式解析。 */
function escapeFormula(text: string): string {
	let start = 0;
	while (start < text.length && /\s/.test(text[start] ?? "")) start++;
	return "=+-@".includes(text[start] ?? "\uffff") ? `'${text}` : text;
}

/**
 * 一个值写进 Excel 单元格的**唯一**口径。
 * - `human=false`(机器表):附件 / 数组保持 id / JSON,多选 `;`,数字 / 布尔原样 —— **导入只认这张**;
 * - `human=true`(可读表):附件写文件名、数组写「1) 字段:值；…」、多选顿号、日期折本地。
 */
function renderCell(
	field: ReadableField,
	value: unknown,
	opts: { human: boolean; fileNames: Readonly<Record<string, string>> },
): string | number | boolean {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (!opts.human) {
		if (typeof value === "boolean") return value;
		const text = Array.isArray(value)
			? value.every((item) => typeof item === "string")
				? value.join(";")
				: JSON.stringify(value)
			: String(value ?? "");
		return escapeFormula(text);
	}
	if (value === null || value === undefined || value === "") return "";
	if (field.type === "attachment") {
		const ids = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
		return ids.map((id) => opts.fileNames[id] ?? id).join("、");
	}
	if (field.type === "multiselect") {
		const picked = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
		return picked.join("、");
	}
	if (field.type === "array") {
		const items = Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item)) : [];
		return escapeFormula(
			items
				.map((item, index) => {
					const pairs = (field.itemFields ?? [])
						.map((sub) => `${sub.label}:${renderCell(sub, item[sub.id], opts)}`)
						.join("，");
					return `${index + 1}) ${pairs}`;
				})
				.join("；"),
		);
	}
	if (field.type === "datetime") {
		return typeof value === "string" ? formatLocalDateTime(value) || String(value) : String(value);
	}
	if (typeof value === "boolean") return value ? "是" : "否";
	return escapeFormula(String(value));
}

/**
 * 生成一份填报工作簿:**一对表**(「填报(可读)」+「填报」),「下载模版」时只有「填报」。
 *
 * - 可读表:附件写文件名、数组写「1) 字段:值；2) …」、多选顿号;
 * - 机器表:附件是 `sys_file.id`、数组是 JSON —— **导入只认它**,`导出 → 改 → 导回`;
 * - `owners` 给了就在最前面多一列「执行人」(父任务导出:母版 + 各子任务已提交的行)。
 */
export function createReportWorkbook(
	schema: TaskReportSchema,
	data: unknown = [],
	options: {
		/** 是否额外出一张可读表 */
		readable?: boolean;
		/** 可读表里附件要写文件名(id → 原始文件名);缺名字就退回 id */
		fileNames?: Readonly<Record<string, string>>;
		/** 每行归属的执行人名;`null` = 母版行。给了就多一列「执行人」 */
		owners?: ReadonlyArray<string | null>;
	} = {},
): Buffer {
	const { readable = false, fileNames = {}, owners } = options;
	// 值一律按**行数组**处理(OBJECT 也只是一个对象的数组);父任务组合行同样是数组
	const rows: Array<Record<string, unknown>> = Array.isArray(data)
		? (data as Array<Record<string, unknown>>)
		: data && typeof data === "object"
			? [data as Record<string, unknown>]
			: [];
	if (rows.length > MAX_ROWS || schema.fields.length > MAX_COLUMNS) throw new Error("导出数据超过限制");
	// 表头只写**中文名**:字段英文 id 是内部标识,不外泄也不要求填表人理解
	const labels = schema.fields.map((field) => field.label);
	/** 一条数据在一个单元格里的写法(可读表走人类口径,机器表是 id / JSON 原样) */
	const rowOf = (row: Record<string, unknown>, human: boolean) =>
		schema.fields.map((field) => renderCell(field, row[field.id], { human, fileNames }));
	const header = owners ? ["执行人", ...labels] : labels;
	const book = XLSX.utils.book_new();
	const push = (title: string, human: boolean) => {
		const body = rows.map((row, index) => {
			const cells = rowOf(row as Record<string, unknown>, human);
			return owners ? [owners[index] ?? "母版", ...cells] : cells;
		});
		const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
		sheet["!cols"] = [{ wch: owners ? 16 : 22 }, ...labels.map(() => ({ wch: 22 }))];
		XLSX.utils.book_append_sheet(book, sheet, title);
	};
	if (readable) push(REPORT_SHEETS.readable, true);
	push(REPORT_SHEETS.data, false);
	return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

export async function previewReportWorkbook(schema: TaskReportSchema, fileBase64: string) {
	if (fileBase64.length > Math.ceil(MAX_REPORT_FILE_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(fileBase64))
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
	// 导出的工作簿带两张表(「填报(可读)」+「填报」),导入只认名为「填报」的那张;
	// 单表文件(手搓的 / 「下载模版」导出的)照旧可用;多表又不含「填报」= 不是我们的文件
	if (book.vbaraw) throw new Error("不支持带宏的工作簿");
	const dataNames: readonly string[] = [REPORT_SHEETS.data];
	const sheetName =
		dataNames.find((name) => book.SheetNames.includes(name)) ??
		(book.SheetNames.length === 1 ? book.SheetNames[0] : null);
	if (!sheetName) throw new Error(`工作簿里找不到「${REPORT_SHEETS.data}」工作表`);
	const sheet = book.Sheets[sheetName];
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
				} else if ((field.type === "multiselect" || field.type === "attachment") && typeof value === "string") {
					// 导出时为防公式注入可能加单引号；附件 ID 不含单引号，导入时恢复原 ID。
					const text = field.type === "attachment" && /^'[=+@-]/.test(value) ? value.slice(1) : value;
					value = text
						.split(/[;；]/)
						.map((item) => item.trim())
						.filter(Boolean);
				}
				// 日期 / 日期时间:手填的是本地写法(或 Excel 的日期序列号),落库前折成统一口径。
				// **认不出来就保留原文**,让校验报「日期格式不正确」—— 别悄悄当空值丢掉。
				else if (field.type === "date") value = parseLocalDateText(value as string | number) ?? value;
				else if (field.type === "datetime") value = parseLocalDateTime(value as string | number) ?? value;
				else if (field.type === "array" && typeof value === "string") {
					// 数组字段导出就是 JSON,导回来也按 JSON 解;解不开保留原文,交给校验报错
					try {
						const parsed = JSON.parse(value);
						if (Array.isArray(parsed)) value = parsed;
					} catch {
						/* 保持原文本 */
					}
				} else if (
					(field.type === "text" || field.type === "select" || field.type === "phone" || field.type === "email") &&
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
