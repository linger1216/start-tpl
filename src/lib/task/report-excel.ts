import * as XLSX from "xlsx";
import { fromBuffer } from "yauzl";
import { formatLocalDateTime, parseLocalDateText, parseLocalDateTime } from "../time";
import { type TaskReportSchema, validateTaskReport } from "./report-spec";

const MAX_FILE = 5 * 1024 * 1024;
const MAX_UNPACKED = 20 * 1024 * 1024;
const MAX_ENTRIES = 150;
const MAX_ROWS = 10000;
const MAX_COLUMNS = 100;

/**
 * 工作表名。导出**父任务**时四张:`父任务填报(可读)` · `父任务填报` · `子任务填报(可读)` · `子任务填报`;
 * 普通任务(没有子任务)两张:`填报(可读)` · `填报`;「下载模版」只有一张 `填报`。
 *
 * ⚠️ **导入只认 `own` / `parent` 的 `data` 那张**(机器格式)。「子任务填报」天然不属于某一个任务,
 * 不参与导入 —— 别把它加进候选名单。
 */
export const REPORT_SHEETS = {
	own: { data: "填报", readable: "填报(可读)" },
	parent: { data: "父任务填报", readable: "父任务填报(可读)" },
	child: { data: "子任务填报", readable: "子任务填报(可读)" },
} as const;

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
	// 数组字段(元素是对象)导出成 JSON,导入时按 JSON 解回来;多选仍是分号串
	const text = Array.isArray(value)
		? value.every((item) => typeof item === "string")
			? value.join(";")
			: JSON.stringify(value)
		: String(value ?? "");
	let start = 0;
	while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/.test(text[start]))) start++;
	return "=+-@".includes(text[start] ?? "\uffff") ? `'${text}` : text;
}

/**
 * 生成一份填报工作簿。导出**父任务**时四张表,普通任务两张,「下载模版」一张:
 *
 * | 工作表 | 内容 | 用途 |
 * | --- | --- | --- |
 * | `父任务填报(可读)` / `填报(可读)` | 附件写**文件名**、数组写「1) 字段:值；2) …」、多选顿号分隔 | 给人看 |
 * | `父任务填报` / `填报` | 机器格式(附件是 `sys_file.id`、数组是 JSON) | **导入只认它**,`导出 → 改 → 导回` |
 * | `子任务填报(可读)` / `子任务填报` | 子任务保存过的那份,首列「执行人」(表格任务一个子任务可占多行) | 给人看 / 机器读 |
 *
 * `parentLayout` 决定表名用带「父任务 / 子任务」的那一套(仅当这任务真的有子任务)。
 */
