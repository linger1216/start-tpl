/**
 * Excel 导入/导出的公共形状与唯一写盘点。
 *
 * 分层(见 `doc/界面约定.md`):
 *  - 本文件只放**纯函数与类型**,不依赖 React、不发 toast;
 *  - "导出当前筛选结果 / 导入写回 + 用户反馈"这类流程在 `modules/shared/ledger-excel.ts`;
 *  - 列头与列宽一律来自各域契约中枢的 `XXX_EXCEL_COLUMNS`(类型即下面的 `ExcelColumn`)。
 */
import * as XLSX from "xlsx";

import { joinMultiValue } from "#/lib/multi-value";
import { formatLocalDate } from "#/lib/time";

/**
 * Excel 列定义:`key` 是行里的字段名,`label` 是表头,`width` 是列宽字符数。
 * `required` 只对导入模板有意义。
 *
 * 全站只有这一个列类型(此前 20 个域各自声明了一份同形状的 `XxxExcelColumn`)。
 */
export type ExcelColumn<Key extends string = string> = {
	key: Key;
	label: string;
	width?: number;
	required?: boolean;
};

/** 导入字段配置:key 是行的字段名,label 是 Excel 列头 */
export type ImportField = {
	key: string;
	label: string;
	required?: boolean;
	width?: number;
};

/** 解析后的行:字段 key -> 字符串值(空串表示缺失) */
export type ImportRow = Record<string, string>;

/** 导入回执里的逐行明细(错误或重复)—— 键名就是 Excel 的行号,对话框按它逐条列 */
export type ImportFeedback = { index: number; message: string };

/** 导入结果(created + 逐行错误/重复明细) */
export type ImportResult = {
	/** 本次解析的总行数 */
	total?: number;
	/** 成功导入行数 */
	created: number;
	/** 失败行(校验/写入异常) */
	errors: ImportFeedback[];
	/** 重复被跳过的行 */
	duplicates?: ImportFeedback[];
};

/**
 * 各域 `*.import` 的回执形状:把可选的 `duplicates` 收窄成**一定回**(空数组也要有),
 * 好让对话框稳定显示「重复 N 条」。四个域曾各自声明一遍这个交叉类型。
 */
export type ImportOutcome = ImportResult & { duplicates: ImportFeedback[] };

/**
 * 单元格取值。
 *
 * 两条都必须守住:
 *  1. **数组(多值标签)自己拼成字符串** —— 直接交给 XLSX 会被当成分片/公式,实测得到
 *     `{ v: "重点监管", f: "消防" }`,Excel 里只显示第一个值,其余值变成公式(静默丢数据);
 *  2. **数值/布尔/日期原样透传** —— 不能一律 `String()`,否则数字列会落成文本单元格
 *     (左对齐、不能求和、SUM 得到 0)。只有真正的字符串才需要转成字符串。
 */
function cellText(value: unknown): string | number | boolean | Date {
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) return joinMultiValue(value);
	if (typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
	return String(value);
}

/**
 * 把「列定义 + 行」写成 xlsx 并触发下载,返回写入行数。
 *
 * 这是全站唯一的 Excel 写盘点:表头、列宽、单元格取值、文件名日期后缀只在这里实现一次
 * (此前 56 个页面各写了一遍;那些副本用的是 `row[key] ?? ""`,对数组字段会丢值 ——
 *  属**潜在**缺陷:当前只有 settings/governance 的少数字段是数组,而它们当时恰好已用安全写法)。
 */
export function writeSheet<Key extends string>({
	columns,
	rows,
	fileName,
	sheetName = "数据",
}: {
	columns: readonly ExcelColumn<Key>[];
	rows: readonly object[];
	fileName: string;
	sheetName?: string;
}): number {
	buildAndSave({ columns, rows, fileName, sheetName, withDate: true });
	return rows.length;
}

/**
 * 下载**导入模板**:只有表头,文件名不带日期后缀(模板是长期复用的,不该每天一个新名字)。
 * 与 `writeSheet` 共用同一段写盘实现 —— 全站 `XLSX.writeFile` 只此一处。
 */
export function writeTemplate<Key extends string>({
	columns,
	fileName,
	sheetName = "模板",
}: {
	columns: readonly ExcelColumn<Key>[];
	fileName: string;
	sheetName?: string;
}): void {
	buildAndSave({ columns, rows: [], fileName, sheetName, withDate: false });
}

function buildAndSave<Key extends string>({
	columns,
	rows,
	fileName,
	sheetName,
	withDate,
}: {
	columns: readonly ExcelColumn<Key>[];
	rows: readonly object[];
	fileName: string;
	sheetName: string;
	withDate: boolean;
}): void {
	const sheet = XLSX.utils.aoa_to_sheet([
		columns.map((column) => column.label),
		...rows.map((row) => {
			const record = row as Record<string, unknown>;
			return columns.map((column) => cellText(record[column.key]));
		}),
	]);
	sheet["!cols"] = columns.map((column) => ({ wch: column.width }));
	const book = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(book, sheet, sheetName);
	// 日期只在用户点击导出时求值(不在渲染期),不参与 SSR 水合
	// 本地日期:用 ISO(UTC)拼文件名,晚上导出会写成"明天"
	const suffix = withDate ? `-${formatLocalDate(new Date())}` : "";
	XLSX.writeFile(book, `${fileName}${suffix}.xlsx`);
}
