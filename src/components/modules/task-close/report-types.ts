import type { inferRouterOutputs } from "@trpc/server";
import type { TRPCRouter } from "#/integrations/trpc/router";
import type { TaskReportSchema } from "#/lib/task/report-spec";

/** 填报值 / 行 / 附件行 / 字段形状 —— 编辑区、只读区、表格视图共用(真源在 `lib/task/report-spec.ts`) */
export type { ReportRow as Row, ReportValue as Value } from "#/lib/task/report-spec";
/** reportGet 带回来的附件行(按 id 查文件名) */
export type ReportFile = ReportData["files"][number];
/** 顶层字段与数组元素字段的公共形状(元素层没有 allowEmpty) */
export type ReportFieldLike = Omit<TaskReportSchema["fields"][number], "allowEmpty" | "required"> & {
	allowEmpty?: boolean;
	required?: boolean;
};
export type ReportData = NonNullable<inferRouterOutputs<TRPCRouter>["taskClose"]["reportGet"]>;

/**
 * 表格里一列的下限宽度 —— 日期、附件、多选天生占地方,文本窄。
 * 按类型给宽度,免得一张表里「隐患等级」和「照片」互相挤扁。
 */
export function fieldColWidth(field: ReportFieldLike): string {
	switch (field.type) {
		case "date":
			return "min-w-36";
		case "datetime":
			return "min-w-44";
		case "attachment":
			return "min-w-48";
		case "multiselect":
			return "min-w-40";
		case "integer":
		case "decimal":
			return "min-w-28";
		default:
			return "min-w-32";
	}
}

/** 文本型填报控件的输入属性。 */
export function textControlAttrs(field: ReportFieldLike) {
	const numeric = field.type === "integer" || field.type === "decimal";
	return {
		type: field.type === "phone" ? "tel" : field.type === "email" ? "email" : numeric ? "number" : "text",
		inputMode: field.type === "phone" ? "tel" : field.type === "email" ? "email" : numeric ? "decimal" : undefined,
		step: field.type === "decimal" ? "any" : undefined,
		placeholder:
			field.type === "phone"
				? "11 位手机号,如 13800138000"
				: field.type === "email"
					? "name@example.com"
					: numeric
						? "0"
						: "文本",
	} as const;
}

/** 文本输入与只读值使用同一字符串口径。 */
export function textValueOf(value: string | number | boolean | null | undefined): string {
	return value == null ? "" : String(value);
}
