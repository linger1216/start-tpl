import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { ActionButton } from "#/components/ui/action-button";
import { Checkbox } from "#/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import type { MockRow } from "#/lib/mock-table";
import { splitMultiValue } from "#/lib/multi-value";
import { createAppColumnHelper, type useAppTable } from "#/lib/table";
import { cn } from "#/lib/utils";

/**
 * 表格基础设施 —— **只承载与具体字段无关的部分**:
 *
 *   · `DataTable`          表壳:表头排序 + 空态(数据 / 列 / 状态全部由页面传入);
 *   · `selectColumn`       多选列(表头全选本页 + 行勾选),选中集合由编排壳持有;
 *   · `actionsColumn`      行操作列(详情 / 编辑 / 删除),回调由编排壳闭包注入;
 *   · `multiValueFilterFn` 多值(标签)列的取值筛选;
 *   · `TextCell`  单元格渲染口径(长文本传 `truncate`);
 *   · `TableLoadingShell`  请求中的加载壳(不换内容、只叠指示器)。
 *
 * 为什么允许共用:这些件**不含字段声明、不订阅 store、不承载写操作** ——
 * 每条记录的列 / 表单 / 详情仍在各自的 `-table` / `-form` / `-detail.tsx` 里手写
 * (见 `doc/前端结构与组件约定.md` §0 第 3 条:不做 fields 声明式驱动的通用 CRUD)。
 *
 * 本文件由三份同构实现合并而来(明细表壳 / 关联子表壳 / 诉求子表壳),
 * 它们此前各抄了一遍排序图标与空态行 —— 改一次要改三处,且列宽口径已经漂移过。
 */

