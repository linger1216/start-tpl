import { z } from "zod";
import { MAX_TEXT_LENGTH } from "#/lib/task/close-spec";
import { isRecord } from "#/lib/task/json";
import { MAX_ATTACHMENTS } from "#/lib/task/payload";

/** 数组字段(元素数组 / 表格)的最大元素数 —— zod 校验与前端「添加」按钮共用。 */
export const MAX_ARRAY_ITEMS = 200;

/**
 * 字段类型 —— **唯一真源**:值清单、中文文案、zod 枚举、界面下拉全从这里派生。
 * (数组元素层不允许再套数组,所以元素类型比顶层类型少一个 `array`。)
 */
export const REPORT_FIELD_TYPES = [
	{ value: "text", label: "文本" },
	{ value: "phone", label: "手机号码" },
	{ value: "email", label: "邮箱" },
	{ value: "integer", label: "整数" },
	{ value: "decimal", label: "小数" },
	{ value: "date", label: "日期" },
	{ value: "datetime", label: "日期时间" },
	{ value: "select", label: "单选" },
	{ value: "multiselect", label: "多选" },
	{ value: "attachment", label: "文件附件" },
] as const;

/** 顶层字段类型 = 元素字段类型 + `array`。 */
export const REPORT_TOP_FIELD_TYPES = [...REPORT_FIELD_TYPES, { value: "array", label: "数组" }] as const;

export type ReportFieldType = (typeof REPORT_FIELD_TYPES)[number]["value"];
export type ReportTopFieldType = (typeof REPORT_TOP_FIELD_TYPES)[number]["value"];

const fieldTypeValues = REPORT_FIELD_TYPES.map((item) => item.value) as [ReportFieldType, ...ReportFieldType[]];
const topFieldTypeValues = REPORT_TOP_FIELD_TYPES.map((item) => item.value) as [
	ReportTopFieldType,
	...ReportTopFieldType[],
];

/** 合并字典显示名，超过字段上限时保留原选项并交由调用方提示。 */
export function mergeReportOptions(current: readonly string[], labels: readonly string[]): string[] | null {
	const merged = [...new Set([...current, ...labels.map((label) => label.trim()).filter(Boolean)])];
	return merged.length <= 100 ? merged : null;
}

/** 填报结构是业务数据，不依赖具体表格组件。发布后作为不可变版本保存。 */
const fieldId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const condition = z.object({ field: fieldId, equals: scalar });

/**
 * 顶层字段与数组元素字段的**公共部分** —— 两者逐项相同,只有 `type` 的可选集合与几项特有属性不同。
 *
 * 之前两份 schema 各写一遍(标签长度、选项长度、必填、只读、条件必填各出现两次),
 * 加一个字段属性要改两处。现在公共部分只写一次。
 */
const fieldBaseShape = {
	id: fieldId,
	label: z.string().trim().min(1).max(100),
	required: z.boolean().default(false),
	readOnly: z.boolean().default(false),
	/** 单选 / 多选的候选值 */
	options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
	/** 条件必填:另一个字段等于某值时,这一项才必填 */
	requiredWhen: condition.optional(),
};

/** 数组元素里的字段 —— **不允许再套数组**(只有一层),所以没有 `itemFields` */
const itemFieldSchema = z.object({
	...fieldBaseShape,
	type: z.enum(fieldTypeValues),
});

const taskReportFieldSchema = z.object({
	...fieldBaseShape,
	type: z.enum(topFieldTypeValues),
	/** 单选:是否允许填「空」。填报表单的下拉里因此多一个「（空）」项 */
	allowEmpty: z.boolean().default(false),
	defaultValue: z.union([scalar, z.array(z.string().max(200)).max(100)]).optional(),
	/**
	 * **数组类型**:元素对象的字段(至少 1 个,元素层不再允许数组)。
	 * 填报时每个元素就是一个"小对象":页面给「添加」按钮,一次加一条。
	 */
	itemFields: z.array(itemFieldSchema).max(50).optional(),
});

