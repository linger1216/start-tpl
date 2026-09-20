import { AlertTriangle, Layers, ListChecks, SquarePen } from "lucide-react";
import { useMemo, useState } from "react";

import {
	CodeBlock,
	PropTable,
	ShowcaseItem,
	ShowcasePage,
	ShowcaseSection,
	ShowcaseTag,
} from "#/components/layout/showcase";
import { ColumnVisibilityMenu } from "#/components/modules/shared/column-visibility-menu";
import { FilterChipBar, type FilterChipGroup } from "#/components/modules/shared/filter-chips";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { type ReadonlyColumn, ReadonlyTable } from "#/components/modules/shared/readonly-table";
import {
	actionsColumn,
	DataTable,
	selectColumn,
	TableLoadingShell,
	TextCell,
} from "#/components/modules/shared/table-kit";
import { BadgeList } from "#/components/ui/badge-list";
import { Button } from "#/components/ui/button";
import { StatusBadge } from "#/components/ui/status-badge";
import { TableResizeHandle } from "#/components/ui/table-resize-handle";
import type { MockRow } from "#/lib/mock-table";
import { createAppColumnHelper, useAppTable, useRowSelection } from "#/lib/table";

/**
 * 表格与列表展示页 —— `components/modules/shared/` 里带**版式与行为**的展示件。
 *
 * 与基础组件页(`showcase-ui`)的边界:
 *  - 基础组件页是**无状态**原语(Button / Card / Table…);
 *  - 本页是**有约定**的展示件(选列怎么排 / 工具栏怎么对齐 / 加载怎么不抖) ——
 *    它们本身没有字段声明,但列定义 / 选中态 / 搜索词仍由调用方提供。
 *
 * 表格的内核(`useAppTable` / `createAppColumnHelper`)见 `lib/table.ts`,这里只演示,
 * 不复述细节。
 */

type SampleRow = MockRow & {
	编号: string;
	名称: string;
	类别: "企业" | "人员" | "案件";
	分值: number;
	标签: string[];
	状态: number;
};

// SampleRow 是行形状;列定义里需要用更宽的 MockRow 泛型(因为 selectColumn/actionsColumn 是
// 为 MockRow 设计的)。helper 用 MockRow、data 仍为 SampleRow[] 即可 —— TanStack 会按行的
// 实际形状推断 cell 类型,列 helper 的 MockRow 不会反向约束。
const SAMPLE: SampleRow[] = [
	{
		id: "1",
		编号: "EMP-0001",
		名称: "上海示例食品有限公司",
		类别: "企业",
		分值: 86,
		标签: ["重点监管", "食品安全"],
		状态: 1,
	},
	{ id: "2", 编号: "EMP-0002", 名称: "南京路 1024 号商户", 类别: "企业", 分值: 72, 标签: ["消防安全"], 状态: 1 },
	{ id: "3", 编号: "EMP-0003", 名称: "张某某", 类别: "人员", 分值: 45, 标签: ["重点关注"], 状态: 0 },
	{ id: "4", 编号: "EMP-0004", 名称: "人民广场工地", 类别: "案件", 分值: 91, 标签: ["工程", "夜间施工"], 状态: 1 },
	{ id: "5", 编号: "EMP-0005", 名称: "李某某", 类别: "人员", 分值: 63, 标签: ["流动"], 状态: 0 },
];

