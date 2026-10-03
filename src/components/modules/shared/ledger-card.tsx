import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { DataTable, TableLoadingShell } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import type { MockRow, useAppTable } from "#/lib/table";

/**
 * 台账卡 —— 9 个列表页共用的「卡内表格 + 分页」骨架(版式见 `doc/界面约定.md` 的台账布局)。
 *
 * 从 9 个页面各 ≈25 行、其中 ≈18 行逐字相同的段落里抽出来:`CardContent` 里依次是
 * 「批量条(`children`,可选,长在表格正上方)→ 表格加载壳(`busy` 时占位)→ 分页器」。
 * 卡头统一只有右侧那一个「匹配 N 条」徽章 —— 读取中的状态交给 `TableLoadingShell`,别再挂第二个徽章。
 *
 * 批量条本身也收在这里(见下面的 `SelectionBar`):三个页面曾各手写一份「已选 N 条(前三个名字…)
 * + 右侧动作」,连省略号前的空格都对不齐。
 */
export function LedgerCard<TRow extends MockRow>({
	title,
	Icon,
	count,
	busy,
	showSkeleton,
	emptyText,
	table,
	rowClassName,
	children,
}: {
	/** 卡头标题(如「参数清单」) */
	title: string;
	/** 卡头图标 */
	Icon: LucideIcon;
	/** 卡头右侧「匹配 N 条」里的 N */
	count: number;
	/** 列表请求是否在途 —— 交给 `TableLoadingShell` 出占位 */
	busy: boolean;
	/** 首次加载显示骨架行(B1);已有数据时仍走 spinner 行为 */
	showSkeleton?: boolean;
	emptyText: string;
	table: ReturnType<typeof useAppTable<TRow>>;
	/** 逐行附加 class;目前**只有文件页**用(选中行加底色),别处不需要 */
	rowClassName?: (row: TRow) => string | undefined;
	/** 表格正上方的批量 / 选择条(用下面的 `SelectionBar`,它自己在零选中时返回 `null`) */
	children?: ReactNode;
}) {
	const { pageIndex, pageSize } = table.state.pagination;

	return (
		<Card className="flex min-h-104 flex-1 flex-col gap-4">
			<CardHeader className="flex-row items-center justify-between gap-3">
				<CardTitle className="flex items-center gap-2">
					<Icon className="size-4 text-muted-foreground" />
					{title}
				</CardTitle>
				<Badge variant="outline" className="tabular-nums">
					匹配 {count} 条
				</Badge>
			</CardHeader>
			<CardContent className="flex min-h-0 flex-1 flex-col gap-3">
				{children}
				<TableLoadingShell fill busy={busy} showSkeleton={showSkeleton} minHeight={240}>
					<DataTable table={table} emptyText={emptyText} rowClassName={rowClassName} />
				</TableLoadingShell>
				<div className="shrink-0 border-t border-border pt-1">
					<PaginationControl
						page={pageIndex + 1}
						pageSize={pageSize}
						total={table.getFilteredRowModel().rows.length}
						onPageChange={(next) => table.setPageIndex(next - 1)}
						onPageSizeChange={(next) => table.setPageSize(next)}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

/**
 * 批量选择条 —— 放在 `LedgerCard` 的 `children` 槽里,长在表格正上方。
 *
 * 零选中时返回 `null`,所以调用方**不用再写** `{selected.size > 0 ? … : null}`。
 * 量词由调用方给(「条」/「个」),名字只展示前三个 —— 多出来的用省略号,规则只写这一处。
 */
export function SelectionBar({
	count,
	unit,
	names,
	children,
}: {
	/** 选中的条数 */
	count: number;
	/** 量词(「条」/「个」)—— 各页口径不同,所以是参数 */
	unit: string;
	/** 选中项的显示名;超过 3 个只展示前 3 个 + ` …` */
	names: string[];
	/** 右侧动作按钮(清空选择 / 批量删除 …) */
	children?: ReactNode;
}) {
	if (count === 0) return null;

	return (
		<div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-border bg-brand-faint px-3 py-2">
			<span className="text-xs text-foreground">
				已选 <span className="font-semibold tabular-nums">{count}</span> {unit}
				<span className="ml-2 text-muted-foreground">
					({names.slice(0, 3).join("、")}
					{count > 3 ? " …" : ""})
				</span>
			</span>
			<div className="flex items-center gap-2">{children}</div>
		</div>
	);
}
