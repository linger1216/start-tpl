/**
 * 台账的 Excel 两件套 —— 跨域共用件(工具条右端操作组,见 `doc/界面约定.md` 的版式骨架)。
 *
 * 为什么要有这一层:`xlsx` 有好几百 KB,只能**点了才下载**(静态 import 会把它拖进台账页主 chunk),
 * 而"动态 import + 没数据就禁用 + 进行中状态 + 失败提示"这几件事每个台账页都要重写一遍。
 * **列头与列宽不在这里** —— 各域自己的 `XXX_EXCEL_COLUMNS` 才是真源(理由见 `lib/excel.ts` 的文件头);
 * 导入字段与导出一致时直接复用同一份,只有多/少列时才另立一份(如 users 域多了「初始密码」)。
 *
 * 家族归属:「导出」是工具条里的操作按钮,走 `ActionButton`(纯文字、不带图标),与「列」`ColumnToggle`、
 * 「刷新」`RefreshButton` 并排;「导入」会开对话框,按约定用 `Button`(可带图标)—— 示例见
 * `workbench/ui-gallery-table.tsx` 的工具条与 `doc/界面约定.md` 的按钮分族。
 */
import { Upload } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";

import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import type { ExcelColumn, ImportField, ImportResult, ImportRow } from "#/lib/excel";

/** 导入对话框连同 xlsx 一起懒加载:只有点过「导入」的会话才会下载它们 */
const ExcelImportDialog = lazy(async () => {
	const mod = await import("#/components/modules/shared/excel-import");
	return { default: mod.ExcelImportDialog };
});

export function ExcelExportButton<Key extends string>({
	columns,
	rows,
	fileName,
}: {
	/** 列契约(表头的真源在各域,不在这里再写一份) */
	columns: readonly ExcelColumn<Key>[];
	/** 要导出的行 —— 传**当前筛选结果**(与页面上「匹配 N 条」同源,不分页) */
	rows: readonly object[];
	/** 文件名(不含日期后缀;`writeSheet` 会补 `-YYYY-MM-DD`) */
	fileName: string;
}) {
	const [busy, setBusy] = useState(false);
	const empty = rows.length === 0;

	return (
		<ActionButton
			disabled={busy || empty}
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

/**
 * 台账「导入」按钮 —— 开 `ExcelImportDialog`(懒加载),把解析好的行交给调用方的 `onImport` 落库。
 *
 * `onImport` 应当返回各域 `import` 接口的原样出参(`ImportResult`),对话框据此渲染
 * 「已导入 / 重复 / 失败」明细;整批抛错(权限、网络)由对话框兜住并显示,不用在这里 try。
 */
export function ExcelImportButton({
	title,
	description,
	fields,
	fileNamePrefix = "导入模板",
	onImport,
}: {
	/** 对话框标题,如「导入字典」 */
	title: string;
	description?: string;
	/** 字段契约(与导出表头同源,别各写一份) */
	fields: readonly ImportField[];
	fileNamePrefix?: string;
	/** 解析好的行 → 落库;返回 `ImportResult`(逐行结果由对话框展示) */
	onImport: (rows: ImportRow[]) => Promise<ImportResult>;
}) {
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);

	return (
		<>
			<Button size="sm" variant="outline" onClick={() => setOpen(true)}>
				<Upload className="size-3.5" />
				导入
			</Button>
			{open ? (
				<Suspense fallback={null}>
					<ExcelImportDialog
						open
						onOpenChange={(next) => {
							if (!next) setOpen(false);
						}}
						title={title}
						description={description}
						fields={fields}
						fileNamePrefix={fileNamePrefix}
						isPending={pending}
						onSubmit={async (rows) => {
							setPending(true);
							try {
								return await onImport(rows);
							} finally {
								setPending(false);
							}
						}}
					/>
				</Suspense>
			) : null}
		</>
	);
}
