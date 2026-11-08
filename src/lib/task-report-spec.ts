import { z } from "zod";

/** 填报结构是业务数据，不依赖具体表格组件。发布后作为不可变版本保存。 */
const fieldId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const condition = z.object({ field: fieldId, equals: scalar });

export const taskReportFieldSchema = z.object({
	id: fieldId,
	label: z.string().trim().min(1).max(100),
	type: z.enum(["text", "integer", "decimal", "date", "datetime", "select", "multiselect", "boolean"]),
	required: z.boolean().default(false),
	readOnly: z.boolean().default(false),
	defaultValue: z.union([scalar, z.array(z.string().max(200)).max(100)]).optional(),
	options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
	requiredWhen: condition.optional(),
});

export const taskReportSchema = z
	.object({
		id: fieldId,
		kind: z.enum(["OBJECT", "TABLE"]),
		fields: z.array(taskReportFieldSchema).min(1).max(100),
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
		const ids = new Set(schema.fields.map((field) => field.id));
		if (ids.size !== schema.fields.length) ctx.addIssue({ code: "custom", message: "字段标识不能重复" });
		for (const [index, field] of schema.fields.entries()) {
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
export type TaskReportIssue = { row: number | null; field: string; message: string };
export type ReportValue = string | number | boolean | string[] | null;
export type ReportRow = Record<string, ReportValue>;

/** 剪贴板 TSV → 矩形网格;末尾空行丢掉(Excel 复制的尾换行不算一行)。 */
export function parseClipboardGrid(text: string): string[][] {
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
		case "boolean":
			return /^(true|1|是|y|yes)$/i.test(text);
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
			if (!field || field.readOnly) continue;
			next[rowIndex][field.id] = cellValue(field, raw);
		}
	}
	return next;
}

/** 草稿可不完整；正式提交逐字段检查并返回可定位的错误。 */
export function validateTaskReport(schema: TaskReportSchema, value: unknown): TaskReportIssue[] {
	const rows = schema.kind === "TABLE" ? value : [value];
	if (!Array.isArray(rows) || rows.length > 10000 || (schema.kind === "TABLE" && rows.length === 0))
		return [{ row: null, field: "", message: "填报行数无效" }];
	const issues: TaskReportIssue[] = [];
	const add = (index: number, field: string, message: string) =>
		issues.push({ row: schema.kind === "TABLE" ? index : null, field, message });
	for (const [index, input] of rows.entries()) {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			add(index, "", "记录格式无效");
			continue;
		}
		const row = input as Record<string, unknown>;
		for (const field of schema.fields) {
			const value = row[field.id];
			const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
			const required =
				field.required || (field.requiredWhen && row[field.requiredWhen.field] === field.requiredWhen.equals);
			if (empty) {
				if (required) add(index, field.id, "此项必填");
				continue;
			}
			let valid = false;
			switch (field.type) {
				case "text":
					valid = typeof value === "string" && value.length <= 5000;
					break;
				case "integer":
					valid = typeof value === "number" && Number.isSafeInteger(value);
					break;
				case "decimal":
					valid = typeof value === "number" && Number.isFinite(value);
					break;
				case "boolean":
					valid = typeof value === "boolean";
					break;
				case "select":
					valid = typeof value === "string" && !!field.options?.includes(value);
					break;
				case "multiselect":
					valid =
						Array.isArray(value) &&
						value.length <= 100 &&
						new Set(value).size === value.length &&
						value.every((item) => typeof item === "string" && field.options?.includes(item));
					break;
				case "date":
					valid =
						typeof value === "string" &&
						/^\d{4}-\d{2}-\d{2}$/.test(value) &&
						!Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
						new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
					break;
				case "datetime":
					valid =
						typeof value === "string" &&
						/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
						!Number.isNaN(Date.parse(value));
					break;
			}
			if (!valid) add(index, field.id, "值的类型或选项无效");
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