export const taskReportSchema = z
	.object({
		id: fieldId,
		kind: z.enum(["OBJECT", "TABLE", "EXCEL"]),
		fields: z.array(taskReportFieldSchema).max(100),
		excel: z
			.object({
				templateFileId: z.string().trim().min(1).max(32),
				sheetName: z.string().trim().min(1).max(31),
				dataStartRow: z.number().int().min(1).max(10000),
			})
			.optional(),
		rules: z
			.array(
				z.object({
					left: fieldId,
					op: z.enum(["lte", "gte", "eq"]),
					right: fieldId,
					message: z.string().trim().min(1).max(200),
				}),
			)
			.max(50)
			.default([]),
	})
	.superRefine((schema, ctx) => {
		if (schema.kind === "EXCEL") {
			if (!schema.excel) ctx.addIssue({ code: "custom", path: ["excel"], message: "Excel 类型必须配置工作簿模板" });
			if (schema.fields.length > 0 || schema.rules.length > 0)
				ctx.addIssue({ code: "custom", path: ["fields"], message: "Excel 类型不配置结构化字段" });
			return;
		}
		if (schema.fields.length === 0)
			ctx.addIssue({ code: "custom", path: ["fields"], message: "表单或表格至少配置一个字段" });
		if (schema.excel) ctx.addIssue({ code: "custom", path: ["excel"], message: "只有 Excel 类型可以配置工作簿模板" });
		const ids = new Set(schema.fields.map((field) => field.id));
		if (ids.size !== schema.fields.length) ctx.addIssue({ code: "custom", message: "字段标识不能重复" });
		for (const [index, field] of schema.fields.entries()) {
			if (field.type === "attachment" && field.defaultValue != null)
				ctx.addIssue({ code: "custom", path: ["fields", index, "defaultValue"], message: "附件不能设置默认值" });
			if (field.type === "array") {
				if (!field.itemFields?.length)
					ctx.addIssue({
						code: "custom",
						path: ["fields", index, "itemFields"],
						message: "数组字段至少要有一个元素字段",
					});
				const itemIds = new Set((field.itemFields ?? []).map((item) => item.id));
				if (itemIds.size !== (field.itemFields ?? []).length)
					ctx.addIssue({ code: "custom", path: ["fields", index, "itemFields"], message: "元素字段标识不能重复" });
				for (const [itemIndex, item] of (field.itemFields ?? []).entries()) {
					if ((item.type === "select" || item.type === "multiselect") && !item.options?.length)
						ctx.addIssue({
							code: "custom",
							path: ["fields", index, "itemFields", itemIndex, "options"],
							message: "选择字段必须配置选项",
						});
					if (item.options && new Set(item.options).size !== item.options.length)
						ctx.addIssue({
							code: "custom",
							path: ["fields", index, "itemFields", itemIndex, "options"],
							message: "选项不能重复",
						});
				}
				for (const item of field.itemFields ?? [])
					if (item.requiredWhen && (!itemIds.has(item.requiredWhen.field) || item.requiredWhen.field === item.id))
						ctx.addIssue({
							code: "custom",
							path: ["fields", index, "itemFields"],
							message: "元素字段的条件引用不存在",
						});
			} else if (field.itemFields) {
				ctx.addIssue({ code: "custom", path: ["fields", index, "itemFields"], message: "只有数组字段可以带元素字段" });
			}
			if ((field.type === "select" || field.type === "multiselect") && !field.options?.length)
				ctx.addIssue({ code: "custom", path: ["fields", index, "options"], message: "选择字段必须配置选项" });
			if (field.options && new Set(field.options).size !== field.options.length)
				ctx.addIssue({ code: "custom", path: ["fields", index, "options"], message: "选项不能重复" });
			if (field.requiredWhen && (!ids.has(field.requiredWhen.field) || field.requiredWhen.field === field.id))
				ctx.addIssue({ code: "custom", path: ["fields", index, "requiredWhen"], message: "条件字段不存在或引用自身" });
		}
		for (const [index, rule] of schema.rules.entries())
			if (!ids.has(rule.left) || !ids.has(rule.right))
				ctx.addIssue({ code: "custom", path: ["rules", index], message: "规则字段不存在" });
	});

