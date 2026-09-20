import { ArrowDown, ArrowUp, ChevronsUpDown, Eye, KeyRound, SquarePen, Trash2 } from "lucide-react";

import { TagBadges } from "#/components/modules/shared/tag-badges";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { createAppColumnHelper, type useAppTable } from "#/lib/table";
import {
	effectivePermissionCount,
	type GrantRecordRow,
	groupsOfUser,
	ownPermissionIds,
	rolesOfUser,
	type UserRow,
} from "#/mocks/settings";

/** 行类型的唯一家:从契约中枢 re-export(见 `doc/前端结构与组件约定.md` §4.1) */
export type { GrantRecordRow, UserRow };

const columnHelper = createAppColumnHelper<UserRow>;
const grantRecordHelper = createAppColumnHelper<GrantRecordRow>;

/** 行级回调:由编排壳闭包注入,表格自己不知道数据从哪来 */
export type SettingsUsersRowCallbacks = {
	onView?: (row: UserRow) => void;
	onEdit?: (row: UserRow) => void;
	onDelete?: (row: UserRow) => void;
	/** 单用户授权(原始需求:提供对单一用户进行权限管理) */
	onGrant?: (row: UserRow) => void;
};

/** 状态徽章 —— 与种子口径一致(启用 / 停用 / 锁定),只有本页用,就近定义 */
function UserStatusBadge({ value }: { value: string }) {
	const variant = value === "启用" ? "default" : value === "锁定" ? "destructive" : "secondary";
	return <Badge variant={variant}>{value}</Badge>;
}

/**
 * 用户管理的列定义(/)。
 *
 * 列写在本域自己的文件里 —— 不做"字段声明驱动通用表格"的封装(见
 * `doc/前端结构与组件约定.md` §0 第 3 条):每个业务自己调用 TanStack Table。
 * 「本人权限点数」「有效权限点数」是 的派生列(渲染期算,不落库、不进表单)。
 */
export function createSettingsUsersColumns({
	selected,
	onToggleOne,
	onToggleMany,
	callbacks,
}: {
	selected: ReadonlySet<string>;
	onToggleOne: (id: string, on: boolean) => void;
	onToggleMany: (ids: string[], on: boolean) => void;
	callbacks: SettingsUsersRowCallbacks;
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
		columnHelper().accessor("账号", { header: "账号", size: 110 }),
		columnHelper().accessor("姓名", { header: "姓名", size: 90 }),
		columnHelper().accessor("手机号", { header: "手机号", size: 130 }),
		columnHelper().accessor("所属部门", { header: "所属部门/条线", size: 130 }),
		// 多值列:一人可同属多个用户组 / 持多个角色,单元格一律用徽章列
		columnHelper().accessor("所属用户组", {
			header: "所属用户组",
			size: 230,
			cell: (info) => <TagBadges tags={groupsOfUser(info.row.original)} />,
		}),
		columnHelper().accessor("角色", {
			header: "角色",
			size: 230,
			cell: (info) => <TagBadges tags={rolesOfUser(info.row.original)} />,
		}),
		columnHelper().accessor("状态", {
			header: "状态",
			size: 90,
			cell: (info) => <UserStatusBadge value={String(info.getValue)} />,
		}),
		// 派生列:本人直接被授权的权限点数(不落库,表单与导入都改不动)
		columnHelper().display({
			id: "本人权限点数",
			header: "本人权限点数",
			size: 110,
			cell: ({ row }) => <span className="tabular-nums">{ownPermissionIds(row.original).length}</span>,
		}),
		// 派生列:有效权限 = 本人 ∪ 所属用户组 ∪ 角色(多组多角色全部并入后去重)
		columnHelper().display({
			id: "有效权限点数",
			header: "有效权限点数",
			size: 110,
			cell: ({ row }) => <span className="tabular-nums">{effectivePermissionCount(row.original)}</span>,
		}),
		columnHelper().accessor("最近登录时间", {
			header: "最近登录时间",
			size: 150,
			cell: (info) => info.getValue || PLACEHOLDER_EMPTY,
		}),
		columnHelper().display({
			id: "__actions",
			size: 150,
			header: "操作",
			cell: ({ row }) => (
				<div className="flex items-center gap-0.5">
					<Button variant="ghost" size="icon-sm" aria-label="详情" onClick={() => callbacks.onView?.(row.original)}>
						<Eye className="size-3.5" />
					</Button>
					<Button variant="ghost" size="icon-sm" aria-label="编辑" onClick={() => callbacks.onEdit?.(row.original)}>
						<SquarePen className="size-3.5" />
					</Button>
					{/*:授权入口落在行内操作里(需求原文:对单一用户进行权限管理) */}
					<Button
						variant="ghost"
						size="sm"
						aria-label="授权"
						title="授权(角色与权限点)"
						className="gap-1 px-2 text-[12px]"
						onClick={() => callbacks.onGrant?.(row.original)}
					>
						<KeyRound className="size-3.5" />
						授权
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
export function createSettingsUsersGrantRecordColumns() {
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
		grantRecordHelper().accessor("授权来源", { header: "授权来源", size: 120 }),
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
export function SettingsUsersTable({
	table,
	emptyText = "暂无用户数据",
}: {
	table: ReturnType<typeof useAppTable<UserRow>>;
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

/**
 * 用户级授权记录的只读表格壳。
 *
 * 与上面的用户表**同构但各写一份**(见 `doc/前端结构与组件约定.md` §2:表格永不跨域 / 不抽通用表格封装),
 * 列与 emptyText 的口径本来就不一样,不为了少写 40 行去造一个泛型壳。
 */
export function SettingsUsersGrantRecordTable({
	table,
	emptyText = "还没有用户级授权记录,先在行操作或批量授权里保存一次",
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