export function createReportWorkbook(
	schema: TaskReportSchema,
	data: unknown = [],
	options: {
		/** 是否额外出一张可读表 */
		readable?: boolean;
		/** 可读表里附件要写文件名(id → 原始文件名);缺名字就退回 id */
		fileNames?: Readonly<Record<string, string>>;
		/** 子任务保存过的填报:表单一条是一个对象,表格一条是它那份行数组 */
		children?: ReadonlyArray<{ owner: string; payload: unknown }>;
		/** 这任务是**父任务**(有子任务)—— 决定表名用「父任务填报 / 子任务填报」那一套 */
		parentLayout?: boolean;
	} = {},
): Buffer {
	const { readable = false, fileNames = {}, children = [], parentLayout = false } = options;
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
	const labels = schema.fields.map((field) => field.label);
	/** 一条数据在一个单元格里的写法(可读表走人类口径,机器表是 id / JSON 原样) */
	const rowOf = (row: Record<string, unknown>, human: boolean) =>
		schema.fields.map((field) => cellValue(human ? readableCell(field, row[field.id], fileNames) : row[field.id]));
	const names = parentLayout ? REPORT_SHEETS.parent : REPORT_SHEETS.own;
	const book = XLSX.utils.book_new();
	const push = (title: string, header: string[], body: unknown[][], firstWidth: number) => {
		const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
		const widths: XLSX.ColInfo[] = [{ wch: firstWidth }, ...labels.map(() => ({ wch: 22 }))];
		// 有「执行人」首列就整体用,否则去掉那一列的宽度
		sheet["!cols"] = header.length > labels.length ? widths : widths.slice(1);
		XLSX.utils.book_append_sheet(book, sheet, title);
	};
	const own = rows.map((row) => row as Record<string, unknown>);
	if (readable)
		push(
			names.readable,
			labels,
			own.map((row) => rowOf(row, true)),
			22,
		);
	push(
		names.data,
		labels,
		own.map((row) => rowOf(row, false)),
		22,
	);
	if (children.length > 0) {
		// 子任务那两张:先可读再机器;首列都是「执行人」(表格任务一个子任务可能占好几行)
		const childRowsOf = (payload: unknown): Array<Record<string, unknown>> =>
			schema.kind === "TABLE"
				? Array.isArray(payload)
					? (payload as Array<Record<string, unknown>>)
					: []
				: [(payload ?? {}) as Record<string, unknown>];
		const body = (human: boolean) =>
			children.flatMap((child) => childRowsOf(child.payload).map((row) => [child.owner, ...rowOf(row, human)]));
		if (readable) push(REPORT_SHEETS.child.readable, ["执行人", ...labels], body(true), 16);
		push(REPORT_SHEETS.child.data, ["执行人", ...labels], body(false), 16);
	}
	return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

/**
 * 一个值的**人类可读**写法 —— 只有两类字段"机器味"重,其余本来就直白:
 * 附件写文件名(逗号顿号分隔)、数组写成「1) 字段:值，字段:值；2) …」,多选顿号分隔。
 * 嵌套在数组里的附件同样写文件名。
 */
type ReadableField = {
	id: string;
	label: string;
	type: TaskReportSchema["fields"][number]["type"];
	itemFields?: ReadonlyArray<ReadableField>;
};

function readableCell(
	field: ReadableField,
	value: unknown,
	fileNames: Readonly<Record<string, string>>,
): string | number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (value === null || value === undefined || value === "") return "";
	if (field.type === "attachment") {
		const ids = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
		return ids.map((id) => fileNames[id] ?? id).join("、");
	}
	if (field.type === "multiselect") {
		const picked = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
		return picked.join("、");
	}
	if (field.type === "array") {
		const items = Array.isArray(value)
			? value.filter(
					(item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item),
				)
			: [];
		return items
			.map((item, index) => {
				const pairs = (field.itemFields ?? [])
					.map((sub) => `${sub.label}:${readableCell(sub, item[sub.id], fileNames)}`)
					.join("，");
				return `${index + 1}) ${pairs}`;
			})
			.join("；");
	}
	if (field.type === "datetime") {
		// 存的是 ISO(带时区),给人看的一律折算成本地 `YYYY-MM-DD HH:mm:ss` —— 别把 UTC 甩给人
		return typeof value === "string" ? formatLocalDateTime(value) || String(value) : String(value);
	}
	if (typeof value === "boolean") return value ? "是" : "否";
	return String(value);
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
	// 导出的工作簿带两张表(「填报(可读)」+「填报」),导入只认名为「填报」的那张;
	// 单表文件(手搓的 / 「下载模版」导出的)照旧可用;多表又不含「填报」= 不是我们的文件
	if (book.vbaraw) throw new Error("不支持带宏的工作簿");
	const dataNames: readonly string[] = [REPORT_SHEETS.own.data, REPORT_SHEETS.parent.data];
	const sheetName =
		dataNames.find((name) => book.SheetNames.includes(name)) ??
		(book.SheetNames.length === 1 ? book.SheetNames[0] : null);
	if (!sheetName) throw new Error(`工作簿里找不到「${REPORT_SHEETS.own.data}」工作表`);
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
				} else if (field.type === "multiselect" && typeof value === "string")
					value = value
						.split(/[;；]/)
						.map((item) => item.trim())
						.filter(Boolean);
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
