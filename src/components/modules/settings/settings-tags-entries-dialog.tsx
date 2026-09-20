import { Download, Plus, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import {
	createSettingsTagsColumns,
	type SettingsTagsRowCallbacks,
	SettingsTagsTable,
	type TagDimension,
	type TagItem,
} from "#/components/modules/settings/settings-tags-table";
import { ExcelImportDialog, type ImportResult, type ImportRow } from "#/components/modules/shared/excel-import";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { useAppTable, useRowSelection } from "#/lib/table";
import { TAG_EXCEL_COLUMNS } from "#/mocks/tags";
import { SettingsImportModeOptions } from "./settings-import-options";

/**
 * 某一维度下的标签明细弹窗 —— 点维度表里「维度」或「标签数」时打开。
 *
 * 为什么搬进弹窗:标签明细此前是页面上第二张常驻表,与维度表并列,读者需要自己在两张表之间
 * 对齐维度;改为"点进去看"后,**维度天然成为作用域**(弹窗只显示该维度的标签),
 * 页面上那组"按维度过滤明细"的快速筛选也就失去了存在意义,一并删除。
 *
 * 职责边界(见 `doc/前端结构与组件约定.md` §5.3):
 * - **数据订阅与全部写操作留在编排壳**(`settings-tags-page.tsx`)—— 本组件通过 `rows` 收数据、
 * 通过 `onCreate / onEdit / onDelete / onView / onImport / onExport` 回抛领域事件;
 * - 本组件只自持 UI 态:搜索词、选中集合、分页、导入方式。
 *
 * 能力与原常驻表完全一致:搜索 / 选中 / 批量删除 / 新增 / 编辑 / 详情 / 删除 / 导入 / 导出 / 分页 / 空态。
 */
export function SettingsTagsEntriesDialog({
	open,
	onOpenChange,
	dimension,
	rows,
	onCreate,
	onEdit,
	onDelete,
	onView,
	onImport,
	onExport,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	/** 当前维度(null = 未打开);标题与描述取这一行 */
	dimension: TagDimension | null;
	/** 该维度下的标签明细(编排壳已过滤好) */
	rows: readonly TagItem[];
	/** 新增:回抛锁定维度,由编排壳打开表单 */
	onCreate: (dimension: string) => void;
	onEdit: (row: TagItem) => void;
	/** 批量删除 / 单行删除统一回抛 id 数组(确认弹窗留在编排壳) */
	onDelete: (ids: string[]) => void;
	onView: (row: TagItem) => void;
	onImport: (rows: ImportRow[], mode: "append" | "replace") => ImportResult;
	/** 导出当前筛选结果(不分页):行由本组件算出后交给编排壳写盘 */
	onExport: (rows: readonly TagItem[]) => void;
}) {
	// 选中态走公共 hook:行集合变化(删除 / 导入 / 新增 / 换维度)后自动剔除已消失的 id
	const { selected, selectedRows, toggleOne, toggleMany, clear } = useRowSelection(rows);
	const [importOpen, setImportOpen] = useState(false);
	const [importMode, setImportMode] = useState<"append" | "replace">("append");

	const callbacks = useMemo<SettingsTagsRowCallbacks>(
		() => ({
			onView,
			onEdit,
			onDelete: (row) => onDelete([row.id]),
		}),
		[onView, onEdit, onDelete],
	);

	const columns = useMemo(
		() => createSettingsTagsColumns({ selected, onToggleOne: toggleOne, onToggleMany: toggleMany, callbacks }),
		[selected, toggleOne, toggleMany, callbacks],
	);

	const table = useAppTable({
		columns,
		data: rows,
		globalFilterFn: "includesString",
		initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
	});

	const { pageIndex, pageSize } = table.state.pagination;
	const matched = table.getFilteredRowModel().rows.length;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/* 明细列较多(选中 / 维度 / 标签 / 含义 / 操作),给到 5xl 才不挤 */}
			<DialogContent className="sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						「{dimension?.维度 ?? ""}」标签明细
						<Badge variant="secondary" className="tabular-nums">
							{rows.length} 个标签
						</Badge>
					</DialogTitle>
					<DialogDescription>
						{dimension
							? `适用对象:${dimension.适用对象 || "—"} · 来源:${dimension.来源 || "—"} · 当前 ${
									rows.length
								} 个标签(标签体系)。`
							: "该维度下还没有标签。"}
						在本弹窗里新增的标签会默认归到本维度。
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					{/* 工具栏:选中态控件并入本行(h-8),选中前后表格位置不变 */}
					<LedgerToolbar
						search={table.state.globalFilter}
						onSearchChange={(value) => {
							table.setGlobalFilter(value);
							table.setPageIndex(0);
						}}
						searchPlaceholder="搜索标签 / 含义…"
						selectedCount={selected.size}
						onClearSelection={clear}
						onBulkDelete={() => onDelete(selectedRows.map((row) => row.id))}
						actions={
							<>
								<Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
									<Upload className="size-3.5" />
									导入
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => onExport(table.getFilteredRowModel().rows.map((row) => row.original))}
								>
									<Download className="size-3.5" />
									导出
								</Button>
								<Button size="sm" onClick={() => onCreate(dimension?.维度 ?? "")} disabled={!dimension}>
									<Plus className="size-3.5" />
									新增标签
								</Button>
							</>
						}
					/>

					<SettingsTagsTable table={table} emptyText="该维度下还没有标签,点「新增标签」补一条" />

					{matched === 0 && rows.length > 0 ? (
						<p className="text-[13px] text-muted-foreground">当前搜索没有匹配的标签,试试清空搜索词。</p>
					) : null}

					<PaginationControl
						page={pageIndex + 1}
						pageSize={pageSize}
						total={matched}
						onPageChange={(next) => table.setPageIndex(next - 1)}
						onPageSizeChange={(next) => {
							table.setPageSize(next);
							table.setPageIndex(0);
						}}
					/>
				</div>

				<ExcelImportDialog
					open={importOpen}
					onOpenChange={setImportOpen}
					title="导入标签明细"
					description="仅支持 Excel(.xlsx/.xls)。列头与表格一致,带 * 的列为必填;「所属维度」需与维度表的维度名一致。"
					fields={TAG_EXCEL_COLUMNS}
					isPending={false}
					fileNamePrefix="标签明细导入模板"
					onSubmit={(rows) => onImport(rows, importMode)}
					options={<SettingsImportModeOptions mode={importMode} onModeChange={setImportMode} />}
				/>
			</DialogContent>
		</Dialog>
	);
}
