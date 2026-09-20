import { ArrowDown, ArrowUp, ChevronsUpDown, Eye, KeyRound, SquarePen, Trash2 } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { createAppColumnHelper, type useAppTable } from "#/lib/table";
import { countUsersWithRole, type GrantRecordRow, listOf, type PermissionPoint, type RoleRow } from "#/mocks/settings";

/** 行类型的唯一家:从契约中枢 re-export(见 `doc/前端结构与组件约定.md` §4.1) */
export type { GrantRecordRow, PermissionPoint, RoleRow };

const columnHelper = createAppColumnHelper<RoleRow>;
const permissionPointHelper = createAppColumnHelper<PermissionPoint>;
const grantRecordHelper = createAppColumnHelper<GrantRecordRow>;

/** 行级回调:由编排壳闭包注入,表格自己不知道数据从哪来 */
export type SettingsRolesRowCallbacks = {
	onView?: (row: RoleRow) => void;
	onEdit?: (row: RoleRow) => void;
	onDelete?: (row: RoleRow) => void;
	/** 按角色配置权限(权限树勾选菜单权限与操作权限) */
	onGrant?: (row: RoleRow) => void;
};

/** 状态徽章 —— 只有本页用,就近定义 */
function RoleStatusBadge({ value }: { value: string }) {
	return <Badge variant={value === "启用" ? "default" : "secondary"}>{value}</Badge>;
}

/** 权限类型徽章:目录只作分组(不可单独授权),与权限树的口径一致 */
function PermissionKindBadge({ value }: { value: string }) {
	const variant = value === "操作" ? "outline" : value === "目录" ? "secondary" : "default";
	return <Badge variant={variant}>{value}</Badge>;
}

/**
 * 角色管理的列定义。
 *
 * `关联用户数` 与 `权限点数` 是 的派生列:前者按用户表的**多角色数组**实时统计
 * (一个用户持 N 个角色就在 N 行里各计一次),后者是角色权限点数组长度;
 * 「配置权限」保存后两者即时更新,表单与导入都改不动它们。
 */
export function createSettingsRolesColumns({
	selected,
	onToggleOne,
	onToggleMany,
	callbacks,
}: {
	selected: ReadonlySet<string>;
	onToggleOne: (id: string, on: boolean) => void;
	onToggleMany: (ids: string[], on: boolean) => void;
	callbacks: SettingsRolesRowCallbacks;
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
		columnHelper().accessor("角色名", {
			header: "角色名",
			size: 150,
			cell: (info) => <span className="font-medium">{String(info.getValue)}</span>,
		}),
		columnHelper().accessor("角色编码", { header: "角色编码", size: 190 }),
		columnHelper().accessor("数据范围", { header: "数据范围", size: 130 }),
		// 派生列:持有该角色的用户数(多角色用户在所属的每个角色下各计一次)
		columnHelper().display({
			id: "关联用户数",
			header: "关联用户数",
			size: 110,
			cell: ({ row }) => <span className="tabular-nums">{countUsersWithRole(row.original.角色名)}</span>,
		}),
		// 派生列:权限点数 = 角色权限点数组长度
		columnHelper().display({
			id: "权限点数",
			header: "权限点数",
			size: 100,
			cell: ({ row }) => <span className="tabular-nums">{listOf(row.original.权限点).length}</span>,
		}),
		columnHelper().accessor("状态", {
			header: "状态",
			size: 90,
			cell: (info) => <RoleStatusBadge value={String(info.getValue)} />,
		}),
		columnHelper().accessor("创建时间", {
			header: "创建时间",
			size: 120,
			cell: (info) => info.getValue || PLACEHOLDER_EMPTY,
		}),
		columnHelper().accessor("备注", {
			header: "备注",
			size: 240,
			cell: (info) => <span className="block max-w-[240px] truncate">{String(info.getValue)}</span>,
		}),
		columnHelper().display({
			id: "__actions",
			size: 170,
			header: "操作",
			cell: ({ row }) => (
				<div className="flex items-center gap-0.5">
					<Button variant="ghost" size="icon-sm" aria-label="详情" onClick={() => callbacks.onView?.(row.original)}>
						<Eye className="size-3.5" />
					</Button>
					<Button variant="ghost" size="icon-sm" aria-label="编辑" onClick={() => callbacks.onEdit?.(row.original)}>
						<SquarePen className="size-3.5" />
					</Button>
					{/*:按角色配置权限(需求原文:根据角色信息对用户进行授权管理) */}
					<Button
						variant="ghost"
						size="sm"
						aria-label="配置权限"
						title="配置权限"
						className="gap-1 px-2 text-[12px]"
						onClick={() => callbacks.onGrant?.(row.original)}
					>
						<KeyRound className="size-3.5" />
						配置权限
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

/** 权限点清单列(只读:权限树的扁平视图,来自契约中枢的 `PERMISSION_POINTS`) */
export function createSettingsPermissionPointColumns() {
	return permissionPointHelper().columns([
		permissionPointHelper().accessor("code", { header: "权限编码", size: 200 }),
		permissionPointHelper().accessor("name", { header: "权限名称", size: 140 }),
		permissionPointHelper().accessor("kind", {
			header: "权限类型",
			size: 100,
			cell: (info) => <PermissionKindBadge value={String(info.getValue)} />,
		}),
		permissionPointHelper().accessor("所属模块", { header: "所属模块", size: 130 }),
		permissionPointHelper().accessor("说明", {
			header: "说明",
			size: 320,
			cell: (info) => <span className="block max-w-[320px] truncate">{String(info.getValue)}</span>,
		}),
	]);
}

/** 授权记录列(只读:落库证据,由授权写回函数追加) */
export function createSettingsRolesGrantRecordColumns() {
	return grantRecordHelper().columns([
		grantRecordHelper().accessor("授权对象类型", {
			header: "授权对象类型",
			size: 110,
			cell: (info) => <Badge variant="secondary">{String(info.getValue)}</Badge>,
		}),
		grantRecordHelper().accessor("授权对象", { header: "授权对象", size: 160 }),
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

/** 角色表的表格壳:表头排序 + 空态;数据与状态都由编排壳传入 */
export function SettingsRolesTable({
	table,
	emptyText = "暂无角色数据",
}: {
	table: ReturnType<typeof useAppTable<RoleRow>>;
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

/** 权限点清单的只读表格壳(与角色表同构但各写一份,见 §2) */
export function SettingsPermissionPointTable({
	table,
	emptyText = "暂无权限点",
}: {
	table: ReturnType<typeof useAppTable<PermissionPoint>>;
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

/** 角色级授权记录的只读表格壳(与角色表同构但各写一份,见 §2) */
export function SettingsRolesGrantRecordTable({
	table,
	emptyText = "还没有角色级授权记录,先在行操作「配置权限」里保存一次",
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