/** 一个完整的「筛选 + 工具栏 + 表格 + 选中 + 分页」样例 —— 整段粘到任何列表页就能跑 */
function FullSample() {
	const [类别, set类别] = useState<string | undefined>(undefined);
	const { selected, toggleOne, toggleMany, clear } = useRowSelection(SAMPLE);

	/** ① 在外层先按"硬筛选"(维度筛选)过滤,避免被 TanStack 的 globalFilter 抢走;
	 *  ② 搜索走 table.setGlobalFilter —— 全局搜索由 TanStack 自己处理,我们在 selectColumn / 翻页里
	 *     一律保持引用,不重新挂载。
	 */
	const filtered = useMemo(() => {
		if (!类别) return SAMPLE;
		return SAMPLE.filter((row) => row.类别 === 类别);
	}, [类别]);

	const helper = createAppColumnHelper<MockRow>();
	const table = useAppTable({
		data: filtered,
		columns: [
			selectColumn({ selected, onToggleOne: toggleOne, onToggleMany: toggleMany }),
			helper.accessor("编号", { header: "编号", cell: (ctx) => <TextCell value={ctx.getValue()} />, size: 140 }),
			helper.accessor("名称", { header: "名称", cell: (ctx) => <TextCell value={ctx.getValue()} />, size: 260 }),
			helper.accessor("分值", {
				header: "分值",
				size: 90,
				cell: (ctx) => <span className="font-mono tabular-nums">{ctx.getValue() as number}</span>,
			}),
			helper.accessor("标签", {
				header: "标签",
				size: 220,
				cell: (ctx) => <BadgeList values={ctx.getValue() as string[]} color="brand" layout="wrap" />,
			}),
			helper.accessor("状态", {
				header: "状态",
				size: 90,
				cell: (ctx) => <StatusBadge status={ctx.getValue() as number} />,
			}),
			actionsColumn({ onView: () => {}, size: 80 }),
		],
		globalFilterFn: "includesString",
	});

	const groups: FilterChipGroup[] = [
		{
			key: "类别",
			label: "对象类别",
			Icon: Layers,
			tone: "brand",
			options: [
				{ value: "企业", count: 2 },
				{ value: "人员", count: 2 },
				{ value: "案件", count: 1 },
			],
		},
	];

	return (
		<div className="space-y-3">
			<FilterChipBar
				groups={groups}
				active={{ 类别 }}
				onSelect={(_k, v) => set类别(v)}
				note="来自示例数据,与你的数据无关"
			/>
			<LedgerToolbar
				search={table.state.globalFilter}
				onSearchChange={(value) => table.setGlobalFilter(value)}
				searchPlaceholder="搜索编号 / 名称"
				selectedCount={selected.size}
				onClearSelection={clear}
				actions={
					<>
						<Button size="sm" variant="outline">
							导入
						</Button>
						<Button size="sm">
							<SquarePen className="size-3.5" />
							新增
						</Button>
					</>
				}
			/>
			<DataTable table={table} emptyText="暂无数据" emptyDataText="未找到匹配记录" />
			<PaginationControl
				page={table.state.pagination.pageIndex + 1}
				pageSize={table.state.pagination.pageSize}
				total={filtered.length}
				onPageChange={(page) => table.setPageIndex(page - 1)}
				onPageSizeChange={(size) => table.setPageSize(size)}
			/>
		</div>
	);
}

/** 「列可见性 + 拖拽排序」样例 —— 独立壳,不做表格 */
function ColumnMenuSample() {
	const [visible, setVisible] = useState<Record<string, boolean>>({
		编号: true,
		名称: true,
		分值: true,
		标签: false,
		状态: true,
	});
	const [order, setOrder] = useState<string[]>(["编号", "名称", "分值", "标签", "状态"]);
	const labels: Record<string, string> = { 编号: "编号", 名称: "名称", 分值: "分值", 标签: "标签", 状态: "状态" };
	const items = order.map((key) => ({ key, label: labels[key] ?? key }));
	const visibleCount = order.filter((k) => visible[k]).length;

	return (
		<ColumnVisibilityMenu
			items={items}
			isVisible={(key) => Boolean(visible[key])}
			onToggle={(key) => setVisible({ ...visible, [key]: !visible[key] })}
			onMove={(from, to) => {
				const next = [...order];
				const fromIndex = next.indexOf(from);
				const toIndex = next.indexOf(to);
				next.splice(fromIndex, 1);
				next.splice(toIndex, 0, from);
				setOrder(next);
			}}
			onShowAll={() => setVisible(Object.fromEntries(order.map((k) => [k, true])))}
			onInvert={() => setVisible(Object.fromEntries(order.map((k) => [k, !visible[k]])))}
			onReset={() => {
				setOrder(["编号", "名称", "分值", "标签", "状态"]);
				setVisible({ 编号: true, 名称: true, 分值: true, 标签: false, 状态: true });
			}}
			visibleCount={visibleCount}
			totalCount={order.length}
		/>
	);
}