export type TaskReportSchema = z.infer<typeof taskReportSchema>;
type TaskReportIssue = { row: number | null; field: string; message: string };
/** 填报值 / 行 —— **唯一真源**(界面与只读区都从这里 import) */
export type ReportValue = string | number | boolean | string[] | Array<Record<string, ReportValue>> | null;
export type ReportRow = Record<string, ReportValue>;

/**
 * 填报值 → **行数组**(统一形状):表格就是它本身,表单包成单行。
 *
 * 全模块只此一处做「值 ↔ 行」的形状归一 —— 校验、附件提取、父子组合、导出都按行数组走。
 */
export function reportRowsOf(schema: TaskReportSchema, payload: unknown): ReportRow[] {
	if (schema.kind === "EXCEL") return [];
	if (schema.kind === "TABLE")
		return (
			Array.isArray(payload)
				? payload
				: isRecord(payload) && Array.isArray(payload.__records)
					? payload.__records.filter(isRecord)
					: []
		) as ReportRow[];
	if (isRecord(payload) && Array.isArray(payload.__records)) return payload.__records.filter(isRecord) as ReportRow[];
	return isRecord(payload) ? [payload as ReportRow] : [];
}

/**
 * 行数组 → 填报值(与 `reportRowsOf` 互逆)。调用点**自己知道**是哪种模板,所以这里拆成两个,
 * 返回类型不再是联合 —— 免得每个调用点都写 `as` 或 `Array.isArray`。
 */
export const asTableValue = (rows: readonly ReportRow[]): ReportRow[] => rows as ReportRow[];

/** 表单模板:取第一行(空则给空对象,前端才能无脑 `row[field.id]`) */
export const asFormValue = (rows: readonly ReportRow[]): ReportRow => rows[0] ?? {};

/** 只从模板声明的附件字段提取文件 ID，避免把普通文本误当作附件。 */
export function reportAttachmentIds(schema: TaskReportSchema, rows: readonly unknown[]): string[] {
	const asIds = (input: unknown) =>
		Array.isArray(input) ? input.filter((id): id is string => typeof id === "string") : [];
	const ids: string[] = [];
	for (const row of rows) {
		if (!isRecord(row)) continue;
		const record = row;
		for (const field of schema.fields) {
			if (field.type === "attachment") {
				ids.push(...asIds(record[field.id]));
				continue;
			}
			// 数组元素的附件字段也要算进来(否则嵌套附件签不出地址、也校验不到存在性)
			if (field.type !== "array") continue;
			const items = Array.isArray(record[field.id]) ? (record[field.id] as unknown[]) : [];
			for (const item of items) {
				if (!isRecord(item)) continue;
				for (const sub of field.itemFields ?? []) {
					if (sub.type !== "attachment") continue;
					ids.push(...asIds(item[sub.id]));
				}
			}
		}
	}
	return [...new Set(ids)];
}

/** 一行填报数据的运行时形状(键 = 字段标识;值 = ReportValue)。建任务直带行(`report.rows`)时用它把关。 */
export const reportRowSchema = z.record(
	z.string(),
	z.union([
		z.string().max(MAX_TEXT_LENGTH),
		z.number().finite(),
		z.boolean(),
		z.array(z.string().max(200)).max(100),
		z.array(z.record(z.string(), z.unknown())).max(MAX_ARRAY_ITEMS),
		z.null(),
	]),
);

/** 剪贴板 TSV → 矩形网格;末尾空行丢掉(Excel 复制的尾换行不算一行)。 */
function parseClipboardGrid(text: string): string[][] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.map((line) => line.split("\t"));
}

/** 按字段类型把一格文本转成填报值;转不了的保留原文,交给提交校验定位。 */
function cellValue(field: TaskReportSchema["fields"][number], raw: string): ReportValue {
	const text = raw.trim();
	if (!text) return null;
	switch (field.type) {
		case "integer":
		case "decimal": {
			const value = Number(text);
			return Number.isFinite(value) ? value : text;
		}
		case "multiselect":
			return text
				.split(/[,，]/)
				.map((item) => item.trim())
				.filter(Boolean);
		default:
			return text;
	}
}

