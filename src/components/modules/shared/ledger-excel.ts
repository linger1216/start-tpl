/**
 * 台账导出流程 —— 跨域共用件(纯函数,无 React)。
 *
 * 为什么收在这里:`lib/excel.ts` 只有"怎么把行列写成 xlsx"这一层(纯、无反馈),
 * 而"导出当前筛选结果并提示 N 条"这段流程此前在 56 个页面里各写了一遍
 * (连 toast 文案都有 49 处逐字相同)。
 *
 * 边界(见 `doc/前端结构与组件约定.md` §0 第 3 条):
 *  - 只封装**导出**,不封装表格本身 —— `useAppTable`、列定义、行类型、
 *    增删改的写操作仍然留在各业务页;
 *  - 导入已迁到各域的 `*.import` tRPC procedure(服务端写),这里不再提供客户端入口
 *    —— 此前的 `importLedger` 因导入流程移到 `*.import` 后零调用方,在第十五轮删掉;
 *    文件保留是因为 `exportLedger` 还在用,且「Excel 相关文件永不删除」。
 */
import { toast } from "sonner";

import { type ExcelColumn, writeSheet } from "#/lib/excel";

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
