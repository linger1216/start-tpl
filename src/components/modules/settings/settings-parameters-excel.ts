/**
 * 参数管理的 Excel 列契约 —— 导出表头、导入字段、行摊平都在这一处(页面只负责接线)。
 *
 * 口径:**一行 = 一条参数**(`sys_para` 的业务键是 `para_key`),所以导出与导入共用同一组表头,
 * 导出的文件能直接回导。`para.import` 的语义是 **upsert**(有就改、没有就建),见那支过程的注释。
 *
 * 「类型」列导出的是**中文名**(`PARA_TYPE_META` 的 `label`),导入两种写法都认(中文名 / 1-4 的数字码),
 * 空着表示沿用库里已有的类型(新建时按 `PARA_DEFAULTS` 兜底)。中文名从 `#/lib/para-spec` 取 ——
 * 那里是**客户端安全**的,别从 `#/lib/sys-para`(它 `import { db }`)拿。
 *
 * ⚠️ 这个文件只许 `import type` 引 `#/lib/excel`,**不能**引 `xlsx` / React:
 * 它要同时被页面(客户端)和测试用到,把重依赖拖进来就白费了懒加载。
 */
import type { ExcelColumn } from "#/lib/excel";
import { PARA_TYPE_META } from "#/lib/para-spec";

import type { ParameterRow } from "./settings-parameters-table";

type ParaExcelKey = "key" | "value" | "type" | "group" | "remark";

export const PARA_EXCEL_COLUMNS: readonly ExcelColumn<ParaExcelKey>[] = [
	{ key: "key", label: "参数名", width: 26, required: true },
	{ key: "value", label: "值", width: 40 },
	{ key: "type", label: "类型", width: 10 },
	{ key: "group", label: "分组", width: 14 },
	{ key: "remark", label: "说明", width: 34 },
];

/** 参数行 → Excel 行(类型码翻成中文名,人改起来才知道该填什么) */
export function paraExcelRows(rows: readonly ParameterRow[]): Array<Record<ParaExcelKey, string>> {
	return rows.map((row) => ({
		key: row.key,
		value: row.value,
		type: PARA_TYPE_META[row.type].label,
		group: row.group,
		remark: row.remark,
	}));
}
