import type { ExcelColumn, ImportField } from "#/lib/excel";

import type { UserRow } from "./settings-users-table";

/**
 * 用户台账的 Excel 列契约 —— 表头与列宽**只在这里写一份**。
 *
 * ⚠️ **导出的文件回导时需要手补一列「初始密码」**:密码是散列存的(`sys_account`),
 * 永远导不出来。所以导入的字段(`USER_IMPORT_FIELDS`)比导出的列多这一列,其余同表头 ——
 * 拿导出的文件当模板,补上密码列就能回导。
 *
 * 「角色」「部门」是**多值**:导出用 `、` 连接,导入侧 `、` `,` `;` 与空白都认
 * (服务端 `routers/user.ts` 的 `splitNames` 与这里的 `MULTI_SEP` 配套)。
 */
export type UserExcelKey = "name" | "email" | "roles" | "departments" | "emailVerified";

/** 多值单元格的分隔符 —— 导入侧允许的写法更宽,导出只用它 */
export const MULTI_SEP = "、";

export const USER_EXCEL_COLUMNS: readonly ExcelColumn<UserExcelKey>[] = [
	{ key: "name", label: "姓名", width: 16, required: true },
	{ key: "email", label: "邮箱", width: 30, required: true },
	{ key: "roles", label: "角色", width: 24 },
	{ key: "departments", label: "部门", width: 30 },
	{ key: "emailVerified", label: "邮箱已验证", width: 12 },
];

/** 导入字段 = 导出的表头 + 「初始密码」(密码导不出来,只能手填) */
export const USER_IMPORT_FIELDS: ImportField[] = [
	{ key: "name", label: "姓名", width: 16, required: true },
	{ key: "email", label: "邮箱", width: 30, required: true },
	{ key: "password", label: "初始密码", width: 18, required: true },
	{ key: "roles", label: "角色", width: 24 },
	{ key: "departments", label: "部门", width: 30 },
];

/** 导出:一行一个人;多值列用 `、` 连接,布尔列写「是 / 否」 */
export function userExcelRows(rows: readonly UserRow[]): Array<Record<UserExcelKey, string>> {
	return rows.map((row) => ({
		name: row.name,
		email: row.email,
		roles: row.roleNames.join(MULTI_SEP),
		departments: row.departmentNames.join(MULTI_SEP),
		emailVerified: row.emailVerified ? "是" : "否",
	}));
}
