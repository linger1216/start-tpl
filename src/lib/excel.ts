/**
 * Excel 导入/导出的公共形状与唯一写盘点。
 *
 * 分层(见 `doc/前端结构与组件约定.md`):
 *  - 本文件只放**纯函数与类型**,不依赖 React、不发 toast;
 *  - "导出当前筛选结果 / 导入写回 + 用户反馈"这类流程在 `modules/shared/ledger-excel.ts`;
 *  - 列头与列宽一律来自各域契约中枢的 `XXX_EXCEL_COLUMNS`(类型即下面的 `ExcelColumn`)。
 */
import * as XLSX from "xlsx";

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

// ── 浏览器端读取:文件校验 + 「表头 + 数据矩阵」解析 ───────────────
//
// 「接入数据源」的字段映射(导入文件识别)与「导入数据」共用这一段:
// 表头允许被用户修正(改列名),所以**不能**在解析时就拍平成 `{ 列名: 值 }` 对象 ——
// 那样改一个列名就得重新解析文件。这里保留 `headers`(可改)+ `rows`(按列序的二维数组),
// 取值一律按**列下标**回填,改名不影响数据。

/** 文件选择框的 accept;模板导入只允许这三种 */
export const SHEET_FILE_ACCEPT = ".xlsx,.xls,.csv";

/** 单个文件大小上限(MB) */
export const SHEET_FILE_MAX_MB = 5;

/**
 * 解析结果:表头 + 业务字段行 + 数据矩阵(表头与业务字段行都不含在 rows 里)。
 *
 * 列宽以「表头 / 业务字段行 / 所有数据行」里最宽的一行为准,取值一律按**列下标**回填 ——
 * 所以业务字段名单独占一行也不影响匹配(导入时按表头匹配列)。
 */
export type SheetTable = {
	/** 表头(已 trim;空表头用「列N」占位) */
	headers: string[];
	/** 业务字段行的值(与 headers 逐列对齐);没配业务字段行时是空数组 */
	fieldRowValues: string[];
	/** 数据行,每行长度与 headers 对齐(短行补空串) */
	rows: string[][];
	/** 数据区第一行在文件里的行号(1 基),用于预览里标注「第 N 行」 */
	dataStartRow: number;
	/** 解析告警(空表头 / 重复表头 / 截断 / 行号不合法…):提示但不阻断 */
	warnings: string[];
	/** 文件里的**全部工作表名**(给界面做选择用) */
	sheetNames: string[];
	/** 这次实际用的工作表名 */
	sheetName: string;
};

/**
 * 解析选项 —— **行号一律 1 基**(界面里用户填的就是 Excel 的行号)。
 *
 * 默认对应最常见的三段式台账:第 1 行中文列名、第 2 行业务字段名、第 3 行起是数据。
 */
export type SheetParseOptions = {
	/** 表头(列名)所在行,1 基 */
	headerRow: number;
	/** 业务字段名所在行,1 基;`null` = 没有这一行 */
	fieldRow: number | null;
	/** 数据区起始行,1 基 */
	dataRow: number;
	/**
	 * **工作表名**(多 sheet 文件用;Excel/CSV 的 sheetname)。
	 * `null`/不填 = 用第一个工作表;填了但文件里没有 → 回退第一个并在 `warnings` 里列出可选工作表名。
	 */
	sheetName: string | null;
};

/** 三段式台账的默认行号:表头 1 / 业务字段 2 / 数据 3 */
export const SHEET_PARSE_DEFAULTS = { headerRow: 1, fieldRow: 2, dataRow: 3, sheetName: null } as const;

/** 只支持这三档行号(防止手填 999 把整份文件当表头);界面按此做输入约束 */
export const SHEET_ROW_MAX = 20;

