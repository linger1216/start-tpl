import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { ActionButton } from "#/components/ui/action-button";
import { Checkbox } from "#/components/ui/checkbox";
import { Skeleton, SkeletonTable } from "#/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { Tag } from "#/components/ui/tag";
import type { MockRow } from "#/lib/table";
import { createAppColumnHelper, type useAppTable } from "#/lib/table";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/**
 * 表格基础设施 —— **只承载与具体字段无关的部分**:
 *
 *   · `DataTable`          表壳:表头排序 + 空态(数据 / 列 / 状态全部由页面传入);
 *   · `selectColumn`       多选列(表头全选本页 + 行勾选),选中集合由编排壳持有;
 *   · `actionsColumn`      行操作列(详情 / 编辑 / 删除),回调由编排壳闭包注入;
 *   · `timeColumn`         时间列(表头 + 等宽时间单元格);
 *   · `EnabledTag`       启停两态徽章(1 = 启用);
 *   · `TextCell`  单元格渲染口径(长文本传 `truncate`);
 *   · `TimeCell`  时间单元格(统一 `formatLocalMinute` 口径 + 等宽数字);
 *   · `TableLoadingShell`  请求中的加载壳(不换内容、只叠指示器)。
 *
 * 为什么允许共用:这些件**不含字段声明、不订阅 store、不承载写操作** ——
 * 每条记录的列 / 表单 / 详情仍在各自的 `-table` / `-form` / `-detail.tsx` 里手写
 * (见 `doc/界面约定.md` §0 第 3 条:不做 fields 声明式驱动的通用 CRUD)。
 *
 * 本文件由三份同构实现合并而来(明细表壳 / 关联子表壳 / 诉求子表壳),
 * 它们此前各抄了一遍排序图标与空态行 —— 改一次要改三处,且列宽口径已经漂移过。
 */

