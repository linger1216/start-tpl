import { Download, Eye, ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";

import {
	ActiveFilterPills,
	FilterChipBar,
	type FilterChipGroup,
	type FilterChipTone,
} from "#/components/modules/shared/filter-chips";
import { exportLedger } from "#/components/modules/shared/ledger-excel";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { DataTable, multiValueFilterFn } from "#/components/modules/shared/table-kit";
import { splitTags, TagBadges, TagCell } from "#/components/modules/shared/tag-badges";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import type { MockRow } from "#/lib/mock-table";
import { createAppColumnHelper, useAppTable } from "#/lib/table";

/**
 * 声明式**只读**表 —— 表单靠「列声明数组」描述,而不是每处手写一整套 TanStack 列。
 *
 * 为什么这里允许声明式(与 §0 第 3 条"不做通用增删改查封装"不冲突):
 * 它只覆盖**详情页 / 弹窗里的从属子表**这一类场景 —— 只读、无写操作、无选中、无表单,
 * 同一份列声明会在多个消费方之间共用(详情页的几十张关联子表、导入预览…),
 * 抄两份必然有一天两张表长得不一样。
 * **列表页(有增删改查)仍然逐页手写**,不许用本组件。
 *
 * 自带:搜索 / 表头排序 / 分页 / 多值列取值筛选 / 导出(走 `exportLedger`)/ 只读详情弹窗。
 * 行范围由调用方先过滤好再传入(例如「与当前档案主体关联的记录」)。
 */

/** 单值列的徽章语义档位(与 `ui/badge` 的 variant 同名) */
export type ReadonlyBadgeVariant = "default" | "secondary" | "destructive" | "outline";

export type ReadonlyColumn<TRow extends MockRow = MockRow> = {
	/** 行字段名(与行类型一致) */
	key: string;
	label: string;
	/** 列宽(px);省略则按内容自适应 */
	width?: number;
	/** 多值标签列(按分隔符拆成徽章);默认纯文本 */
	kind?: "text" | "tags";
	/** 单值列徽章语义:`值 → variant` */
	badge?: Record<string, ReadonlyBadgeVariant>;
	/** 单值列语义色:`值 → className`(优先于 `badge`) */
	toneMap?: Record<string, string>;
	/** 该列的取值筛选候选(不给则不出现筛选项) */
	filterOptions?: readonly string[];
	/** 只在只读详情弹窗里出现,表格中不占列 */
	hideInTable?: boolean;
	/** 自定义单元格(放链接 / 徽章组等非纯文本内容时用);给了它就优先于 `badge` / `toneMap` */
	render?: (row: TRow) => ReactNode;
};

/** 关联表的筛选组配色(与列表页同一套分类色板,取自 `BADGE_THEMES`) */
const RELATION_TONES: FilterChipTone[] = ["ocean", "sunset", "forest", "lavender", "rainbow", "brand", "stone"];

const showValue = (value: unknown) => {
	const text = value === undefined || value === null || value === "" ? "" : String(value);
	return text || "—";
};

function renderCell<TRow extends MockRow>(column: ReadonlyColumn<TRow>, value: unknown, row?: TRow) {
	if (column.render && row) return <>{column.render(row)}</>;
	if (column.kind === "tags") return <TagCell value={value} />;
	const text = showValue(value);
	const tone = column.toneMap?.[text];
	if (tone) return <Badge className={`border-transparent font-normal ${tone}`}>{text}</Badge>;
	if (column.badge && text !== "—") return <Badge variant={column.badge[text] ?? "secondary"}>{text}</Badge>;
	return <span className="block max-w-[280px] truncate">{text}</span>;
}

/** 列声明是「px 列宽」,导出前换算成 Excel 列宽(字符数) */
const toExcelColumns = (columns: readonly ReadonlyColumn[]) =>
	columns.map((column) => ({
		key: column.key,
		label: column.label,
		width: Math.max(12, Math.round((column.width ?? 18) / 2)),
	}));

export function ReadonlyTable<TRow extends MockRow>({
	rows,
	columns,
	/** 业务对象名(搜索框 / 空态 / 详情弹窗 / 导出文案都用它) */
	entity,
	exportName,
	searchPlaceholder,
	/** 行集合本身为空时的文案;「筛选后无结果」另有文案 */
	emptyHint,
	/** 取值筛选口径说明(不传则筛选条只显示「快速筛选」) */
	filterNote,
	/** 是否提供只读详情弹窗(默认提供) */
	withDetail = true,
	/** 额外提到工具栏右侧的内容 */
	extraActions,
	pageSize = 10,
}: {
	rows: TRow[];
	columns: readonly ReadonlyColumn<TRow>[];
	entity: string;
	exportName?: string;
	searchPlaceholder?: string;
	emptyHint?: string;
	filterNote?: string;
	withDetail?: boolean;
	extraActions?: ReactNode;
	pageSize?: number;
}) {
	const [detailRow, setDetailRow] = useState<TRow | null>(null);
	const [activeFilters, setActiveFilters] = useState<Record<string, string | undefined>>({});

	const columnHelper = useMemo(() => createAppColumnHelper<TRow>(), []);

	const tableColumns = useMemo(
		() =>
			columnHelper.columns([
				...columns
					.filter((column) => !column.hideInTable)
					.map((column) =>
						columnHelper.accessor((row) => row[column.key], {
							id: column.key,
							header: column.label,
							size: column.width,
							filterFn: multiValueFilterFn,
							cell: (ctx) => renderCell(column, ctx.getValue(), ctx.row.original),
						}),
					),
				...(withDetail
					? [
							columnHelper.display({
								id: "__actions",
								size: 64,
								header: "操作",
								cell: ({ row }) => (
									<Button variant="ghost" size="icon-sm" aria-label="详情" onClick={() => setDetailRow(row.original)}>
										<Eye className="size-3.5" />
									</Button>
								),
							}),
						]
					: []),
			]),
		[columns, columnHelper, withDetail],
	);

	const table = useAppTable({
		columns: tableColumns,
		data: rows,
		globalFilterFn: "includesString",
		initialState: { pagination: { pageIndex: 0, pageSize } },
	});

	const { pageIndex, pageSize: currentPageSize } = table.state.pagination;
	const matched = table.getFilteredRowModel().rows.length;

	/** 带取值筛选候选的列(命中条数按真实数据算) */
	const filterGroups = useMemo<FilterChipGroup[]>(
		() =>
			columns
				.filter((column) => (column.filterOptions?.length ?? 0) > 0)
				.map((column, index) => ({
					key: column.key,
					label: column.label,
					tone: RELATION_TONES[index % RELATION_TONES.length] ?? "brand",
					options: (column.filterOptions ?? []).map((value) => ({
						value,
						count: rows.filter((row) => splitTags(row[column.key]).includes(value)).length,
					})),
				})),
		[columns, rows],
	);

	const activePills = useMemo(
		() =>
			filterGroups
				.filter((group) => activeFilters[group.key])
				.map((group) => ({
					key: group.key,
					groupLabel: group.label,
					value: activeFilters[group.key] ?? "",
					tone: group.tone,
				})),
		[filterGroups, activeFilters],
	);

	const handleSelectFilter = useCallback(
		(groupKey: string, value: string | undefined) => {
			setActiveFilters((prev) => {
				const next = { ...prev };
				if (value) next[groupKey] = value;
				else delete next[groupKey];
				return next;
			});
			table.getColumn(groupKey)?.setFilterValue(value);
			table.setPageIndex(0);
		},
		[table],
	);

	const clearAllFilters = useCallback(() => {
		setActiveFilters({});
		for (const group of filterGroups) table.getColumn(group.key)?.setFilterValue(undefined);
		table.setPageIndex(0);
	}, [filterGroups, table]);

	function handleExport() {
		exportLedger({
			// toExcelColumns 的入参是 MockRow,这里是 TRow(它的子类型) —— 通过断言收口,
			// 因为渲染层只读 `column.key / label`,不依赖具体行类型。
			columns: toExcelColumns(columns as readonly ReadonlyColumn<MockRow>[]),
			rows: table.getFilteredRowModel().rows.map((row) => row.original),
			fileName: exportName ?? entity,
		});
	}

	return (
		<div className="space-y-3">
			<LedgerToolbar
				search={table.state.globalFilter}
				onSearchChange={(value) => {
					table.setGlobalFilter(value);
					table.setPageIndex(0);
				}}
				searchPlaceholder={searchPlaceholder ?? `搜索${entity}…`}
				actions={
					<>
						<span className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-muted/60 px-2.5 text-[12.5px] text-muted-foreground">
							<ListChecks className="size-3.5" />
							匹配 <span className="font-medium tabular-nums text-foreground">{matched}</span> 条 · 只读
						</span>
						{extraActions}
						<Button variant="outline" size="sm" onClick={handleExport}>
							<Download className="size-3.5" />
							导出
						</Button>
					</>
				}
			/>

			{filterGroups.length > 0 ? (
				<FilterChipBar
					groups={filterGroups}
					active={activeFilters}
					onSelect={handleSelectFilter}
					onClearAll={clearAllFilters}
					note={filterNote}
				/>
			) : null}

			{filterGroups.length > 0 ? (
				<ActiveFilterPills
					items={activePills}
					onRemove={(groupKey) => handleSelectFilter(groupKey, undefined)}
					onClearAll={clearAllFilters}
				/>
			) : null}

			<DataTable
				table={table}
				emptyText={emptyHint ?? `暂无${entity}数据`}
				emptyDataText={emptyHint ?? `暂无${entity}数据`}
			/>

			<PaginationControl
				page={pageIndex + 1}
				pageSize={currentPageSize}
				total={matched}
				onPageChange={(next) => table.setPageIndex(next - 1)}
				onPageSizeChange={(next) => {
					table.setPageSize(next);
					table.setPageIndex(0);
				}}
			/>

			{withDetail ? (
				<Dialog open={detailRow !== null} onOpenChange={(open) => !open && setDetailRow(null)}>
					<DialogContent className="sm:max-w-2xl">
						<DialogHeader>
							<DialogTitle>{entity}详情</DialogTitle>
							<DialogDescription>字段与表格列一致,超长文本在此完整展示;只读视图。</DialogDescription>
						</DialogHeader>
						<div className="max-h-[60vh] divide-y divide-border overflow-y-auto">
							{detailRow
								? columns.map((column) => (
										<DetailRow key={column.key} label={column.label}>
											{column.kind === "tags" ? (
												<TagBadges tags={splitTags(detailRow[column.key])} />
											) : (
												renderCell(
													{ ...column, badge: undefined, toneMap: undefined },
													detailRow[column.key],
													detailRow,
												)
											)}
										</DetailRow>
									))
								: null}
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => setDetailRow(null)}>
								关闭
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			) : null}
		</div>
	);
}