/** 「列宽拖拽」样例 —— 手柄必须挂在 th 里(它靠 `parentElement` 拿 th 的渲染宽度) */
function ResizeHandleSample() {
	const [sizing, setSizing] = useState<Record<string, number>>({});
	const cols = ["编号", "名称", "分值"] as const;
	return (
		<div className="space-y-2">
			<div className="overflow-x-auto rounded-lg border border-border">
				<table className="w-full text-[13px]">
					<thead className="bg-muted/40">
						<tr>
							{cols.map((col) => (
								<th
									key={col}
									className="relative border-r border-border px-3 py-2 text-left font-medium last:border-r-0"
									style={sizing[col] ? { width: sizing[col] } : undefined}
								>
									{col}
									<TableResizeHandle columnId={col} onChange={(updater) => setSizing((prev) => updater(prev))} />
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						<tr className="border-t border-border">
							{cols.map((col) => (
								<td
									key={col}
									className="border-r border-border px-3 py-2 last:border-r-0"
									style={sizing[col] ? { width: sizing[col] } : undefined}
								>
									{col === "编号" ? "E-1024" : col === "名称" ? "示例记录" : "86"}
								</td>
							))}
						</tr>
					</tbody>
				</table>
			</div>
			<div className="font-mono text-[12px] text-muted-foreground">
				当前列宽:{cols.map((c) => `${c}=${sizing[c] ?? "auto"}`).join("  ")}
			</div>
		</div>
	);
}

/** 「只读子表」样例 —— 详情页里嵌一张非交互表,顺序与数据都是 props */
function ReadonlySample() {
	type Row = { id: string; 项目: string; 结果: "通过" | "未通过" | "待复核"; 时间: string };
	const cols: ReadonlyColumn<Row>[] = [
		{ key: "项目", label: "检查项目", width: 180 },
		{
			key: "结果",
			label: "结果",
			width: 100,
			render: (row) => (
				<BadgeList
					values={[row.结果]}
					color={row.结果 === "通过" ? "forest" : row.结果 === "未通过" ? "ocean" : "stone"}
					layout="wrap"
				/>
			),
		},
		{ key: "时间", label: "检查时间", width: 180 },
	];
	const rows: Row[] = [
		{ id: "1", 项目: "营业执照", 结果: "通过", 时间: "2026-08-12 10:32" },
		{ id: "2", 项目: "消防安全", 结果: "待复核", 时间: "2026-08-12 11:05" },
		{ id: "3", 项目: "食品卫生", 结果: "未通过", 时间: "2026-08-12 14:50" },
	];
	return <ReadonlyTable<Row> columns={cols} rows={rows} entity="inspections" />;
}

export function ShowcaseTablePage() {
	return (
		<ShowcasePage
			title="表格与列表"
			description="components/modules/shared 里有版式约定的展示件:工具栏 / 分页 / 列选择 / 筛选条 / 加载壳,以及只读子表与可编辑表格。改它们就改了 50+ 个列表页的版式。"
			toc={[
				["full", "完整列表样例"],
				["toolbar", "工具栏"],
				["filter", "快速筛选条"],
				["columns", "列选择 + 排序"],
				["page", "分页器"],
				["loading", "加载壳"],
				["readonly", "只读子表"],
				["notes", "这一层的规矩"],
			]}
		>
			<ShowcaseSection
				id="full"
				title="完整列表样例"
				description="把工具栏、筛选条、列定义、选中态、分页粘在同一段 —— 是任何后台列表页的最小骨架。"
			>
				<ShowcaseItem
					name="完整列表页骨架"
					summary="工具栏 + 筛选条 + 表格 + 选中态 + 分页"
					source="shared/ledger-toolbar.tsx · shared/table-kit.tsx · shared/pagination-control.tsx"
					demo={<FullSample />}
					code={`const { selected, toggleOne, toggleMany, clear } = useRowSelection(rows);
const helper = createAppColumnHelper<Row>();
const table = useAppTable({
  data: filtered,
  columns: [
    selectColumn({ selected, onToggleOne: toggleOne, onToggleMany: toggleMany }),
    helper.accessor("名称", { header: "名称" }),
    actionsColumn({ onView, onEdit, onDelete }),
  ],
  state: { globalFilter: search, pagination: { pageIndex: page - 1, pageSize } },
});`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="toolbar"
				title="工具栏"
				description="搜索框 + 选中态并入同一行,左右宽度不变 —— 这是 50 个列表页不抖动的关键。"
			>
				<ShowcaseItem
					name="LedgerToolbar"
					summary="搜索 + 选中态并入的版式不变式"
					source="shared/ledger-toolbar.tsx"
					dense
					demo={
						<div className="space-y-2">
							<LedgerToolbar
								search=""
								onSearchChange={() => {}}
								searchPlaceholder="搜索"
								actions={
									<>
										<Button size="sm" variant="outline">
											导入
										</Button>
										<Button size="sm">新增</Button>
									</>
								}
							/>
							<LedgerToolbar
								search="已输入文字"
								onSearchChange={() => {}}
								selectedCount={3}
								onClearSelection={() => {}}
								onBulkDelete={() => {}}
							/>
						</div>
					}
					code={`<LedgerToolbar
  search={search}
  onSearchChange={setSearch}
  selectedCount={selected.size}
  onClearSelection={clear}
  actions={<Button>新增</Button>}
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="filter"
				title="快速筛选条"
				description="按域提供的固定筛选项(分维度排开,各组用调色板上色)。筛选是受控的 —— 状态留在你手里。"
			>
				<ShowcaseItem
					name="FilterChipBar"
					summary="按维度分组的快速筛选"
					source="shared/filter-chips.tsx"
					dense
					demo={
						<FilterChipBar
							groups={[
								{
									key: "类别",
									label: "对象类别",
									Icon: Layers,
									tone: "brand",
									options: [
										{ value: "企业", count: 12 },
										{ value: "人员", count: 5 },
										{ value: "案件", count: 3 },
									],
								},
								{
									key: "状态",
									label: "状态",
									Icon: ListChecks,
									tone: "ocean",
									options: [
										{ value: "启用", count: 16 },
										{ value: "禁用", count: 4 },
									],
								},
							]}
							active={{}}
							onSelect={() => {}}
						/>
					}
					code={`<FilterChipBar
  groups={GROUPS}
  active={active}
  onSelect={(groupKey, value) => setActive({ ...active, [groupKey]: value })}
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="columns"
				title="列选择 + 排序"
				description="改即生效,持久化由 useColumnVisibility 负责(见本页底部)。"
			>
				<ShowcaseItem
					name="ColumnVisibilityMenu"
					summary="列显示 + 拖拽排序的复合面板"
					source="shared/column-visibility-menu.tsx"
					dense
					demo={
						<div className="flex justify-end">
							<ColumnMenuSample />
						</div>
					}
					code={`<ColumnVisibilityMenu
  items={columns.map(c => ({ key: c.id, label: c.header }))}
  isVisible={isVisible}
  onToggle={toggle}
  onMove={move}
  onShowAll={showAll}
  onInvert={invert}
  onReset={reset}
  visibleCount={visibleCount}
  totalCount={columns.length}
/>`}
				/>
				<ShowcaseItem
					name="useColumnVisibility"
					summary="列「显示与否 + 顺序」的持久化(存 sys_config)"
					source="shared/use-column-visibility.ts"
					note={
						<>
							为什么存 <code className="font-mono">sys_config</code> 而不是 localStorage:这是系统设置级别的偏好 ——
							换台机器、换个浏览器都该一致,而且要在「系统设置 ▸ 参数管理」里能改。键是{" "}
							<code className="font-mono">ui.columns.&lt;tableKey&gt;</code>,值是{" "}
							<code className="font-mono">{`{ order: [...], visible: [...] }`}</code>。
							<br />
							<span className="text-[color:var(--warn-fg)]">
								⚠️ 本件走 tRPC 读 `sys_config`,没配 `DATABASE_URL` 时会报错 —— 所以这里只给用法,不做活例子。
							</span>
						</>
					}
					dense
					demo={<div className="text-[12.5px] text-muted-foreground">(需要数据库,故不渲染活例子;用法见下方代码)</div>}
					code={`const allKeys = columns.map((c) => c.id);
const { visibleKeys, order, isVisible, toggle, move, showAll, invert, reset } =
  useColumnVisibility("archive.enterprise", allKeys);

// 列定义按 order 排、visibleKeys 过滤后再交给 useAppTable
const shown = order
  .filter((key) => visibleKeys.includes(key))
  .map((key) => columns.find((c) => c.id === key)!);`}
				/>
				<ShowcaseItem
					name="TableResizeHandle"
					summary="表头列宽拖拽手柄(拖右边缘改宽;双击重置)"
					source="ui/table-resize-handle.tsx"
					note={
						<>
							不用 TanStack 原生 handler:v9 把 <code className="font-mono">getResizeHandler()</code> 挂在{" "}
							<strong className="text-foreground">header</strong> 上(不在 column 上),而本组件只拿得到{" "}
							<code className="font-mono">columnId</code>,故自行基于 th 渲染宽度 + pointer 位移算新宽度。
							列宽想跨会话保留,配合 <code className="font-mono">lib/crud/table-helpers.ts</code> 的{" "}
							<code className="font-mono">usePersistentColumnSizing</code>。
						</>
					}
					demo={<ResizeHandleSample />}
					code={`<TableHead className="relative">
  名称
  <TableResizeHandle
    columnId="名称"
    onChange={(updater) => setColumnSizing(updater)}
  />
</TableHead>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="page" title="分页器">
				<ShowcaseItem
					name="PaginationControl"
					summary="每页条数 + 页码 + 总数,值由调用方持有"
					source="shared/pagination-control.tsx"
					dense
					demo={
						<PaginationControl page={3} pageSize={20} total={387} onPageChange={() => {}} onPageSizeChange={() => {}} />
					}
					code={`<PaginationControl page={page} pageSize={pageSize} total={total}
  onPageChange={setPage} onPageSizeChange={setPageSize} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="loading" title="加载壳">
				<ShowcaseItem
					name="TableLoadingShell"
					summary="保留旧行 + 浮一个读取中指示器,不抖"
					source="shared/table-kit.tsx"
					note={
						<>
							<AlertTriangle className="mr-1 inline size-3 align-[-1px] text-[color:var(--warn-fg)]" />
							在已有数据时换骨架屏会让表格高度从 10 行塌到 1 行 —— 滚动位置会跳。 保留旧行 + 叠指示器是唯一正确做法。
						</>
					}
					demo={
						<TableLoadingShell busy label="读取中…" minHeight={140}>
							<div className="rounded-lg border border-border p-4 text-[13px] text-muted-foreground">
								模拟表格内容:挂着一个占位 div,busy 时它会淡一点,指示器浮在右上。
							</div>
						</TableLoadingShell>
					}
					code={`<TableLoadingShell busy={isFetching} label="读取中…">
  <DataTable table={table} />
</TableLoadingShell>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="readonly"
				title="只读子表"
				description="详情页里嵌一张表(检查子项 / 关联数据 / 同步日志):顺序与字段都是声明式 props,不做交互。"
			>
				<ShowcaseItem
					name="ReadonlyTable"
					summary="声明式 props 的非交互表"
					source="shared/readonly-table.tsx"
					demo={<ReadonlySample />}
					code={`<ReadonlyTable
  columns={[
    { key: "项目", header: "检查项目", width: 180 },
    { key: "结果", header: "结果", render: (row) => <BadgeList values={[row.结果]} /> },
  ]}
  rows={subRows}
  caption="本次检查的子项"
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="notes" title="这一层的规矩">
				<CodeBlock
					code={`展示件共享了**版式**但不共享**字段**:列定义 / 行类型 / 增删改写操作仍由调用方提供
(见 doc/前端结构与组件约定.md §0 第 3 条:不做通用 CRUD 封装)。

- 表格内核在 lib/table.ts(useAppTable / createAppColumnHelper),展示件只是包壳;
- 加载用 TableLoadingShell 不用骨架屏,原因见 id="loading" 节的 note;
- 列选择要做持久化见 useColumnVisibility(底层走 sys_config 的列宽 + 列顺序段);
- 选中态永远走 useRowSelection,它会在 rows 变化时自动剔除消失的 id,不会出现"已选 N 条"虚高。`}
				/>
				<PropTable
					rows={[
						{
							name: "LedgerToolbar.actions",
							type: "ReactNode",
							note: "未选中时右侧显示;选中时自动被「已选 N 条」+ 批量操作替换",
						},
						{
							name: "FilterChipBar.tone",
							type: "FilterChipTone",
							note: "组内选项按调色板轮转上色(brand / ocean / forest …)",
						},
						{ name: "TableLoadingShell.busy", type: "boolean", note: "true 时只淡 + 浮指示器,绝不换内容" },
						{
							name: "ReadonlyColumn.render",
							type: "(row) => ReactNode",
							note: "单元格渲染,默认按 key 取值后 TextCell",
						},
					]}
				/>
				<ShowcaseItem
					name="本节组件计数"
					summary="本展示页覆盖的共享件"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-2">
							<ShowcaseTag variant="secondary">DataTable</ShowcaseTag>
							<ShowcaseTag variant="secondary">SelectColumn</ShowcaseTag>
							<ShowcaseTag variant="secondary">ActionsColumn</ShowcaseTag>
							<ShowcaseTag variant="secondary">ReadonlyTable</ShowcaseTag>
							<ShowcaseTag variant="secondary">LedgerToolbar</ShowcaseTag>
							<ShowcaseTag variant="secondary">FilterChipBar</ShowcaseTag>
							<ShowcaseTag variant="secondary">ColumnVisibilityMenu</ShowcaseTag>
							<ShowcaseTag variant="secondary">PaginationControl</ShowcaseTag>
							<ShowcaseTag variant="secondary">TableLoadingShell</ShowcaseTag>
						</div>
					}
				/>
			</ShowcaseSection>
		</ShowcasePage>
	);
}