/** 表壳:表头可排序 + 空态一行。数据与状态都由编排壳传入 */
export function DataTable<TRow extends MockRow>({
	table,
	emptyText = "暂无数据",
	className,
	rowClassName,
}: {
	table: ReturnType<typeof useAppTable<TRow>>;
	emptyText?: string;
	className?: string;
	/** 每行的附加 class(典型用法:选中行高亮)。拿到原始行数据,由调用方自己算 */
	rowClassName?: (row: TRow) => string | undefined;
}) {
	// 空态那一行要跨**可见**列 —— 用 getAllLeafColumns 会把隐藏列也算进去,跨列多一格
	const colSpan = table.getVisibleLeafColumns().length;
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
			{/*
			 * key 跟着"这一页的行 id"变化 → 换页 / 换每页条数时 tbody 重挂载,
			 * `.stagger` 的逐行浮入动画就会重新播一遍(否则 React 复用 tr、动画只播一次)。
			 * 只在**行集合真的变了**时换 key,同一页内点排序不会整块重放。
			 */}
			<TableBody key={rows.map((row) => row.id).join("|")} className="stagger">
				{rows.length === 0 ? (
					<TableRow>
						<TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
							{noFilteredResult ? emptyText : "没有匹配的数据"}
						</TableCell>
					</TableRow>
				) : (
					rows.map((row) => (
						<TableRow key={row.id} className={rowClassName?.(row.original)}>
							{/*
							 * ⚠️ 必须是 `getVisibleCells()`:表头走 `getHeaderGroups()` 自己会跳过隐藏列,
							 * 而 `getAllCells()` 会把**隐藏列的 cell 也渲染出来** —— 症状就是"取消勾选某列,
							 * 表头没了、数据和它的单元格还在"(只是被挤到后面,看起来像错位)。
							 */}
							{row.getVisibleCells().map((cell) => (
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
function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
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
		// 勾选列不给隐藏 —— 列开关里出现"隐藏勾选框"没有意义
		enableHiding: false,
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
	viewLabel = "详情",
	onEdit,
	onDelete,
	disabled,
	size = 132,
}: {
	/** 页面特有的额外动作(渲染在 详情/编辑/删除 **之前**),如角色的「菜单权限」、用户的「授权」 */
	extra?: (row: TRow) => ReactNode;
	onView?: (row: TRow) => void;
	/** 查看按钮文案 —— 通知页的语义是「打开」,默认「详情」 */
	viewLabel?: string;
	onEdit?: (row: TRow) => void;
	onDelete?: (row: TRow) => void;
	/**
	 * 逐行判断「编辑 / 删除」是否可用(返回 true 则置灰)。不传 = 都可用。
	 * 典型用法:参数管理里 `editable = 0` 的代码内置参数只能看不能改。
	 */
	disabled?: (row: TRow) => boolean;
	size?: number;
}) {
	return createAppColumnHelper<TRow>().display({
		id: "__actions",
		size,
		// 操作列不给隐藏 —— 藏掉它整张表就只能看不能动
		enableHiding: false,
		header: "操作",
		cell: ({ row }) => (
			<div className="flex items-center gap-3">
				{extra?.(row.original)}
				{onView ? <ActionButton onClick={() => onView(row.original)}>{viewLabel}</ActionButton> : null}
				{onEdit ? (
					<ActionButton disabled={disabled?.(row.original)} onClick={() => onEdit(row.original)}>
						编辑
					</ActionButton>
				) : null}
				{onDelete ? (
					<ActionButton disabled={disabled?.(row.original)} tone="danger" onClick={() => onDelete(row.original)}>
						删除
					</ActionButton>
				) : null}
			</div>
		),
	});
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

/** 时间单元格:统一 `formatLocalMinute` 口径 + 等宽数字 + 次级色(空值走 `TextCell` 的 `—`) */
function TimeCell({ value }: { value: unknown }) {
	return (
		<span className="tabular-nums text-xs text-muted-foreground">
			<TextCell value={formatLocalMinute(value as Date | string | number | null | undefined)} />
		</span>
	);
}

/**
 * 时间列工厂:表头 + 等宽时间单元格。
 *
 * **沿用调用方的 accessor 键**,不另造列 id —— 于是排序能力与 `page.columns` 里持久化的
 * 列 id 都保持原样(换成 display 列会两者一起丢)。
 * `header` 默认「创建时间」,更新时间等场景自己覆盖;`size` 默认 150(与现有时间列一致)。
 */
export function timeColumn<TRow extends MockRow>(
	key: keyof TRow & string,
	{ header = "创建时间", size = 150 }: { header?: string; size?: number } = {},
) {
	return createAppColumnHelper<TRow>().accessor((row: TRow) => row[key], {
		// `id` 必须沿用调用方的 accessor 键:列偏好(`page.columns`)按 id 存,换 id 会把用户存下的顺序 / 隐藏态作废
		id: key,
		header,
		size,
		cell: (ctx) => <TimeCell value={ctx.getValue()} />,
	});
}

/**
 * 「启用 / 停用」两态徽章 —— 8 张系统设置表 + 详情面共用同一个口径(1 = 启用)。
 *
 * 只服务**启停开关**这种两态;文件状态(待确认 / 正常 / 已删除)、数据范围(停用 / 上线 / 启用)
 * 这些各自有专用 spec,不要往这里塞。
 */
export function EnabledTag({ status }: { status: unknown }) {
	const on = Number(status) === 1;
	return (
		<Tag variant={on ? "secondary" : "outline"} className="text-xs">
			{on ? "启用" : "停用"}
		</Tag>
	);
}

export function TableLoadingShell({
	busy,
	label = "读取中…",
	minHeight = 220,
	fill = false,
	showSkeleton = false,
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
	/**
	 * `true` = 首次加载(没旧数据)时显示骨架行(B1 条)代替带 spinner 的占位;
	 * 后续请求(已有数据 + `busy`)仍走老的 spinner 行为。
	 * 调用方根据 listQuery.isPending 决定首次 / 后续。
	 */
	showSkeleton?: boolean;
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
					/*
					 * `fill` 下**纵向滚动交给表格自己的容器**(`ui/table.tsx` 的 `[data-slot=table-container]`)。
					 * 不让这一层滚,是因为它一旦是滚动容器,表头的 `sticky` 会被**更近的**容器抢走 ——
					 * 表应该是相对"真正滚动的那个盒子"粘住。实测踩过:表头 position:sticky 但滚动时照样跑掉。
					 */
					fill &&
						"min-h-0 flex-1 overflow-hidden [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:min-h-0 [&>[data-slot=table-container]]:overflow-y-auto",
					/*
					 * 首次加载(busy=true 且 showSkeleton=true)完全不渲染 children,改由下方的 `SkeletonTable` 接管;
					 * 此时不再加 opacity-60(没有旧数据要模糊)。
					 */
					busy && !showSkeleton && "opacity-60",
				)}
			>
				{busy && showSkeleton ? (
					<div className="px-1 py-2">
						<div className="mb-2 flex items-center justify-between">
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-7 w-32" />
						</div>
						<SkeletonTable />
					</div>
				) : (
					children
				)}
			</div>
			{busy && !showSkeleton ? (
				<div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
					<Tag
						variant="outline"
						className="h-7 gap-1.5 bg-background/95 px-2.5 text-xs text-muted-foreground shadow-sm"
					>
						<Loader2 className="size-3.5 animate-spin" />
						{label}
					</Tag>
				</div>
			) : null}
		</div>
	);
}
