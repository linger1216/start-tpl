/**
 * 字典域的 Excel 契约 —— 导出列 / 导入字段 / 行变换,**只在这里写一份**。
 *
 * 形状刻意做成「一行 = 一个字典项」:导出与导入共用同一组表头,所以**导出的文件改完能直接回导**
 * (没有字典项的字典占一行、字典项两列留空)。
 *
 * 注意不能把 `SettingsDictRow` 直接丢给 `writeSheet` —— 它的 `items` 是对象数组,
 * `cellText` 只会把对象变成 `[object Object]`(见 `lib/excel.ts`),必须先在这里摊平。
 */
import type { SettingsDictRow } from "#/components/modules/settings/settings-dictionary-types";
import type { ExcelColumn } from "#/lib/excel";

type DictExcelKey = "code" | "name" | "label" | "value" | "remark";

/** 表头的唯一真源:导出与导入都用它,别在两处各写一遍 */
export const DICT_EXCEL_COLUMNS: readonly ExcelColumn<DictExcelKey>[] = [
	{ key: "code", label: "字典编码", width: 22, required: true },
	{ key: "name", label: "字典名称", width: 20 },
	{ key: "label", label: "字典项名称", width: 20 },
	{ key: "value", label: "字典项取值", width: 22 },
	{ key: "remark", label: "备注", width: 30 },
];

/** 行 → 导出值:一个字典摊成多行(每个字典项一行;没有字典项的字典占一行) */
export function dictExcelRows(rows: readonly SettingsDictRow[]): Array<Record<DictExcelKey, string>> {
	return rows.flatMap((row) => {
		const base = { code: row.code, name: row.name, remark: row.remark ?? "" };
		if (row.items.length === 0) return [{ ...base, label: "", value: "" }];
		return row.items.map((item) => ({ ...base, label: item.label, value: item.value }));
	});
}
