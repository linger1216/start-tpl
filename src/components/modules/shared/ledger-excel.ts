/**
 * 台账导入/导出流程 —— 跨域共用件(纯函数,无 React)。
 *
 * 为什么收在这里:`lib/excel.ts` 只有"怎么把行列写成 xlsx"这一层(纯、无反馈),
 * 而"导出当前筛选结果并提示 N 条""Excel 行 → 草稿 → 写回 mock 表 → 提示结果"
 * 这两段流程此前在 56 / 51 个页面里各写了一遍(连 toast 文案都有 49 处逐字相同)。
 *
 * 边界(见 `doc/前端结构与组件约定.md` §0 第 3 条):
 *  - 只封装**导入导出**,不封装表格本身 —— `useAppTable`、列定义、行类型、
 *    增删改的写操作仍然留在各业务页;
 *  - 逐行映射(`importRowToValues`)由各域自己的 `-form-mappers.ts` 提供。
 */
import { toast } from "sonner";

import { type ExcelColumn, type ImportResult, type ImportRow, writeSheet } from "#/lib/excel";
import type { MockDraft } from "#/lib/mock-table";

/** 导入目标表:只依赖 `createMockTable` 实例的两个写入口,避免泛型协变噪音 */
type ImportTargetTable = {
	getState: () => {
		insert: (drafts: MockDraft[]) => void;
		replaceAll: (drafts: MockDraft[]) => void;
	};
};

/**
 * 导出"当前筛选出的行"(不分页)并提示结果。
 *
 * 与列表**共用同一套筛选**:调用方把 `table.getFilteredRowModel().rows` 的 original 传进来即可。
 */
export function exportLedger<Key extends string>({
	columns,
	rows,
	fileName,
}: {
	columns: readonly ExcelColumn<Key>[];
	rows: readonly object[];
	fileName: string;
}): number {
	const count = writeSheet({ columns, rows, fileName });
	toast.success(`已导出 ${count} 条(当前筛选结果)`);
	return count;
}

/**
 * Excel 文本行 → 落库草稿 → 写回 mock 表,并提示结果。
 *
 * 逐行走调用方给的纯映射(各域 `-form-mappers.ts` 的 `importRowToValues`),
 * 校验失败的行只记录错误、不阻断其余行 —— 与 `ExcelImportDialog` 的结果面板口径一致。
 */
export function importLedger({
	table,
	rows,
	mapRow,
	mode,
}: {
	table: ImportTargetTable;
	rows: ImportRow[];
	mapRow: (row: ImportRow) => { values: Record<string, unknown> } | { error: string };
	mode: "append" | "replace";
}): ImportResult {
	const errors: ImportResult["errors"] = [];
	const drafts: MockDraft[] = [];
	rows.forEach((row, index) => {
		const parsed = mapRow(row);
		if ("error" in parsed) {
			errors.push({ index, message: parsed.error });
			return;
		}
		// 导入不携带主键:新行的 id 由内存表按前缀续号生成
		const { id: _id, ...rest } = parsed.values;
		drafts.push(rest);
	});
	if (mode === "replace") table.getState().replaceAll(drafts);
	else table.getState().insert(drafts);
	toast.success(`已导入 ${drafts.length} 条${mode === "replace" ? "(覆盖原有数据)" : ""}`);
	return { total: rows.length, created: drafts.length, errors };
}