/** 自 (startRow, startField) 起写入粘贴区;超出表格行列的部分丢弃,区域外单元格不动。 */
export function pasteReportGrid(
	schema: TaskReportSchema,
	rows: ReportRow[],
	startRow: number,
	startField: number,
	text: string,
): ReportRow[] {
	const grid = parseClipboardGrid(text);
	if (!grid.length) return rows;
	const next = rows.map((row) => ({ ...row }));
	for (const [offset, cells] of grid.entries()) {
		const rowIndex = startRow + offset;
		if (rowIndex >= next.length) break;
		for (const [column, raw] of cells.entries()) {
			const field = schema.fields[startField + column];
			if (!field || field.readOnly || field.type === "attachment" || field.type === "array") continue;
			next[rowIndex][field.id] = cellValue(field, raw);
		}
	}
	return next;
}

/**
 * 被校验的一个字段 —— 顶层字段与数组元素字段的公共形状。
 *
 * 元素层没有 `allowEmpty`、类型里也没有 `array`,但**判定规则完全相同**,所以两边都用这一个类型。
 */
type ValueField = {
	id: string;
	label: string;
	type: TaskReportSchema["fields"][number]["type"];
	required?: boolean;
	options?: string[];
	defaultValue?: unknown;
	requiredWhen?: { field: string; equals: ReportValue };
	itemFields?: TaskReportSchema["fields"][number]["itemFields"];
};

/**
 * 一个字段值的判定 —— **顶层字段与数组元素字段共用这一套规则**(之前两处各写一遍,改一边必漏另一边)。
 *
 * 返回 `null` = 合法;否则给出「为什么不行」:
 *  - `required` —— 空值但这一项必填(含 `requiredWhen` 条件必填);
 *  - `invalid` —— 非空但值不合法,`reason` 是给用户看的原因。
 *
 * 措辞不在这里定:顶层字段的消息由界面拼(它知道字段名),数组元素的要带「第几项」——
 * 所以这里只给**判定**,不给文案。
 */
function fieldIssueOf(
	field: ValueField,
	value: unknown,
	row: Record<string, unknown>,
): { kind: "required" } | { kind: "invalid"; reason: string } | null {
	const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
	if (empty) {
		const required =
			field.required || (field.requiredWhen && row[field.requiredWhen.field] === field.requiredWhen.equals);
		return required ? { kind: "required" } : null;
	}
	const reason = invalidReason(field, value);
	return reason ? { kind: "invalid", reason } : null;
}

/**
 * 一个值能不能过 —— 返回**给用户看的原因**,`null` = 合法(空值不在这里判,必填另有分支)。
 * 抽出来是因为数组元素要按同一套规则逐项校验。
 */
function invalidReason(field: ValueField, value: unknown): string | null {
	switch (field.type) {
		case "text":
			return typeof value === "string" && value.length <= MAX_TEXT_LENGTH ? null : "值的类型或选项无效";
		case "phone":
			return typeof value === "string" && /^1[3-9]\d{9}$/.test(value) ? null : "手机号码格式不正确";
		case "email":
			return typeof value === "string" && value.length <= 254 && z.email().safeParse(value).success
				? null
				: "邮箱格式不正确";
		case "attachment":
			return Array.isArray(value) &&
				value.length <= MAX_ATTACHMENTS &&
				new Set(value).size === value.length &&
				value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 32)
				? null
				: "附件格式无效";
		case "integer":
			return typeof value === "number" && Number.isSafeInteger(value) ? null : "值的类型或选项无效";
		case "decimal":
			return typeof value === "number" && Number.isFinite(value) ? null : "值的类型或选项无效";
		case "select":
			return typeof value === "string" && !!field.options?.includes(value) ? null : "值的类型或选项无效";
		case "multiselect":
			return Array.isArray(value) &&
				value.length <= 100 &&
				new Set(value).size === value.length &&
				value.every((item) => typeof item === "string" && field.options?.includes(item))
				? null
				: "值的类型或选项无效";
		case "date":
			return typeof value === "string" &&
				/^\d{4}-\d{2}-\d{2}$/.test(value) &&
				!Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
				new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
				? null
				: "日期格式不正确";
		case "datetime":
			return typeof value === "string" &&
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
				!Number.isNaN(Date.parse(value))
				? null
				: "日期时间格式不正确";
		case "array": {
			if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) return "数组格式无效";
			const allowed = new Set((field.itemFields ?? []).map((item) => item.id));
			for (const [itemIndex, item] of value.entries()) {
				if (!isRecord(item)) return `第 ${itemIndex + 1} 项格式无效`;
				const itemRow = item;
				if (Object.keys(itemRow).some((key) => !allowed.has(key))) return `第 ${itemIndex + 1} 项包含未知字段`;
				for (const sub of field.itemFields ?? []) {
					const issue = fieldIssueOf(sub, itemRow[sub.id], itemRow);
					if (!issue) continue;
					if (issue.kind === "required") return `第 ${itemIndex + 1} 项「${sub.label}」必填`;
					return `第 ${itemIndex + 1} 项「${sub.label}」${issue.reason}`;
				}
			}
			return null;
		}
	}
}

