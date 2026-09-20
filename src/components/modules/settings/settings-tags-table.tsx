import { ArrowDown, ArrowUp, ChevronsUpDown, Eye, SquarePen, Trash2 } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { createAppColumnHelper, type useAppTable } from "#/lib/table";
import { type TagDimension, type TagItem, tagCountOfDimension } from "#/mocks/tags";

/** 行类型的唯一家:从契约中枢 re-export(见 `doc/前端结构与组件约定.md` §4.1) */
export type { TagDimension, TagItem };

const dimensionHelper = createAppColumnHelper<TagDimension>;
const tagHelper = createAppColumnHelper<TagItem>;

/** 行级回调:由编排壳闭包注入,表格自己不知道数据从哪来 */
export type SettingsTagDimensionRowCallbacks = {
	onView?: (row: TagDimension) => void;
	onEdit?: (row: TagDimension) => void;
	onDelete?: (row: TagDimension) => void;
	/** 点「维度」或「标签数」→ 打开该维度的标签明细弹窗(标签明细不再常驻本页) */
	onOpenEntries?: (row: TagDimension) => void;
};

export type SettingsTagsRowCallbacks = {
	onView?: (row: TagItem) => void;
	onEdit?: (row: TagItem) => void;
	onDelete?: (row: TagItem) => void;
};

/**
 * 标签维度表的列定义。
 *
 * `标签数` 是派生列:按标签明细表里该维度下的行数实时统计(标签明细增删后即时反映),
 * 与「维度构成」图同源,不存在第二份计数。
 *
 * 「维度」与「标签数」两格都是**入口**:点进去看该维度的标签明细
 * (明细表已从本页移入弹窗,见 `settings-tags-entries-dialog.tsx`)。
 */
export function createSettingsTagDimensionColumns({
	selected,
	onToggleOne,
	onToggleMany,
	callbacks,
}: {
	selected: ReadonlySet<string>;
	onToggleOne: (id: string, on: boolean) => void;
	onToggleMany: (ids: string[], on: boolean) => void;
	callbacks: SettingsTagDimensionRowCallbacks;
}) {
	return dimensionHelper().columns([
		dimensionHelper().display({
			id: "__select",
			size: 56,
			header: (ctx) => {
				const pageIds = ctx.table.getRowModel().rows.map((row) => row.original.id);
				const allOn = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
				return (
					<Checkbox
						aria-label="全选本页"
						checked={allOn}
						onCheckedChange={(checked) => onToggleMany(pageIds, checked === true)}
					/>
				);
			},
			cell: (ctx) => (
				<Checkbox
					aria-label="选择该行"
					checked={selected.has(ctx.row.original.id)}
					onCheckedChange={(checked) => onToggleOne(ctx.row.original.id, checked === true)}
				/>
			),
		}),
		dimensionHelper().accessor("维度", {
			header: "维度",
			size: 160,
			cell: (info) => {
				const name = String(info.getValue);
				return (
					<button
						type="button"
						aria-label={`查看「${name}」的标签明细`}
						title={`查看「${name}」的标签明细`}
						onClick={() => callbacks.onOpenEntries?.(info.row.original)}
						className="cursor-pointer font-medium text-primary hover:underline"
					>
						{name}
					</button>
				);
			},
		}),
		dimensionHelper().accessor("适用对象", {
			header: "适用对象",
			size: 320,
			cell: (info) => <span className="block max-w-[320px] truncate">{String(info.getValue)}</span>,
		}),
		dimensionHelper().accessor("来源", { header: "来源", size: 130 }),
		dimensionHelper().display({
			id: "标签数",
			header: "标签数",
			size: 90,
			// 派生列逻辑不变(tagCountOfDimension 实时统计);只是把数字变成入口
			cell: ({ row }) => {
				const count = tagCountOfDimension(row.original.维度);
				return (
					<button
						type="button"
						aria-label={`查看「${row.original.维度}」的标签明细(${count} 个标签)`}
						title={`查看「${row.original.维度}」的标签明细`}
						onClick={() => callbacks.onOpenEntries?.(row.original)}
						className="cursor-pointer font-medium text-primary tabular-nums hover:underline"
					>
						{count} 条
					</button>
				);
			},
		}),
		dimensionHelper().accessor("备注", {
			header: "备注",
			size: 320,
			cell: (info) => <span className="block max-w-[320px] truncate">{String(info.getValue)}</span>,
		}),
		dimensionHelper().display({
			id: "__actions",
			size: 110,
			header: "操作",
			cell: ({ row }) => (
				<div className="flex items-center gap-0.5">
					<Button variant="ghost" size="icon-sm" aria-label="详情" onClick={() => callbacks.onView?.(row.original)}>
						<Eye className="size-3.5" />
					</Button>
					<Button variant="ghost" size="icon-sm" aria-label="编辑" onClick={() => callbacks.onEdit?.(row.original)}>
						<SquarePen className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="删除"
						className="text-destructive"
						onClick={() => callbacks.onDelete?.(row.original)}
					>
						<Trash2 className="size-3.5" />
					</Button>
				</div>
			),
		}),
	]);
}

