import { z } from "zod";

/** 填报结构是业务数据，不依赖具体表格组件。发布后作为不可变版本保存。 */
const fieldId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const condition = z.object({ field: fieldId, equals: scalar });

/** 数组元素里的字段 —— **不允许再套数组**(只有一层),所以单独一份、不含 `itemFields` */
const itemFieldSchema = z.object({
	id: fieldId,
	label: z.string().trim().min(1).max(100),
	type: z.enum([
		"text",
		"phone",
		"email",
		"attachment",
		"integer",
		"decimal",
		"date",
		"datetime",
		"select",
		"multiselect",
	]),
	required: z.boolean().default(false),
	readOnly: z.boolean().default(false),
	options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
	requiredWhen: condition.optional(),
});

const taskReportFieldSchema = z.object({
	id: fieldId,
	label: z.string().trim().min(1).max(100),
	type: z.enum([
		"text",
		"phone",
		"email",
		"attachment",
		"integer",
		"decimal",
		"date",
		"datetime",
		"select",
		"multiselect",
		"array",
	]),
	required: z.boolean().default(false),
	/** 单选:是否允许填「空」。填报表单的下拉里因此多一个「（空）」项 */
	allowEmpty: z.boolean().default(false),
	readOnly: z.boolean().default(false),
	defaultValue: z.union([scalar, z.array(z.string().max(200)).max(100)]).optional(),
	options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
	requiredWhen: condition.optional(),
	/**
	 * **数组类型**:元素对象的字段(至少 1 个,元素层不再允许数组)。
	 * 填报时每个元素就是一个"小对象":页面给「添加」按钮,一次加一条。
	 */
	itemFields: z.array(itemFieldSchema).max(50).optional(),
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
				const itemIdsSet = new Set((field.itemFields ?? []).map((item) => item.id));
				for (const item of field.itemFields ?? [])
					if (item.requiredWhen && (!itemIdsSet.has(item.requiredWhen.field) || item.requiredWhen.field === item.id))
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
export type TaskReportIssue = { row: number | null; field: string; message: string };
export type ReportValue = string | number | boolean | string[] | Array<Record<string, ReportValue>> | null;
export type ReportRow = Record<string, ReportValue>;

/** 只从模板声明的附件字段提取文件 ID，避免把普通文本误当作附件。 */
export function reportAttachmentIds(schema: TaskReportSchema, value: unknown): string[] {
	const rows = schema.kind === "TABLE" ? (Array.isArray(value) ? value : []) : [value];
	const asIds = (input: unknown) =>
		Array.isArray(input) ? input.filter((id): id is string => typeof id === "string") : [];
	const ids: string[] = [];
	for (const row of rows) {
		if (!row || typeof row !== "object" || Array.isArray(row)) continue;
		const record = row as Record<string, unknown>;
		for (const field of schema.fields) {
			if (field.type === "attachment") {
				ids.push(...asIds(record[field.id]));
				continue;
			}
			// 数组元素的附件字段也要算进来(否则嵌套附件签不出地址、也校验不到存在性)
			if (field.type !== "array") continue;
			const items = Array.isArray(record[field.id]) ? (record[field.id] as unknown[]) : [];
			for (const item of items) {
				if (!item || typeof item !== "object" || Array.isArray(item)) continue;
				for (const sub of field.itemFields ?? []) {
					if (sub.type !== "attachment") continue;
					ids.push(...asIds((item as Record<string, unknown>)[sub.id]));
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
		z.string().max(5000),
		z.number().finite(),
		z.boolean(),
		z.array(z.string().max(200)).max(100),
		z.array(z.record(z.string(), z.unknown())).max(200),
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

/** 数组元素里的字段也走同一套类型判定(元素层不再允许数组) */
type ValueField = {
	id: string;
	label: string;
	type: Exclude<TaskReportSchema["fields"][number]["type"], "array"> | "array";
	required?: boolean;
	options?: string[];
	defaultValue?: unknown;
	requiredWhen?: { field: string; equals: ReportValue };
	itemFields?: TaskReportSchema["fields"][number]["itemFields"];
};

/**
 * 一个值能不能过 —— 返回**给用户看的原因**,`null` = 合法(空值不在这里判,必填另有分支)。
 * 抽出来是因为数组元素要按同一套规则逐项校验。
 */
function invalidReason(field: ValueField, value: unknown): string | null {
	switch (field.type) {
		case "text":
			return typeof value === "string" && value.length <= 5000 ? null : "值的类型或选项无效";
		case "phone":
			return typeof value === "string" && /^1[3-9]\d{9}$/.test(value) ? null : "手机号码格式不正确";
		case "email":
			return typeof value === "string" && value.length <= 254 && z.email().safeParse(value).success
				? null
				: "邮箱格式不正确";
		case "attachment":
			return Array.isArray(value) &&
				value.length <= 20 &&
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
			if (!Array.isArray(value) || value.length > 200) return "数组格式无效";
			for (const [itemIndex, item] of value.entries()) {
				if (!item || typeof item !== "object" || Array.isArray(item)) return `第 ${itemIndex + 1} 项格式无效`;
				const itemRow = item as Record<string, unknown>;
				for (const sub of field.itemFields ?? []) {
					const subValue = itemRow[sub.id];
					const subEmpty = subValue == null || subValue === "" || (Array.isArray(subValue) && subValue.length === 0);
					const subRequired =
						sub.required || (sub.requiredWhen && itemRow[sub.requiredWhen.field] === sub.requiredWhen.equals);
					if (subEmpty) {
						if (subRequired) return `第 ${itemIndex + 1} 项「${sub.label}」必填`;
						continue;
					}
					const reason = invalidReason(sub, subValue);
					if (reason) return `第 ${itemIndex + 1} 项「${sub.label}」${reason}`;
				}
			}
			return null;
		}
	}
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
			const reason = invalidReason(field, value);
			if (reason) add(index, field.id, reason);
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