/** 填报规模上限(行数 / 序列化字节)—— 保存校验、Excel、建任务入参共用。 */
export const MAX_REPORT_ROWS = 10000;
export const MAX_REPORT_BYTES = 2_000_000;
/** 填报 Excel 的文件大小上限(字节)—— 前端先行拦截,服务端 base64 上限另算。 */
export const MAX_REPORT_FILE_BYTES = 5 * 1024 * 1024;

/** 实时保存即整份校验,只有空表豁免(空表 = 撤销提交);返回可定位的错误。 */
export function validateTaskReport(schema: TaskReportSchema, value: unknown): TaskReportIssue[] {
	if (schema.kind === "EXCEL") return [];
	const rows = schema.kind === "TABLE" ? value : [value];
	if (!Array.isArray(rows) || rows.length > MAX_REPORT_ROWS || (schema.kind === "TABLE" && rows.length === 0))
		return [{ row: null, field: "", message: "填报行数无效" }];
	const issues: TaskReportIssue[] = [];
	const add = (index: number, field: string, message: string) =>
		issues.push({ row: schema.kind === "TABLE" ? index : null, field, message });
	for (const [index, input] of rows.entries()) {
		if (!isRecord(input)) {
			add(index, "", "记录格式无效");
			continue;
		}
		const row = input;
		for (const field of schema.fields) {
			const issue = fieldIssueOf(field, row[field.id], row);
			if (!issue) continue;
			add(index, field.id, issue.kind === "required" ? "此项必填" : issue.reason);
		}
		for (const rule of schema.rules) {
			const left = row[rule.left];
			const right = row[rule.right];
			if (left == null || right == null || left === "" || right === "") continue;
			const comparable =
				(typeof left === "number" && typeof right === "number") ||
				(typeof left === "string" && typeof right === "string");
			const valid =
				comparable && (rule.op === "eq" ? left === right : rule.op === "lte" ? left <= right : left >= right);
			if (!valid) add(index, rule.left, rule.message);
		}
		const allowed = new Set(schema.fields.map((field) => field.id));
		for (const key of Object.keys(row)) if (!allowed.has(key)) add(index, key, "未知字段");
	}
	return issues;
}

/** 由稳定键定位异步写入目标；已删除的目标不会转移到其他行。 */
export function updateKeyedItem<T>(items: T[], keys: readonly string[], key: string, update: (item: T) => T): T[] {
	const index = keys.indexOf(key);
	if (index < 0 || index >= items.length) return items;
	return items.map((item, i) => (i === index ? update(item) : item));
}

/** 行满足所有范围条件；空范围允许所有行。 */
export function rowMatchesFilter(row: unknown, filter: ReadonlyArray<{ field: string; value: unknown }>): boolean {
	if (filter.length === 0) return true;
	if (!isRecord(row)) return false;
	const record = row;
	return filter.every((condition) => (record[condition.field] ?? null) === condition.value);
}