/** 标签明细表的列定义 */
export function createSettingsTagsColumns({
	selected,
	onToggleOne,
	onToggleMany,
	callbacks,
}: {
	selected: ReadonlySet<string>;
	onToggleOne: (id: string, on: boolean) => void;
	onToggleMany: (ids: string[], on: boolean) => void;
	callbacks: SettingsTagsRowCallbacks;
}) {
	return tagHelper().columns([
		tagHelper().display({
			id: "__select",
			size: 56,
			header: (ctx) => {
				const pageIds = ctx.table.getRowModel().rows.map((row) => row.original.id);
				const allOn = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
				return (
					<Checkbox
						aria-label="全选本页"
						checked={allOn}
						onCheckedChange={(checked) => onToggleMany(pageIds, checked === true)}
					/>
				);
			},
			cell: (ctx) => (
				<Checkbox
					aria-label="选择该行"
					checked={selected.has(ctx.row.original.id)}
					onCheckedChange={(checked) => onToggleOne(ctx.row.original.id, checked === true)}
				/>
			),
		}),
		tagHelper().accessor("维度", {
			header: "所属维度",
			size: 160,
			cell: (info) => <Badge variant="secondary">{String(info.getValue)}</Badge>,
		}),
		tagHelper().accessor("标签", {
			header: "标签",
			size: 180,
			cell: (info) => <span className="font-medium">{String(info.getValue)}</span>,
		}),
		tagHelper().accessor("含义", {
			header: "含义",
			size: 420,
			cell: (info) => <span className="block max-w-[420px] truncate">{String(info.getValue)}</span>,
		}),
		tagHelper().display({
			id: "__actions",
			size: 110,
			header: "操作",
			cell: ({ row }) => (
				<div className="flex items-center gap-0.5">
					<Button variant="ghost" size="icon-sm" aria-label="详情" onClick={() => callbacks.onView?.(row.original)}>
						<Eye className="size-3.5" />
					</Button>
					<Button variant="ghost" size="icon-sm" aria-label="编辑" onClick={() => callbacks.onEdit?.(row.original)}>
						<SquarePen className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="删除"
						className="text-destructive"
						onClick={() => callbacks.onDelete?.(row.original)}
					>
						<Trash2 className="size-3.5" />
					</Button>
				</div>
			),
		}),
	]);
}

/** 表头排序图标 */
function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
	if (dir === "asc") return <ArrowUp className="size-3.5" />;
	if (dir === "desc") return <ArrowDown className="size-3.5" />;
	return <ChevronsUpDown className="size-3.5 opacity-40" />;
}

/** 标签维度表的表格壳:表头排序 + 空态;数据与状态都由编排壳传入 */
export function SettingsTagDimensionTable({
	table,
	emptyText = "暂无标签维度",
}: {
	table: ReturnType<typeof useAppTable<TagDimension>>;
	emptyText?: string;
}) {
	const colSpan = table.getAllLeafColumns().length;
	const rows = table.getRowModel().rows;

	return (
		<Table>
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
							{emptyText}
						</TableCell>
					</TableRow>
				) : (
					rows.map((row) => (
						<TableRow key={row.id}>
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

/** 标签明细表的表格壳(与维度表同构但各写一份,见 §2) */
export function SettingsTagsTable({
	table,
	emptyText = "暂无标签明细",
}: {
	table: ReturnType<typeof useAppTable<TagItem>>;
	emptyText?: string;
}) {
	const colSpan = table.getAllLeafColumns().length;
	const rows = table.getRowModel().rows;

	return (
		<Table>
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
							{emptyText}
						</TableCell>
					</TableRow>
				) : (
					rows.map((row) => (
						<TableRow key={row.id}>
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