/** 选项归一 + 合法性检查:返回可直接用于解析的行号 + 告警文案 */
export function normalizeSheetParseOptions(options: Partial<SheetParseOptions>): {
	options: SheetParseOptions;
	warnings: string[];
} {
	const warnings: string[] = [];
	const clamp = (value: number | null | undefined, fallback: number) => {
		if (value === null || value === undefined || Number.isNaN(value)) return fallback;
		return Math.min(SHEET_ROW_MAX, Math.max(1, Math.round(value)));
	};

	const headerRow = clamp(options.headerRow, SHEET_PARSE_DEFAULTS.headerRow);
	const fieldRowInput = options.fieldRow;
	const fieldRow = fieldRowInput === null ? null : clamp(fieldRowInput, SHEET_PARSE_DEFAULTS.fieldRow);
	const dataRow = clamp(options.dataRow, SHEET_PARSE_DEFAULTS.dataRow);
	const sheetNameRaw = typeof options.sheetName === "string" ? options.sheetName.trim() : "";
	const sheetName = sheetNameRaw.length > 0 ? sheetNameRaw : null;

	if (fieldRow !== null && fieldRow === headerRow) {
		warnings.push("业务字段行与表头行相同,已按「没有业务字段行」处理");
		return { options: { headerRow, fieldRow: null, dataRow, sheetName }, warnings };
	}
	if (dataRow <= headerRow) {
		warnings.push(`数据起始行(${dataRow})不能早于表头行(${headerRow}),已按表头行 +1 处理`);
		return { options: { headerRow, fieldRow, dataRow: headerRow + 1, sheetName }, warnings };
	}
	if (fieldRow !== null && fieldRow >= dataRow) {
		warnings.push(`业务字段行(${fieldRow})不在表头与数据之间,已按「没有业务字段行」处理`);
		return { options: { headerRow, fieldRow: null, dataRow, sheetName }, warnings };
	}
	return { options: { headerRow, fieldRow, dataRow, sheetName }, warnings };
}

/**
 * 上传前校验:返回错误文案;通过返回 `null`。
 * 参数用「文件名 + 大小」而不是 `File` 本体,便于纯函数测试与复用。
 */
export function validateSheetFile(file: { name: string; size: number }): string | null {
	const name = file.name.toLowerCase();
	if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
		return `「${file.name}」格式不支持,请上传 .xlsx / .xls / .csv`;
	}
	if (file.size === 0) return `「${file.name}」是空文件`;
	if (file.size > SHEET_FILE_MAX_MB * 1024 * 1024) {
		const mb = (file.size / 1024 / 1024).toFixed(1);
		return `「${file.name}」有 ${mb}MB,超过 ${SHEET_FILE_MAX_MB}MB 上限`;
	}
	return null;
}

/** 单元格 → 展示文本(日期按 Excel 的显示口径取值,不落序列号) */
function sheetCellText(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
	return "";
}

/**
 * 解析 xlsx / xls / csv → 表头 + 业务字段行 + 数据矩阵。
 *
 * 行号按 `options` 指定(1 基,默认表头 1 / 业务字段 2 / 数据 3);
 * `maxRows` 只截断数据行并给告警,防止误传十万行的导出文件把浏览器卡死。
 */
