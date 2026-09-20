import { Download, Layers, Plus, Upload } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "#/components/layout/page-header";
import { SettingsImportModeOptions } from "#/components/modules/settings/settings-import-options";
import {
	SettingsTagDimensionDetailDialog,
	SettingsTagsDetailDialog,
} from "#/components/modules/settings/settings-tags-detail";
import { SettingsTagsEntriesDialog } from "#/components/modules/settings/settings-tags-entries-dialog";
import {
	SettingsTagDimensionFormDialog,
	SettingsTagsFormDialog,
} from "#/components/modules/settings/settings-tags-form";
import {
	importDimensionRowToValues,
	importTagRowToValues,
	type SettingsTagDimensionSubmitValues,
	type SettingsTagsSubmitValues,
} from "#/components/modules/settings/settings-tags-form-mappers";
import { SettingsTagsStats } from "#/components/modules/settings/settings-tags-stats";
import {
	createSettingsTagDimensionColumns,
	type SettingsTagDimensionRowCallbacks,
	SettingsTagDimensionTable,
	type TagDimension,
	type TagItem,
} from "#/components/modules/settings/settings-tags-table";
import { ExcelImportDialog, type ImportResult, type ImportRow } from "#/components/modules/shared/excel-import";
import { exportLedger, importLedger } from "#/components/modules/shared/ledger-excel";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { RankBars } from "#/components/modules/shared/mini-chart";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { TagBadges } from "#/components/modules/shared/tag-badges";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { useAppTable, useRowSelection } from "#/lib/table";
import { TAG_DIMENSION_EXCEL_COLUMNS, TAG_EXCEL_COLUMNS, tagDimensionTable, tagTable } from "#/mocks/tags";

/**
 * 系统设置 · 标签管理(**额外的额外增补页**)。
 *
 * 需求归属:本页不在菜单清单里,维护的是标签体系定义的标签体系
 * (17 个维度 / 120 条标签)。各业务页面的标签列、标签筛选与标签统计都读同一份数据,
 * 因此这里改一条标签,全站的标签列与 tooltip 同步变化。
 *
 * 编排壳:本域**唯一**的数据订阅与写操作入口(见 `doc/前端结构与组件约定.md` §5.2)。
 * 本页的两张表:维度表常驻,标签明细表搬进「按维度打开」的弹窗,各写一套列工厂 / 表单 / 详情 /
 * 导入导出,不抽"通用表格"封装(§0 第 3 条:需要同构就各自写)。
 *
 * 版式(按用户新要求调整 —— 标签明细不再常驻本页):
 * ① 指标条 → ② 维度构成图 + 标签示例 → ③ 标签维度卡片(本页唯一的台账表)
 * → ④ 点「维度」或「标签数」打开该维度的标签明细弹窗(`settings-tags-entries-dialog.tsx`)
 *
 * 为什么原来的「按维度过滤明细」快速筛选也一并删掉:那组筛选**只有**「所属维度」一个组,
 * 作用就是把下面那张常驻明细表按维度过滤;明细改为按维度弹窗后作用域天然成立
 * (弹窗里只有该维度的标签),保留筛选条会变成对着一张不存在的表筛选。
 */

