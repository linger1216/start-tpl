/**
 * 台账「导出」按钮 —— 跨域共用件(工具条右端操作组里的那一个,见 `doc/界面约定.md` 的版式骨架)。
 *
 * 为什么要有这一层:`xlsx` 有好几百 KB,只能**点了导出才下载**(静态 import 会把它拖进台账页主 chunk),
 * 而"动态 import + 没数据就禁用 + 导出中状态 + 失败提示"这四件事每个台账页都要重写一遍。
 * **列头与列宽不在这里** —— 各域自己的 `XXX_EXCEL_COLUMNS` 才是真源(理由见 `lib/excel.ts` 的文件头)。
 *
 * 家族归属:工具条里的操作按钮走 `ActionButton`(纯文字、不带图标),与「列」`ColumnToggle`、「刷新」
 * `RefreshButton` 并排 —— 示例见 `workbench/ui-gallery-table.tsx` 的工具条。
 */
import { useState } from "react";
import { toast } from "sonner";

import { ActionButton } from "#/components/ui/action-button";
import type { ExcelColumn } from "#/lib/excel";

export function ExcelExportButton<Key extends string>({
	columns,
	rows,
	fileName,
	disabled = false,
}: {
	/** 列契约(表头的真源在各域,不在这里再写一份) */
	columns: readonly ExcelColumn<Key>[];
	/** 要导出的行 —— 传**当前筛选结果**(与页面上「匹配 N 条」同源,不分页) */
	rows: readonly object[];
	/** 文件名(不含日期后缀;`writeSheet` 会补 `-YYYY-MM-DD`) */
	fileName: string;
	disabled?: boolean;
}) {
	const [busy, setBusy] = useState(false);
	const empty = rows.length === 0;

	return (
		<ActionButton
			disabled={disabled || busy || empty}
			title={empty ? "没有可导出的行" : undefined}
			onClick={async () => {
				setBusy(true);
				try {
					// 到这一刻才把 xlsx 拉进来(doc/界面约定.md「数据能力」那一条的落地)
					const { exportLedger } = await import("#/components/modules/shared/ledger-excel");
					exportLedger({ columns, rows, fileName });
				} catch (error) {
					toast.error("导出失败", {
						description: error instanceof Error ? error.message : String(error),
					});
				} finally {
					setBusy(false);
				}
			}}
		>
			{busy ? "导出中…" : "导出"}
		</ActionButton>
	);
}