export function readSheetTable(
	buffer: ArrayBuffer,
	partial: Partial<SheetParseOptions> & { maxRows?: number } = {},
): SheetTable {
	const { options, warnings: optionWarnings } = normalizeSheetParseOptions(partial);
	const warnings: string[] = [...optionWarnings];
	const maxRows = partial.maxRows ?? 5000;
	const empty: SheetTable = {
		headers: [],
		fieldRowValues: [],
		rows: [],
		dataStartRow: options.dataRow,
		warnings,
		sheetNames: [],
		sheetName: "",
	};
	try {
		const book = XLSX.read(buffer, { type: "array" });
		const sheetNames = book.SheetNames;
		if (sheetNames.length === 0) return { ...empty, warnings: [...warnings, "文件里没有工作表"] };
		// 选工作表:指定了就用指定的;指定的不存在 → 回退第一个并把可选名字列出来(不静默)
		let usedSheet = sheetNames[0];
		if (options.sheetName) {
			if (sheetNames.includes(options.sheetName)) usedSheet = options.sheetName;
			else
				warnings.push(`文件里没有工作表「${options.sheetName}」,已改用「${usedSheet}」;可选:${sheetNames.join("、")}`);
		}
		const sheet = book.Sheets[usedSheet];
		if (!sheet) return { ...empty, sheetNames, warnings: [...warnings, "工作表里没有内容"] };

		// raw:false → 取 Excel 里"看到的文本"(日期不会变成 45123 这种序列号)
		const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
			header: 1,
			defval: "",
			blankrows: false,
			raw: false,
		});
		if (matrix.length === 0) return { ...empty, warnings: [...warnings, "文件里没有数据"] };

		const at = (rowNumber: number) => (matrix[rowNumber - 1] ?? []).map(sheetCellText);
		const headerCellsRaw = at(options.headerRow);
		const fieldCellsRaw = options.fieldRow === null ? [] : at(options.fieldRow);
		const dataRowsRaw = matrix.slice(options.dataRow - 1).map((row) => (row ?? []).map(sheetCellText));
		if (dataRowsRaw.length === 0) {
			warnings.push(`第 ${options.dataRow} 行起没有数据,请检查「数据起始行」`);
		}

		/**
		 * 有效列宽:从右往左去掉**表头、业务字段行与所有数据都为空**的列(Excel 常拖出一串空列),
		 * 但**只去掉真空列** —— 表头空、下面有数据的列必须留下(按「列N」占位),
		 * 否则那列数据会被静默丢掉。
		 */
		let width = Math.max(headerCellsRaw.length, fieldCellsRaw.length, ...dataRowsRaw.map((row) => row.length), 0);
		while (width > 0) {
			const headerEmpty = !headerCellsRaw[width - 1];
			const fieldEmpty = !fieldCellsRaw[width - 1];
			const columnEmpty = dataRowsRaw.every((row) => !row[width - 1]);
			if (headerEmpty && fieldEmpty && columnEmpty) width -= 1;
			else break;
		}
		if (width === 0) {
			return { ...empty, warnings: [...warnings, `第 ${options.headerRow} 行没有表头`] };
		}

		const seen = new Set<string>();
		const headers = headerCellsRaw.slice(0, width).map((text, index) => {
			const name = text || `列${index + 1}`;
			if (!text) warnings.push(`第 ${index + 1} 列没有表头,已按「${name}」占位`);
			if (seen.has(name)) warnings.push(`表头「${name}」重复,请修正后再导入`);
			seen.add(name);
			return name;
		});

		const truncated = dataRowsRaw.length > maxRows;
		if (truncated) warnings.push(`数据超过 ${maxRows} 行,只解析前 ${maxRows} 行`);
		const rows = dataRowsRaw.slice(0, maxRows).map((row) => headers.map((_, index) => row[index] ?? ""));

		// 整行为空的行直接丢掉(Excel 尾部常见)
		const nonEmpty = rows.filter((row) => row.some((cell) => cell !== ""));
		if (nonEmpty.length !== rows.length) warnings.push(`已忽略 ${rows.length - nonEmpty.length} 行空行`);

		return {
			headers,
			fieldRowValues: headers.map((_, index) => fieldCellsRaw[index] ?? ""),
			rows: nonEmpty,
			dataStartRow: options.dataRow,
			sheetNames,
			sheetName: usedSheet,
			warnings,
		};
	} catch (err) {
		return { ...empty, warnings: [...warnings, `文件解析失败:${err instanceof Error ? err.message : String(err)}`] };
	}
}

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
	if (Array.isArray(value)) return value.join("、");
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
	/**
	 * 文件名是否加 `-YYYY-MM-DD` 后缀。默认加(用户点「导出」时一天一个名字);
	 * **测试夹具**这类要长期复用的文件传 `false`,文件名才稳定(`doc/测试数据/*.xlsx`)。
	 */
	withDate = true,
	fieldRowValues,
}: {
	columns: readonly ExcelColumn<Key>[];
	rows: readonly object[];
	fileName: string;
	sheetName?: string;
	withDate?: boolean;
	/**
	 * **第二行 = 业务字段名**(台账的三段式:第 1 行中文列名 / 第 2 行业务字段名 / 第 3 行起数据)。
	 * 档案页与数据源明细的导入都按这个默认口径解析(`SHEET_PARSE_DEFAULTS` 的 fieldRow = 2),
	 * 所以夹具文件要带这一行 —— 不带的话第 2 行会被当成"业务字段行"吃掉。
	 */
	fieldRowValues?: readonly string[];
}): number {
	buildAndSave({ columns, rows, fileName, sheetName, withDate, fieldRowValues });
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
	fieldRowValues,
}: {
	columns: readonly ExcelColumn<Key>[];
	rows: readonly object[];
	fileName: string;
	sheetName: string;
	withDate: boolean;
	fieldRowValues?: readonly string[];
}): void {
	const sheet = XLSX.utils.aoa_to_sheet([
		columns.map((column) => column.label),
		...(fieldRowValues ? [fieldRowValues.map((value) => String(value))] : []),
		...rows.map((row) => {
			const record = row as Record<string, unknown>;
			return columns.map((column) => cellText(record[column.key]));
		}),
	]);
	sheet["!cols"] = columns.map((column) => ({ wch: column.width }));
	const book = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(book, sheet, sheetName);
	// 日期只在用户点击导出时求值(不在渲染期),不参与 SSR 水合
	const suffix = withDate ? `-${new Date().toISOString().slice(0, 10)}` : "";
	XLSX.writeFile(book, `${fileName}${suffix}.xlsx`);
}