/** 表壳:表头可排序 + 空态一行。数据与状态都由编排壳传入 */
export function DataTable<TRow extends MockRow>({
	table,
	emptyText = "暂无数据",
	/** 行集合本身为空时的文案(与「筛选后无结果」区分开);不传则与 `emptyText` 同文案 */
	emptyDataText,
	className,
	rowClassName,
}: {
	table: ReturnType<typeof useAppTable<TRow>>;
	emptyText?: string;
	emptyDataText?: string;
	className?: string;
	/** 每行的附加 class(典型用法:选中行高亮)。拿到原始行数据,由调用方自己算 */
	rowClassName?: (row: TRow) => string | undefined;
}) {
	const colSpan = table.getAllLeafColumns().length;
	const rows = table.getRowModel().rows;
	const noFilteredResult = table.getFilteredRowModel().rows.length === 0;

	return (
		<Table className={className}>
			<TableHeader>
				{table.getHeaderGroups().map((headerGroup) => (
					<TableRow key={headerGroup.id}>
						{headerGroup.headers.map((header) => {
							const dir = header.column.getIsSorted();
							return (
								<TableHead key={header.id} style={{ width: header.getSize() }}>
									{header.isPlaceholder ? null : header.column.getCanSort() ? (
										<button
											type="button"
											onClick={header.column.getToggleSortingHandler()}
											className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
										>
											<table.FlexRender header={header} />
											<SortIcon dir={dir} />
										</button>
									) : (
										<table.FlexRender header={header} />
									)}
								</TableHead>
							);
						})}
					</TableRow>
				))}
			</TableHeader>
			<TableBody>
				{rows.length === 0 ? (
					<TableRow>
						<TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
							{noFilteredResult ? (emptyDataText ?? emptyText) : "没有匹配的数据"}
						</TableCell>
					</TableRow>
				) : (
					rows.map((row) => (
						<TableRow key={row.id} className={rowClassName?.(row.original)}>
							{row.getAllCells().map((cell) => (
								<TableCell key={cell.id} style={{ width: cell.column.getSize() }}>
									<table.FlexRender cell={cell} />
								</TableCell>
							))}
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	);
}

/** 表头排序图标(升 / 降 / 未排序三态) */
export function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
	if (dir === "asc") return <ArrowUp className="size-3.5" />;
	if (dir === "desc") return <ArrowDown className="size-3.5" />;
	return <ChevronsUpDown className="size-3.5 opacity-40" />;
}

/** 多选列(表头全选本页 + 行勾选);选中状态由编排壳持有 */
export function selectColumn<TRow extends MockRow>({
	selected,
	onToggleOne,
	onToggleMany,
	size = 56,
}: {
	selected: ReadonlySet<string>;
	onToggleOne: (id: string, on: boolean) => void;
	onToggleMany: (ids: string[], on: boolean) => void;
	size?: number;
}) {
	return createAppColumnHelper<TRow>().display({
		id: "__select",
		size,
		header: (ctx) => {
			const pageIds = ctx.table.getRowModel().rows.map((row) => String(row.original.id));
			const allOn = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
			return (
				<Checkbox
					aria-label="全选本页"
					checked={allOn}
					onCheckedChange={(checked) => onToggleMany(pageIds, checked === true)}
				/>
			);
		},
		cell: (ctx) => {
			const id = String(ctx.row.original.id);
			return (
				<Checkbox
					aria-label="选择该行"
					checked={selected.has(id)}
					onCheckedChange={(checked) => onToggleOne(id, checked === true)}
				/>
			);
		},
	});
}

/**
 * 行操作列:**详情 / 编辑 / 删除** —— 纯文字操作按钮(`ActionButton`),不带图标。
 *
 * 回调由编排壳闭包注入,**不传的那一项就不渲染**。
 *
 * ⚠️ `size` 默认 132(不是原来的 96):文字比图标占地方,三个两字标签 + 间距大概这么宽;
 * 只传一两个回调时可以自己调小。宽度给不够,操作列会换行把行高撑开 —— 那正是"操作按钮空间小"的由来。
 */
export function actionsColumn<TRow extends MockRow>({
	extra,
	onView,
	onEdit,
	onDelete,
	size = 132,
}: {
	/** 页面特有的额外动作(渲染在 详情/编辑/删除 **之前**),如角色的「菜单权限」、用户的「授权」 */
	extra?: (row: TRow) => ReactNode;
	onView?: (row: TRow) => void;
	onEdit?: (row: TRow) => void;
	onDelete?: (row: TRow) => void;
	size?: number;
}) {
	return createAppColumnHelper<TRow>().display({
		id: "__actions",
		size,
		header: "操作",
		cell: ({ row }) => (
			<div className="flex items-center gap-3">
				{extra?.(row.original)}
				{onView ? <ActionButton onClick={() => onView(row.original)}>详情</ActionButton> : null}
				{onEdit ? <ActionButton onClick={() => onEdit(row.original)}>编辑</ActionButton> : null}
				{onDelete ? (
					<ActionButton tone="danger" onClick={() => onDelete(row.original)}>
						删除
					</ActionButton>
				) : null}
			</div>
		),
	});
}

/**
 * 多值(标签)列的取值筛选。
 * `filterValue` 既可以是单个值,也可以是数组 —— 多个标签维度命中同一列时
 * (重点关注的三类对象共用「分类标签」列)会把各自选中的值聚合成数组,任一命中即保留该行。
 */
export function multiValueFilterFn(
	row: { getValue: (columnId: string) => unknown },
	columnId: string,
	filterValue: unknown,
): boolean {
	if (filterValue === undefined || filterValue === null || filterValue === "") return true;
	const wanted = Array.isArray(filterValue) ? filterValue.map(String) : [String(filterValue)];
	const cell = splitMultiValue(row.getValue(columnId));
	return wanted.some((value) => cell.includes(value));
}

/** 单值文本单元格:空值统一显示 `—` */
export function TextCell({ value, truncate = false }: { value: unknown; truncate?: boolean }) {
	const text = value === undefined || value === null || value === "" ? "—" : String(value);
	if (!truncate) return <>{text}</>;
	return (
		<span className="block max-w-[280px] truncate" title={text}>
			{text}
		</span>
	);
}

export function TableLoadingShell({
	busy,
	label = "读取中…",
	minHeight = 220,
	fill = false,
	className,
	children,
}: {
	/** 正在请求(含换页 / 改搜索词);有旧数据时会保留旧行,只叠指示器 */
	busy: boolean;
	label?: string;
	/** 预留高度:避免空结果把页面拽短(视口太矮时也靠它兜底成整页滚动) */
	minHeight?: number;
	/**
	 * `true` = **占满父级剩下的高度,表格在里面滚**(表头粘住)。
	 * 父级必须给得出确定高度(典型:`Card` + `CardContent` 都带 `min-h-0 flex-1`)。
	 * 不传就是老行为:内容多高就多高,由整页滚动。
	 */
	fill?: boolean;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			className={cn("relative", fill && "flex min-h-0 flex-1 flex-col", className)}
			style={{ minHeight }}
			aria-busy={busy}
		>
			<div
				className={cn(
					busy && "opacity-60",
					/*
					 * `fill` 下**纵向滚动交给表格自己的容器**(`ui/table.tsx` 的 `[data-slot=table-container]`)。
					 * 不让这一层滚,是因为它一旦是滚动容器,表头的 `sticky` 会被**更近的**容器抢走 ——
					 * 表应该是相对"真正滚动的那个盒子"粘住。实测踩过:表头 position:sticky 但滚动时照样跑掉。
					 */
					fill &&
						"min-h-0 flex-1 overflow-hidden [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:min-h-0 [&>[data-slot=table-container]]:overflow-y-auto",
				)}
			>
				{children}
			</div>
			{busy ? (
				<div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
					<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-2.5 py-1 text-[12px] text-muted-foreground shadow-sm">
						<Loader2 className="size-3.5 animate-spin" />
						{label}
					</span>
				</div>
			) : null}
		</div>
	);
}
