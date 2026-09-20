import type { LucideIcon } from "lucide-react";
import { Database, Download, ListChecks, Plus, ShieldCheck, Upload } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "#/components/layout/page-header";
import { SettingsImportModeOptions } from "#/components/modules/settings/settings-import-options";
import { SettingsRolesDetailDialog } from "#/components/modules/settings/settings-roles-detail";
import { SettingsRolesFormDialog } from "#/components/modules/settings/settings-roles-form";
import {
	importRowToValues,
	type SettingsRolesSubmitValues,
} from "#/components/modules/settings/settings-roles-form-mappers";
import {
	SettingsRolesGrantDialog,
	type SettingsRolesGrantValues,
} from "#/components/modules/settings/settings-roles-grant";
import { SettingsRolesStats } from "#/components/modules/settings/settings-roles-stats";
import {
	createSettingsPermissionPointColumns,
	createSettingsRolesColumns,
	createSettingsRolesGrantRecordColumns,
	type RoleRow,
	SettingsPermissionPointTable,
	SettingsRolesGrantRecordTable,
	type SettingsRolesRowCallbacks,
	SettingsRolesTable,
} from "#/components/modules/settings/settings-roles-table";
import { ExcelImportDialog, type ImportResult, type ImportRow } from "#/components/modules/shared/excel-import";
import {
	ActiveFilterPills,
	FilterChipBar,
	type FilterChipGroup,
	type FilterChipTone,
} from "#/components/modules/shared/filter-chips";
import { exportLedger, importLedger } from "#/components/modules/shared/ledger-excel";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { useAppTable, useRowSelection } from "#/lib/table";
import {
	DATA_SCOPES,
	GRANT_RECORD_EXCEL_COLUMNS,
	grantRecordTable,
	PERMISSION_POINT_EXCEL_COLUMNS,
	permissionPointTable,
	ROLE_EXCEL_COLUMNS,
	ROLE_STATUSES,
	roleTable,
	setRolePermissions,
	userTable,
} from "#/mocks/settings";

/**
 * 系统设置 · 角色管理(:提供根据角色信息对用户进行授权管理)。
 *
 * 编排壳:本域**唯一**的数据订阅与写操作入口(见 `doc/前端结构与组件约定.md` §5.2)。
 *
 * 版式按 `DESIGN.md` §5.3「列表页布局节奏」分四段独立成行,段间距 16px:
 * ① 指标条 → ② 快速筛选 chip bar → ③ 已选筛选 pills → ④ 台账卡片(卡头 / 工具栏 / 表格 / 分页)
 *
 * 「配置权限」是 的落点:行内操作打开权限树弹窗,勾选菜单权限与操作权限,
 * 保存后 `setRolePermissions` 写回角色表(权限点数即时更新)并追加一条角色级授权记录;
 * 角色下的用户随之通过角色继承这批权限。表格下方另外给出权限点清单(权限树的扁平视图)
 * 与角色级授权记录两张只读表,供逐项验收。
 */

/** 快速筛选的组声明(单值;`match` 是纯谓词,筛选在编排壳里对行做前置过滤) */
type RolesFilterSpec = {
	key: string;
	label: string;
	Icon: LucideIcon;
	tone: FilterChipTone;
	options: readonly string[];
	match: (row: RoleRow, value: string) => boolean;
};

const ROLES_FILTER_SPECS: RolesFilterSpec[] = [
	{
		key: "状态",
		label: "角色状态",
		Icon: ShieldCheck,
		tone: "forest",
		options: ROLE_STATUSES,
		match: (row, value) => String(row.状态) === value,
	},
	{
		key: "数据范围",
		label: "数据范围",
		Icon: Database,
		tone: "ocean",
		options: DATA_SCOPES,
		match: (row, value) => String(row.数据范围) === value,
	},
];

