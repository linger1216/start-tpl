import { ArrowDown, ArrowUp, ChevronsUpDown, Eye, SquarePen, Trash2, UserCog } from "lucide-react";

import { TagBadges } from "#/components/modules/shared/tag-badges";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { createAppColumnHelper, type useAppTable } from "#/lib/table";
import { type GrantRecordRow, type GroupRow, listOf } from "#/mocks/settings";

/** 行类型的唯一家:从契约中枢 re-export(见 `doc/前端结构与组件约定.md` §4.1) */
export type { GrantRecordRow, GroupRow };

const columnHelper = createAppColumnHelper<GroupRow>;
const grantRecordHelper = createAppColumnHelper<GrantRecordRow>;

/** 行级回调:由编排壳闭包注入,表格自己不知道数据从哪来 */
export type SettingsGroupsRowCallbacks = {
	onView?: (row: GroupRow) => void;
	onEdit?: (row: GroupRow) => void;
	onDelete?: (row: GroupRow) => void;
	/** 管理成员 / 组授权(两个动作收在同一个弹窗的两个 tab 里) */
	onManage?: (row: GroupRow) => void;
};

/** 状态徽章 —— 只有本页用,就近定义 */
function GroupStatusBadge({ value }: { value: string }) {
	return <Badge variant={value === "启用" ? "default" : "secondary"}>{value}</Badge>;
}

/**
 * 用户组管理的列定义。
 *
 * `成员数` 与 `已授权权限数` 是 的派生列:按 `成员ids` / `权限点` 数组长度算,
 * 「管理成员」「组授权」保存后即时反映,且表单 / 导入都改不动它们。
 */
export function createSettingsGroupsColumns({
	selected,
	onToggleOne,
	onToggleMany,
	callbacks,
}: {
	selected: ReadonlySet<string>;
	onToggleOne: (id: string, on: boolean) => void;
	onToggleMany: (ids: string[], on: boolean) => void;
	callbacks: SettingsGroupsRowCallbacks;
}) {
	return columnHelper().columns([
		columnHelper().display({
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
		columnHelper().accessor("组名", {
			header: "组名",
			size: 190,
			cell: (info) => <span className="block max-w-[190px] truncate font-medium">{String(info.getValue)}</span>,
		}),
		columnHelper().accessor("所属条线", { header: "所属条线", size: 130 }),
		// 派生列:成员数 = 组成员 id 数组长度(「管理成员」写回后即时反映)
		columnHelper().display({
			id: "成员数",
			header: "成员数",
			size: 90,
			cell: ({ row }) => <span className="tabular-nums">{listOf(row.original.成员ids).length}</span>,
		}),
		columnHelper().accessor("已授权角色", {
			header: "已授权角色",
			size: 210,
			cell: (info) => <TagBadges tags={listOf(info.row.original.已授权角色)} />,
		}),
		// 派生列:已授权权限数 = 组权限点数组长度(「组授权」写回后即时反映)
		columnHelper().display({
			id: "已授权权限数",
			header: "已授权权限数",
			size: 120,
			cell: ({ row }) => <span className="tabular-nums">{listOf(row.original.权限点).length}</span>,
		}),
		columnHelper().accessor("状态", {
			header: "状态",
			size: 90,
			cell: (info) => <GroupStatusBadge value={String(info.getValue)} />,
		}),
		columnHelper().accessor("创建时间", {
			header: "创建时间",
			size: 120,
			cell: (info) => info.getValue || PLACEHOLDER_EMPTY,
		}),
		columnHelper().display({
			id: "__actions",
			size: 180,
			header: "操作",
			cell: ({ row }) => (
				<div className="flex items-center gap-0.5">
					<Button variant="ghost" size="icon-sm" aria-label="详情" onClick={() => callbacks.onView?.(row.original)}>
						<Eye className="size-3.5" />
					</Button>
					<Button variant="ghost" size="icon-sm" aria-label="编辑" onClick={() => callbacks.onEdit?.(row.original)}>
						<SquarePen className="size-3.5" />
					</Button>
					{/*:成员管理 + 组授权的统一入口 */}
					<Button
						variant="ghost"
						size="sm"
						aria-label="管理成员 / 组授权"
						title="管理成员 / 组授权"
						className="gap-1 px-2 text-[12px]"
						onClick={() => callbacks.onManage?.(row.original)}
					>
						<UserCog className="size-3.5" />
						成员/授权
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

/** 授权记录列(只读:落库证据,由授权写回函数追加) */
export function createSettingsGroupsGrantRecordColumns() {
	return grantRecordHelper().columns([
		grantRecordHelper().accessor("授权对象类型", {
			header: "授权对象类型",
			size: 110,
			cell: (info) => <Badge variant="secondary">{String(info.getValue)}</Badge>,
		}),
		grantRecordHelper().accessor("授权对象", { header: "授权对象", size: 170 }),
		grantRecordHelper().accessor("授权内容", {
			header: "授权内容",
			size: 320,
			cell: (info) => <span className="block max-w-[320px] truncate">{String(info.getValue)}</span>,
		}),
		grantRecordHelper().accessor("授权来源", { header: "授权来源", size: 130 }),
		grantRecordHelper().accessor("操作人", { header: "操作人", size: 170 }),
		grantRecordHelper().accessor("授权时间", { header: "授权时间", size: 140 }),
	]);
}

/** 表头排序图标 */
function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
	if (dir === "asc") return <ArrowUp className="size-3.5" />;
	if (dir === "desc") return <ArrowDown className="size-3.5" />;
	return <ChevronsUpDown className="size-3.5 opacity-40" />;
}

/** 表格壳:表头排序 + 空态;数据与状态都由编排壳传入 */
export function SettingsGroupsTable({
	table,
	emptyText = "暂无用户组数据",
}: {
	table: ReturnType<typeof useAppTable<GroupRow>>;
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

/** 用户组级授权记录的只读表格壳(与上面的组表同构但各写一份,见 §2) */
export function SettingsGroupsGrantRecordTable({
	table,
	emptyText = "还没有用户组级授权记录,先在行操作「成员/授权 → 组授权」里保存一次",
}: {
	table: ReturnType<typeof useAppTable<GrantRecordRow>>;
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
