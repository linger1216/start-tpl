import type { ExcelColumn, ImportField } from "#/lib/excel";

import type { RoleRow } from "./settings-roles-table";

/**
 * 角色台账的 Excel 列契约 —— 表头与列宽**只在这里写一份**。
 *
 * 导出的 xlsx 能被「导入角色」直接读回来(两边同一组表头),所以这里既是导出契约、
 * 也是导入模板的字段来源(见 `ROLE_IMPORT_FIELDS`)。
 *
 * `status` 落成中文「启用 / 停用」而不是 0/1:让人看着就懂;导入侧两种写法都认。
 */
export type RoleExcelKey = "name" | "sort" | "status" | "remark";

export const ROLE_EXCEL_COLUMNS: readonly ExcelColumn<RoleExcelKey>[] = [
	{ key: "name", label: "角色名", width: 20, required: true },
	{ key: "sort", label: "排序", width: 8 },
	{ key: "status", label: "状态", width: 10 },
	{ key: "remark", label: "备注", width: 30 },
];

/** 导入对话框的字段 = 导出的表头(同一份契约,不手抄第二遍) */
export const ROLE_IMPORT_FIELDS: ImportField[] = ROLE_EXCEL_COLUMNS.map((column) => ({ ...column }));

/** 导出:一行一个角色;状态写中文,空值写空串(`writeSheet` 会把 null/undefined 落成空单元格) */
export function roleExcelRows(rows: readonly RoleRow[]): Array<Record<RoleExcelKey, string>> {
	return rows.map((row) => ({
		name: row.name,
		sort: String(row.sort),
		status: Number(row.status ?? 1) === 1 ? "启用" : "停用",
		remark: row.remark ?? "",
	}));
}