export function SettingsRolesPage() {
	const rows = roleTable((state) => state.rows);
	const users = userTable((state) => state.rows);
	const permissionPoints = permissionPointTable((state) => state.rows);
	const grantRecords = grantRecordTable((state) => state.rows);

	// ── 页面 UI 态(只有本页用,不需要 store);选中态统一走公共 hook ──
	const { selected, selectedRows, toggleOne, toggleMany, clear } = useRowSelection(rows);
	const [form, setForm] = useState<{ row: RoleRow | null } | null>(null);
	const [detailRow, setDetailRow] = useState<RoleRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [importMode, setImportMode] = useState<"append" | "replace">("append");
	const [grantId, setGrantId] = useState<string | null>(null);
	const [activeFilters, setActiveFilters] = useState<Partial<Record<string, string>>>({});

	/** 配置权限的唯一入口(行内操作) */
	const openGrant = useCallback((id: string) => setGrantId(id), []);

	const callbacks = useMemo<SettingsRolesRowCallbacks>(
		() => ({
			onView: setDetailRow,
			onEdit: (row) => setForm({ row }),
			onDelete: (row) => setPendingDelete([row.id]),
			onGrant: (row) => openGrant(row.id),
		}),
		[openGrant],
	);

	const columns = useMemo(
		() => createSettingsRolesColumns({ selected, onToggleOne: toggleOne, onToggleMany: toggleMany, callbacks }),
		[selected, toggleOne, toggleMany, callbacks],
	);

	const filteredRows = useMemo(
		() =>
			rows.filter((row) =>
				ROLES_FILTER_SPECS.every((spec) => {
					const value = activeFilters[spec.key];
					return value === undefined || spec.match(row, value);
				}),
			),
		[rows, activeFilters],
	);

	const table = useAppTable({
		columns,
		data: filteredRows,
		globalFilterFn: "includesString",
		initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
	});

	// ── 权限点清单(只读:权限树的扁平视图)──
	const permissionColumns = useMemo(() => createSettingsPermissionPointColumns(), []);
	const permissionTable = useAppTable({
		columns: permissionColumns,
		data: permissionPoints,
		globalFilterFn: "includesString",
		initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
	});

	// ── 角色级授权记录(只读证据表)──
	const grantColumns = useMemo(() => createSettingsRolesGrantRecordColumns(), []);
	const grantRows = useMemo(() => grantRecords.filter((row) => String(row.授权对象类型) === "角色"), [grantRecords]);
	const grantTable = useAppTable({
		columns: grantColumns,
		data: grantRows,
		globalFilterFn: "includesString",
		initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
	});

	const pageRows = table.getRowModel().rows;
	const { pageIndex, pageSize } = table.state.pagination;
	const matched = table.getFilteredRowModel().rows.length;
	const permissionPagination = permissionTable.state.pagination;
	const grantPagination = grantTable.state.pagination;

	const filterGroups = useMemo<FilterChipGroup[]>(
		() =>
			ROLES_FILTER_SPECS.map((spec) => ({
				key: spec.key,
				label: spec.label,
				Icon: spec.Icon,
				tone: spec.tone,
				options: spec.options.map((value) => ({ value, count: rows.filter((row) => spec.match(row, value)).length })),
			})),
		[rows],
	);

	const activePills = useMemo(
		() =>
			ROLES_FILTER_SPECS.filter((spec) => activeFilters[spec.key]).map((spec) => ({
				key: spec.key,
				groupLabel: spec.label,
				value: activeFilters[spec.key] ?? "",
				tone: spec.tone,
			})),
		[activeFilters],
	);

	const grantRole = useMemo(() => rows.find((row) => row.id === grantId) ?? null, [rows, grantId]);

	// ── 筛选:改筛选一律回到第一页 ──
	const handleSelectFilter = useCallback(
		(groupKey: string, value: string | undefined) => {
			setActiveFilters((prev) => {
				const next = { ...prev };
				if (value) next[groupKey] = value;
				else delete next[groupKey];
				return next;
			});
			table.setPageIndex(0);
		},
		[table],
	);

	const clearAllFilters = useCallback(() => {
		setActiveFilters({});
		table.setPageIndex(0);
	}, [table]);

	// ── 写操作 ────────────────────────────────────────────────
	function confirmDelete() {
		const ids = pendingDelete ?? [];
		roleTable.getState().remove(ids);
		// 显式清掉已删行(否则这一帧工具栏还会闪一下「已选 N 条」)
		toggleMany(ids, false);
		setPendingDelete(null);
		toast.success(`已删除 ${ids.length} 个角色`);
	}

	function handleSubmit(values: SettingsRolesSubmitValues) {
		const { id, ...rest } = values;
		if (id) {
			roleTable.getState().update(id, rest);
			toast.success("角色已更新");
		} else {
			roleTable.getState().insert([rest]);
			toast.success("角色已新增");
		}
		setForm(null);
	}

	/**:按角色配置权限点与数据范围,角色下的用户随之继承(返回受影响用户数) */
	function handleGrant(values: SettingsRolesGrantValues) {
		if (!grantRole) return;
		const affected = setRolePermissions(grantRole.id, { 权限点: values.权限点, 数据范围: values.数据范围 });
		toast.success(
			`已保存「${grantRole.角色名}」的 ${values.权限点.length} 项权限(数据范围:${values.数据范围}),该角色下的 ${affected} 个用户随之获得授权`,
		);
		setGrantId(null);
	}

	// ── Excel 导入 / 导出(公共流程件,与列表共用同一套筛选结果,导出不分页)──
	function handleImport(importRows: ImportRow[]): ImportResult {
		return importLedger({ table: roleTable, rows: importRows, mapRow: importRowToValues, mode: importMode });
	}

	function handleExport() {
		exportLedger({
			columns: ROLE_EXCEL_COLUMNS,
			rows: table.getFilteredRowModel().rows.map((row) => row.original),
			fileName: "角色管理",
		});
	}

	function handlePermissionExport() {
		exportLedger({
			columns: PERMISSION_POINT_EXCEL_COLUMNS,
			rows: permissionTable.getFilteredRowModel().rows.map((row) => row.original),
			fileName: "权限点清单",
		});
	}

	function handleGrantRecordExport() {
		exportLedger({
			columns: GRANT_RECORD_EXCEL_COLUMNS,
			rows: grantTable.getFilteredRowModel().rows.map((row) => row.original),
			fileName: "角色授权记录",
		});
	}

	return (
		<div className="space-y-4">
			{/* ── 段 0:页头(requirement 徽章 + 「?」页面说明)──────────── */}
			<PageHeader
				title="角色管理"
				description=" · 统一授权管理-角色授权管理:提供根据角色信息对用户进行授权管理。行内「配置权限」用权限树(分组 + 复选框)勾选该角色的菜单权限与操作权限,保存后回写权限点数并追加授权记录,角色下的用户随之继承授权。"
				actions={<Badge variant="secondary"> 系统设置/角色管理</Badge>}
			/>

			{/* ── 段 1:业务指标 ──────────────────────────────────── */}
			<SettingsRolesStats rows={rows} />

			{/* ── 段 2:快速筛选 ──────────────────────────────────── */}
			<FilterChipBar
				groups={filterGroups}
				active={activeFilters}
				onSelect={handleSelectFilter}
				onClearAll={clearAllFilters}
				note="口径来自角色台账的状态 / 数据范围字段"
			/>

			{/* ── 段 3:已选筛选(无选中时不占位)────────────────────── */}
			<ActiveFilterPills
				items={activePills}
				onRemove={(groupKey) => handleSelectFilter(groupKey, undefined)}
				onClearAll={clearAllFilters}
			/>

			{/* ── 段 4:角色台账卡片 ─────────────────────────────── */}
			<Card className="gap-4 hover:border-border hover:shadow-none">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<ListChecks className="size-4 text-muted-foreground" />
						角色台账
					</CardTitle>
					<div className="flex flex-wrap items-center gap-1.5">
						<Badge variant="outline" className="tabular-nums">
							匹配 {matched} 条
						</Badge>
					</div>
				</CardHeader>

				<CardContent className="space-y-3">
					<LedgerToolbar
						search={table.state.globalFilter}
						onSearchChange={(value) => {
							table.setGlobalFilter(value);
							table.setPageIndex(0);
						}}
						searchPlaceholder="搜索角色名 / 角色编码 / 数据范围 / 备注…"
						selectedCount={selected.size}
						onClearSelection={clear}
						onBulkDelete={() => setPendingDelete(selectedRows.map((row) => row.id))}
						actions={
							<>
								<Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
									<Upload className="size-3.5" />
									导入
								</Button>
								<Button variant="outline" size="sm" onClick={handleExport}>
									<Download className="size-3.5" />
									导出
								</Button>
								<Button size="sm" onClick={() => setForm({ row: null })}>
									<Plus className="size-3.5" />
									新增角色
								</Button>
							</>
						}
					/>

					<SettingsRolesTable table={table} />

					{pageRows.length === 0 && rows.length > 0 ? (
						<p className="text-[13px] text-muted-foreground">当前筛选没有匹配的数据,试试清除筛选条件。</p>
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
				</CardContent>
			</Card>

			{/* ── 段 5:权限点清单(只读:权限树的扁平视图)────────────── */}
			<div className="space-y-3">
				<div className="text-[14px] font-medium text-foreground">
					权限点清单(权限树的扁平视图)
					<span className="ml-2 text-[12px] font-normal text-muted-foreground">
						菜单权限逐项对齐 nav-config 的 NAV_NODES,操作权限为各模块的查看 / 新增 / 编辑 / 删除 / 导入 / 导出 / 授权
					</span>
				</div>
				<Card className="gap-4 hover:border-border hover:shadow-none">
					<CardContent className="space-y-3">
						<LedgerToolbar
							search={permissionTable.state.globalFilter}
							onSearchChange={(value) => {
								permissionTable.setGlobalFilter(value);
								permissionTable.setPageIndex(0);
							}}
							searchPlaceholder="搜索权限编码 / 权限名称 / 所属模块…"
							actions={
								<Button variant="outline" size="sm" onClick={handlePermissionExport}>
									<Download className="size-3.5" />
									导出
								</Button>
							}
						/>

						<SettingsPermissionPointTable table={permissionTable} />
						<PaginationControl
							page={permissionPagination.pageIndex + 1}
							pageSize={permissionPagination.pageSize}
							total={permissionTable.getFilteredRowModel().rows.length}
							onPageChange={(next) => permissionTable.setPageIndex(next - 1)}
							onPageSizeChange={(next) => {
								permissionTable.setPageSize(next);
								permissionTable.setPageIndex(0);
							}}
						/>
					</CardContent>
				</Card>
			</div>

			{/* ── 段 6:角色级授权记录(只读证据表)────────────────── */}
			<div className="space-y-3">
				<div className="text-[14px] font-medium text-foreground">
					授权记录(角色级)
					<span className="ml-2 text-[12px] font-normal text-muted-foreground">
						每次「配置权限」保存后都会追加一条记录
					</span>
				</div>
				<Card className="gap-4 hover:border-border hover:shadow-none">
					<CardContent className="space-y-3">
						<LedgerToolbar
							search={grantTable.state.globalFilter}
							onSearchChange={(value) => {
								grantTable.setGlobalFilter(value);
								grantTable.setPageIndex(0);
							}}
							searchPlaceholder="搜索角色 / 授权内容…"
							actions={
								<Button variant="outline" size="sm" onClick={handleGrantRecordExport}>
									<Download className="size-3.5" />
									导出
								</Button>
							}
						/>

						<SettingsRolesGrantRecordTable table={grantTable} />
						<PaginationControl
							page={grantPagination.pageIndex + 1}
							pageSize={grantPagination.pageSize}
							total={grantTable.getFilteredRowModel().rows.length}
							onPageChange={(next) => grantTable.setPageIndex(next - 1)}
							onPageSizeChange={(next) => {
								grantTable.setPageSize(next);
								grantTable.setPageIndex(0);
							}}
						/>
					</CardContent>
				</Card>
			</div>

			<SettingsRolesFormDialog
				open={form !== null}
				onOpenChange={(next) => {
					if (!next) setForm(null);
				}}
				initial={form?.row ?? null}
				onSubmit={handleSubmit}
			/>

			<SettingsRolesDetailDialog
				open={detailRow !== null}
				onOpenChange={(next) => {
					if (!next) setDetailRow(null);
				}}
				detail={detailRow}
				users={users}
			/>

			<SettingsRolesGrantDialog
				open={grantId !== null}
				onOpenChange={(next) => {
					if (!next) setGrantId(null);
				}}
				role={grantRole}
				users={users}
				onSubmit={handleGrant}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除角色"
				description={`确认删除选中的 ${pendingDelete?.length ?? 0} 个角色?该操作仅影响本次会话的 mock 数据,持有该角色的用户不会自动回收。`}
				onConfirm={confirmDelete}
			/>

			<ExcelImportDialog
				open={importOpen}
				onOpenChange={setImportOpen}
				title="导入角色"
				description="仅支持 Excel(.xlsx/.xls)。列头与表格一致,带 * 的列为必填;权限点不通过 Excel 维护。"
				fields={ROLE_EXCEL_COLUMNS}
				isPending={false}
				fileNamePrefix="角色管理导入模板"
				onSubmit={handleImport}
				options={<SettingsImportModeOptions mode={importMode} onModeChange={setImportMode} />}
			/>
		</div>
	);
}