export function SettingsTagsPage() {
	const dimensionRows = tagDimensionTable((state) => state.rows);
	const tagRows = tagTable((state) => state.rows);

	// ── 维度表的 UI 态(选中态统一走公共 hook)──
	const {
		selected: dimensionSelected,
		selectedRows: dimensionSelectedRows,
		toggleOne: toggleDimensionOne,
		toggleMany: toggleDimensionMany,
		clear: clearDimensionSelection,
	} = useRowSelection(dimensionRows);
	const [dimensionForm, setDimensionForm] = useState<{ row: TagDimension | null } | null>(null);
	const [dimensionDetail, setDimensionDetail] = useState<TagDimension | null>(null);
	const [dimensionPendingDelete, setDimensionPendingDelete] = useState<string[] | null>(null);
	const [dimensionImportOpen, setDimensionImportOpen] = useState(false);
	const [dimensionImportMode, setDimensionImportMode] = useState<"append" | "replace">("append");

	// ── 标签明细的 UI 态(表在弹窗里,这里只留"哪个维度开着"与各弹窗的开关)──
	/** 当前打开的标签明细弹窗对应的维度 id */
	const [entriesDimensionId, setEntriesDimensionId] = useState<string | null>(null);
	const [tagForm, setTagForm] = useState<{ row: TagItem | null; lockDimension?: string } | null>(null);
	const [tagDetail, setTagDetail] = useState<TagItem | null>(null);
	const [tagPendingDelete, setTagPendingDelete] = useState<string[] | null>(null);

	const dimensionNames = useMemo(() => dimensionRows.map((row) => row.维度), [dimensionRows]);

	/** 明细弹窗当前作用的维度(按 id 取行;该维度被删后弹窗自动关闭) */
	const entriesDimension = useMemo(
		() => dimensionRows.find((row) => row.id === entriesDimensionId) ?? null,
		[dimensionRows, entriesDimensionId],
	);

	/** 该维度下的标签明细(由编排壳过滤好再交给弹窗) */
	const entriesRows = useMemo(
		() => (entriesDimension ? tagRows.filter((tag) => tag.维度 === entriesDimension.维度) : []),
		[tagRows, entriesDimension],
	);

	/** 点「维度」或「标签数」→ 打开该维度的标签明细弹窗 */
	const openEntries = useCallback((dimension: TagDimension) => setEntriesDimensionId(dimension.id), []);

	const dimensionCallbacks = useMemo<SettingsTagDimensionRowCallbacks>(
		() => ({
			onView: setDimensionDetail,
			onEdit: (row) => setDimensionForm({ row }),
			onDelete: (row) => setDimensionPendingDelete([row.id]),
			onOpenEntries: openEntries,
		}),
		[openEntries],
	);

	const dimensionColumns = useMemo(
		() =>
			createSettingsTagDimensionColumns({
				selected: dimensionSelected,
				onToggleOne: toggleDimensionOne,
				onToggleMany: toggleDimensionMany,
				callbacks: dimensionCallbacks,
			}),
		[dimensionSelected, toggleDimensionOne, toggleDimensionMany, dimensionCallbacks],
	);

	const dimensionTableInstance = useAppTable({
		columns: dimensionColumns,
		data: dimensionRows,
		globalFilterFn: "includesString",
		initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
	});

	const dimensionPagination = dimensionTableInstance.state.pagination;
	const dimensionMatched = dimensionTableInstance.getFilteredRowModel().rows.length;

	/** 维度构成(与维度表「标签数」列同源) */
	const perDimension = useMemo(
		() =>
			dimensionRows
				.map((dimension) => ({
					label: dimension.维度,
					value: tagRows.filter((tag) => tag.维度 === dimension.维度).length,
				}))
				.sort((a, b) => b.value - a.value),
		[dimensionRows, tagRows],
	);

	const notedDimensions = useMemo(
		() => dimensionRows.filter((dimension) => dimension.备注.trim().length > 0),
		[dimensionRows],
	);

	// ── 写操作 · 标签维度 ─────────────────────────────────────
	function confirmDimensionDelete() {
		const ids = dimensionPendingDelete ?? [];
		tagDimensionTable.getState().remove(ids);
		// 显式清掉已删行(否则这一帧工具栏还会闪一下「已选 N 条」)
		toggleDimensionMany(ids, false);
		setDimensionPendingDelete(null);
		toast.success(`已删除 ${ids.length} 个标签维度`);
	}

	function handleDimensionSubmit(values: SettingsTagDimensionSubmitValues) {
		const { id, ...rest } = values;
		if (id) {
			tagDimensionTable.getState().update(id, rest);
			toast.success("标签维度已更新");
		} else {
			tagDimensionTable.getState().insert([rest]);
			toast.success("标签维度已新增");
		}
		setDimensionForm(null);
	}

	function handleDimensionImport(importRows: ImportRow[]): ImportResult {
		return importLedger({
			table: tagDimensionTable,
			rows: importRows,
			mapRow: importDimensionRowToValues,
			mode: dimensionImportMode,
		});
	}

	function handleDimensionExport() {
		exportLedger({
			columns: TAG_DIMENSION_EXCEL_COLUMNS,
			rows: dimensionTableInstance.getFilteredRowModel().rows.map((row) => row.original),
			fileName: "标签维度",
		});
	}

	// ── 写操作 · 标签明细(全部由明细弹窗回抛领域事件)────────────
	/** 从明细弹窗点「新增」:锁死该维度,避免从维度 A 的弹窗里建出维度 B 的标签 */
	function handleCreateTag(dimension: string) {
		setTagForm({ row: null, lockDimension: dimension });
	}

	function handleTagSubmit(values: SettingsTagsSubmitValues) {
		const { id, ...rest } = values;
		if (id) {
			tagTable.getState().update(id, rest);
			toast.success("标签已更新");
		} else {
			tagTable.getState().insert([rest]);
			toast.success("标签已新增");
		}
		setTagForm(null);
	}

	/** 明细弹窗的导入:模式(追加 / 覆盖)由弹窗自己持有并回传 */
	function handleTagImport(importRows: ImportRow[], mode: "append" | "replace"): ImportResult {
		return importLedger({ table: tagTable, rows: importRows, mapRow: importTagRowToValues, mode });
	}

	function handleTagExport(rows: readonly TagItem[]) {
		exportLedger({ columns: TAG_EXCEL_COLUMNS, rows, fileName: "标签明细" });
	}

	function confirmTagDelete() {
		const ids = tagPendingDelete ?? [];
		tagTable.getState().remove(ids);
		setTagPendingDelete(null);
		toast.success(`已删除 ${ids.length} 条标签`);
	}

	return (
		<div className="space-y-4">
			{/* ── 段 0:页头(「额外增补」标记 + 「?」页面说明,与数据来源徽章并存)── */}
			<PageHeader
				title="标签管理"
				description="维护标签体系定义的标签体系:维度(标签分类)、标签与含义。各业务页面的标签列、标签筛选与标签统计都读取同一份数据。注:本页按评审意见属于额外功能,不在菜单清单的叶子之中;标签明细按维度点击打开,不在本页常驻。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="secondary">额外增补 · 不在原始需求菜单清单内</Badge>
						<Badge variant="outline">数据来源:标签体系</Badge>
					</div>
				}
			/>

			{/* ── 段 1:业务指标 ──────────────────────────────────── */}
			<SettingsTagsStats dimensionRows={dimensionRows} tagRows={tagRows} />

			{/* ── 段 2:维度构成 + 标签示例(本页特有的构成块)────────── */}
			<Card className="gap-4 hover:border-border hover:shadow-none">
				<CardContent className="grid gap-6 lg:grid-cols-2">
					<div className="space-y-3">
						<div className="text-[14px] font-medium text-foreground">标签维度构成</div>
						<RankBars data={perDimension} unit=" 个标签" />
					</div>
					<div className="space-y-3">
						<div className="text-[14px] font-medium text-foreground">标签示例</div>
						<TagBadges
							tags={[
								"红色",
								"橙色",
								"黄色",
								"绿色",
								"已走访",
								"未走访",
								"已立项",
								"门头横式招牌",
								"刑满释放人员",
								"罚款",
								"列入经营异常名录",
							]}
						/>
						<p className="text-[12px] leading-snug text-muted-foreground">
							同一维度的标签共用一套语义色,风险等级(红 / 橙 / 黄 / 绿 四档,评审确认)使用语义色;
							鼠标悬停任一标签可看到原始需求给出的含义。
						</p>
						<div className="space-y-2 border-t border-border pt-3">
							<div className="text-[13px] font-medium text-foreground">原文未枚举完整的维度</div>
							{notedDimensions.length === 0 ? (
								<p className="text-[12px] text-muted-foreground">当前没有带备注的维度。</p>
							) : (
								notedDimensions.map((dimension) => (
									<div key={dimension.id} className="text-[12px] leading-snug text-muted-foreground">
										<span className="font-medium text-foreground">{dimension.维度}:</span>
										{dimension.备注}
									</div>
								))
							)}
						</div>
					</div>
				</CardContent>
			</Card>

			{/* ── 段 3:标签维度卡片(本页唯一的台账表)─────────────── */}
			<Card className="gap-4 hover:border-border hover:shadow-none">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<Layers className="size-4 text-muted-foreground" />
						标签维度(标签分类)
					</CardTitle>
					<div className="flex flex-wrap items-center gap-1.5">
						<Badge variant="outline" className="tabular-nums">
							匹配 {dimensionMatched} 条
						</Badge>
						<Badge variant="secondary">点维度或标签数看明细</Badge>
					</div>
				</CardHeader>

				<CardContent className="space-y-3">
					<LedgerToolbar
						search={dimensionTableInstance.state.globalFilter}
						onSearchChange={(value) => {
							dimensionTableInstance.setGlobalFilter(value);
							dimensionTableInstance.setPageIndex(0);
						}}
						searchPlaceholder="搜索维度 / 适用对象 / 备注…"
						selectedCount={dimensionSelected.size}
						onClearSelection={clearDimensionSelection}
						onBulkDelete={() => setDimensionPendingDelete(dimensionSelectedRows.map((row) => row.id))}
						actions={
							<>
								<Button variant="outline" size="sm" onClick={() => setDimensionImportOpen(true)}>
									<Upload className="size-3.5" />
									导入
								</Button>
								<Button variant="outline" size="sm" onClick={handleDimensionExport}>
									<Download className="size-3.5" />
									导出
								</Button>
								<Button size="sm" onClick={() => setDimensionForm({ row: null })}>
									<Plus className="size-3.5" />
									新增维度
								</Button>
							</>
						}
					/>

					<SettingsTagDimensionTable table={dimensionTableInstance} />

					{dimensionTableInstance.getRowModel().rows.length === 0 && dimensionRows.length > 0 ? (
						<p className="text-[13px] text-muted-foreground">当前搜索没有匹配的维度,试试清空搜索词。</p>
					) : null}

					{dimensionRows.length === 0 ? (
						<p className="text-[13px] text-muted-foreground">
							标签维度表为空 —— 先新增维度,再点维度进去挂标签;各业务页面的标签筛选依赖这份清单。
						</p>
					) : null}

					<PaginationControl
						page={dimensionPagination.pageIndex + 1}
						pageSize={dimensionPagination.pageSize}
						total={dimensionMatched}
						onPageChange={(next) => dimensionTableInstance.setPageIndex(next - 1)}
						onPageSizeChange={(next) => {
							dimensionTableInstance.setPageSize(next);
							dimensionTableInstance.setPageIndex(0);
						}}
					/>
				</CardContent>
			</Card>

			{/* ── 弹窗装配 ─────────────────────────────────────── */}
			<SettingsTagDimensionFormDialog
				open={dimensionForm !== null}
				onOpenChange={(next) => {
					if (!next) setDimensionForm(null);
				}}
				initial={dimensionForm?.row ?? null}
				onSubmit={handleDimensionSubmit}
			/>

			<SettingsTagDimensionDetailDialog
				open={dimensionDetail !== null}
				onOpenChange={(next) => {
					if (!next) setDimensionDetail(null);
				}}
				detail={dimensionDetail}
			/>

			{/* 点「维度」/「标签数」打开的标签明细弹窗(那张表在这里,不在页面上常驻) */}
			<SettingsTagsEntriesDialog
				open={entriesDimension !== null}
				onOpenChange={(next) => {
					if (!next) setEntriesDimensionId(null);
				}}
				dimension={entriesDimension}
				rows={entriesRows}
				onCreate={handleCreateTag}
				onEdit={(row) => setTagForm({ row })}
				onView={setTagDetail}
				onDelete={setTagPendingDelete}
				onImport={handleTagImport}
				onExport={handleTagExport}
			/>

			<SettingsTagsFormDialog
				open={tagForm !== null}
				onOpenChange={(next) => {
					if (!next) setTagForm(null);
				}}
				initial={tagForm?.row ?? null}
				dimensions={dimensionNames}
				lockDimension={tagForm?.lockDimension}
				onSubmit={handleTagSubmit}
			/>

			<SettingsTagsDetailDialog
				open={tagDetail !== null}
				onOpenChange={(next) => {
					if (!next) setTagDetail(null);
				}}
				detail={tagDetail}
			/>

			<ConfirmDialog
				open={dimensionPendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setDimensionPendingDelete(null);
				}}
				title="删除标签维度"
				description={`确认删除选中的 ${dimensionPendingDelete?.length ?? 0} 个维度?该操作仅影响本次会话的 mock 数据,维度下的标签明细不会自动回收。`}
				onConfirm={confirmDimensionDelete}
			/>

			<ConfirmDialog
				open={tagPendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setTagPendingDelete(null);
				}}
				title="删除标签"
				description={`确认删除选中的 ${tagPendingDelete?.length ?? 0} 条标签?该操作仅影响本次会话的 mock 数据,用到该标签的业务页面会随之少一个候选值。`}
				onConfirm={confirmTagDelete}
			/>

			<ExcelImportDialog
				open={dimensionImportOpen}
				onOpenChange={setDimensionImportOpen}
				title="导入标签维度"
				description="仅支持 Excel(.xlsx/.xls)。列头与表格一致,带 * 的列为必填。"
				fields={TAG_DIMENSION_EXCEL_COLUMNS}
				isPending={false}
				fileNamePrefix="标签维度导入模板"
				onSubmit={handleDimensionImport}
				options={<SettingsImportModeOptions mode={dimensionImportMode} onModeChange={setDimensionImportMode} />}
			/>
		</div>
	);
}
