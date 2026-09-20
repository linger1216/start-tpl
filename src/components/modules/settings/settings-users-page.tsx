import type { LucideIcon } from "lucide-react";
import { Building2, Download, ListChecks, Plus, ShieldCheck, Upload, UserCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "#/components/layout/page-header";
import { SettingsImportModeOptions } from "#/components/modules/settings/settings-import-options";
import { SettingsUsersDetailDialog } from "#/components/modules/settings/settings-users-detail";
import { SettingsUsersFormDialog } from "#/components/modules/settings/settings-users-form";
import {
	importRowToValues,
	type SettingsUsersSubmitValues,
} from "#/components/modules/settings/settings-users-form-mappers";
import {
	SettingsUsersBatchGrantPanel,
	SettingsUsersGrantDialog,
	type SettingsUsersGrantValues,
} from "#/components/modules/settings/settings-users-grant";
import { SettingsUsersStats } from "#/components/modules/settings/settings-users-stats";
import {
	createSettingsUsersColumns,
	createSettingsUsersGrantRecordColumns,
	SettingsUsersGrantRecordTable,
	type SettingsUsersRowCallbacks,
	SettingsUsersTable,
	type UserRow,
} from "#/components/modules/settings/settings-users-table";
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
	DEPARTMENTS,
	GRANT_RECORD_EXCEL_COLUMNS,
	grantRecordTable,
	grantToUsers,
	ROLE_NAMES,
	rolesOfUser,
	roleTable,
	USER_EXCEL_COLUMNS,
	USER_STATUSES,
	userTable,
} from "#/mocks/settings";

/**
 * 系统设置 · 用户管理(单用户授权 / 批量授权)。
 *
 * 编排壳:本域**唯一**的数据订阅与写操作入口(见 `doc/前端结构与组件约定.md` §5.2)。
 * 表格、表单、详情、指标卡、授权弹窗都只收数据 + 回调,自己不知道数据从哪来。
 *
 * 版式按 `DESIGN.md` §5.3「列表页布局节奏」分四段独立成行,段间距 16px:
 * ① 指标条 → ② 快速筛选 chip bar → ③ 已选筛选 pills → ④ 台账卡片(卡头 / 工具栏 / 表格 / 分页)
 *
 * 选中行时的「已选 N 条 · 取消选择 · 批量删除」**并入工具栏同一行**(替换右侧操作组),
 * 行高固定 32px —— 选中前后表格位置不变,避免用户勾选时画面跳动。
 *
 * 原始需求:
 * - 统一授权管理-用户授权管理:提供对单一用户进行权限管理 —— 落在行内操作「授权」;
 * - 统一授权管理-批量授权管理:提供批量设置用户权限 —— 落在表格下方的「批量授权」工作台,
 * 与行内「授权」共用同一个弹窗与同一条写回(`grantToUsers`)。
 */

/** 快速筛选的组声明(单值;`match` 是纯谓词,筛选在编排壳里对行做前置过滤) */
type UsersFilterSpec = {
	key: string;
	label: string;
	Icon: LucideIcon;
	tone: FilterChipTone;
	options: readonly string[];
	match: (row: UserRow, value: string) => boolean;
};

const USERS_FILTER_SPECS: UsersFilterSpec[] = [
	{
		key: "状态",
		label: "账号状态",
		Icon: UserCheck,
		tone: "forest",
		options: USER_STATUSES,
		match: (row, value) => String(row.状态) === value,
	},
	{
		key: "所属部门",
		label: "所属部门/条线",
		Icon: Building2,
		tone: "ocean",
		options: DEPARTMENTS,
		match: (row, value) => String(row.所属部门) === value,
	},
	{
		// 多角色:筛选按角色数组展开匹配,持多个角色的用户在每个角色下都命中
		key: "角色",
		label: "角色",
		Icon: ShieldCheck,
		tone: "lavender",
		options: ROLE_NAMES,
		match: (row, value) => rolesOfUser(row).includes(value),
	},
];

export function SettingsUsersPage() {
	const rows = userTable((state) => state.rows);
	const roles = roleTable((state) => state.rows);
	const grantRecords = grantRecordTable((state) => state.rows);

	// ── 页面 UI 态(只有本页用,不需要 store);选中态统一走公共 hook ──
	const { selected, selectedRows, toggleOne, toggleMany, clear } = useRowSelection(rows);
	const [form, setForm] = useState<{ row: UserRow | null } | null>(null);
	const [detailRow, setDetailRow] = useState<UserRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [importMode, setImportMode] = useState<"append" | "replace">("append");
	const [grantIds, setGrantIds] = useState<string[]>([]);
	const [grantOpen, setGrantOpen] = useState(false);
	/** 每个筛选组当前选中的值(UI 的单一事实来源,筛选在前置过滤里生效) */
	const [activeFilters, setActiveFilters] = useState<Partial<Record<string, string>>>({});

	/** / 共用的授权入口:行内「授权」与批量授权工作台都走这里 */
	const openGrant = useCallback((ids: string[]) => {
		setGrantIds(ids);
		setGrantOpen(true);
	}, []);

	// 行级回调:useState 的 setter 是稳定引用,所以这份回调与列定义都可以长期缓存
	const callbacks = useMemo<SettingsUsersRowCallbacks>(
		() => ({
			onView: setDetailRow,
			onEdit: (row) => setForm({ row }),
			onDelete: (row) => setPendingDelete([row.id]),
			// 单用户授权:行内「授权」直接打开与批量授权共用的弹窗
			onGrant: (row) => openGrant([row.id]),
		}),
		[openGrant],
	);

	const columns = useMemo(
		() => createSettingsUsersColumns({ selected, onToggleOne: toggleOne, onToggleMany: toggleMany, callbacks }),
		[selected, toggleOne, toggleMany, callbacks],
	);

	const filteredRows = useMemo(
		() =>
			rows.filter((row) =>
				USERS_FILTER_SPECS.every((spec) => {
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

	// ── 用户级授权记录(只读证据表): / / 组继承的用户侧记录都在这 ──
	const grantColumns = useMemo(() => createSettingsUsersGrantRecordColumns(), []);
	const grantRows = useMemo(() => grantRecords.filter((row) => String(row.授权对象类型) === "用户"), [grantRecords]);
	const grantTable = useAppTable({
		columns: grantColumns,
		data: grantRows,
		globalFilterFn: "includesString",
		initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
	});

	const pageRows = table.getRowModel().rows;
	const { pageIndex, pageSize } = table.state.pagination;
	const matched = table.getFilteredRowModel().rows.length;
	const grantPagination = grantTable.state.pagination;

	/** 筛选条的组声明(带真实命中条数) */
	const filterGroups = useMemo<FilterChipGroup[]>(
		() =>
			USERS_FILTER_SPECS.map((spec) => ({
				key: spec.key,
				label: spec.label,
				Icon: spec.Icon,
				tone: spec.tone,
				options: spec.options.map((value) => ({ value, count: rows.filter((row) => spec.match(row, value)).length })),
			})),
		[rows],
	);

	/** 已选筛选 pills(顺序跟随组声明) */
	const activePills = useMemo(
		() =>
			USERS_FILTER_SPECS.filter((spec) => activeFilters[spec.key]).map((spec) => ({
				key: spec.key,
				groupLabel: spec.label,
				value: activeFilters[spec.key] ?? "",
				tone: spec.tone,
			})),
		[activeFilters],
	);

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
		userTable.getState().remove(ids);
		// 显式清掉已删行(否则这一帧工具栏还会闪一下「已选 N 条」)
		toggleMany(ids, false);
		setPendingDelete(null);
		toast.success(`已删除 ${ids.length} 个用户`);
	}

	function handleSubmit(values: SettingsUsersSubmitValues) {
		const { id, ...rest } = values;
		if (id) {
			userTable.getState().update(id, rest);
			toast.success("用户已更新");
		} else {
			userTable.getState().insert([rest]);
			toast.success("用户已新增");
		}
		setForm(null);
	}

	/** /:授权结果的唯一写入口(单用户与批量共用) */
	function handleGrant(values: SettingsUsersGrantValues) {
		const affected = grantToUsers(grantIds, values);
		toast.success(`已为 ${affected} 个用户保存授权:${values.角色.length} 个角色 / ${values.权限点.length} 个权限点`);
		setGrantOpen(false);
	}

	// ── Excel 导入 / 导出(公共流程件,与列表共用同一套筛选结果,导出不分页)──
	function handleImport(importRows: ImportRow[]): ImportResult {
		return importLedger({ table: userTable, rows: importRows, mapRow: importRowToValues, mode: importMode });
	}

	function handleExport() {
		exportLedger({
			columns: USER_EXCEL_COLUMNS,
			rows: table.getFilteredRowModel().rows.map((row) => row.original),
			fileName: "用户管理",
		});
	}

	function handleGrantRecordExport() {
		exportLedger({
			columns: GRANT_RECORD_EXCEL_COLUMNS,
			rows: grantTable.getFilteredRowModel().rows.map((row) => row.original),
			fileName: "用户授权记录",
		});
	}

	const grantTargets = useMemo(() => rows.filter((row) => grantIds.includes(row.id)), [rows, grantIds]);

	return (
		<div className="space-y-4">
			{/* ── 段 0:页头(requirement 徽章 + 「?」页面说明)──────────── */}
			<PageHeader
				title="用户管理"
				description=" · 统一授权管理-用户授权管理:提供对单一用户进行权限管理。 · 统一授权管理-批量授权管理:提供批量设置用户权限。行内「授权」弹窗内勾选角色与权限点并写回用户表,表格下方的「批量授权」工作台支持多选用户后一次性授权。"
				actions={<Badge variant="secondary"> 系统设置/用户管理(+ 批量授权)</Badge>}
			/>

			{/* ── 段 1:业务指标 ──────────────────────────────────── */}
			<SettingsUsersStats rows={rows} />

			{/* ── 段 2:快速筛选 ──────────────────────────────────── */}
			<FilterChipBar
				groups={filterGroups}
				active={activeFilters}
				onSelect={handleSelectFilter}
				onClearAll={clearAllFilters}
				note="口径来自用户台账的状态 / 所属部门 / 角色字段(角色按多值数组展开匹配)"
			/>

			{/* ── 段 3:已选筛选(无选中时不占位)────────────────────── */}
			<ActiveFilterPills
				items={activePills}
				onRemove={(groupKey) => handleSelectFilter(groupKey, undefined)}
				onClearAll={clearAllFilters}
			/>

			{/* ── 段 4:用户台账卡片 ─────────────────────────────── */}
			<Card className="gap-4 hover:border-border hover:shadow-none">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<ListChecks className="size-4 text-muted-foreground" />
						用户台账
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
						searchPlaceholder="搜索账号 / 姓名 / 手机号 / 部门 / 用户组 / 角色…"
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
									新增用户
								</Button>
							</>
						}
					/>

					<SettingsUsersTable table={table} />

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

			{/* ── 段 5: 批量授权工作台 ───────────────────────── */}
			<SettingsUsersBatchGrantPanel users={rows} onGrant={openGrant} />

			{/* ── 段 6:用户级授权记录(只读证据表)────────────────── */}
			<div className="space-y-3">
				<div className="text-[14px] font-medium text-foreground">
					授权记录(用户级)
					<span className="ml-2 text-[12px] font-normal text-muted-foreground">
						单用户授权 / 批量授权 / 用户组继承都会在这里留下记录
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
							searchPlaceholder="搜索授权对象 / 授权内容 / 授权来源…"
							actions={
								<Button variant="outline" size="sm" onClick={handleGrantRecordExport}>
									<Download className="size-3.5" />
									导出
								</Button>
							}
						/>

						<SettingsUsersGrantRecordTable table={grantTable} />
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

			<SettingsUsersFormDialog
				open={form !== null}
				onOpenChange={(next) => {
					if (!next) setForm(null);
				}}
				initial={form?.row ?? null}
				onSubmit={handleSubmit}
			/>

			<SettingsUsersDetailDialog
				open={detailRow !== null}
				onOpenChange={(next) => {
					if (!next) setDetailRow(null);
				}}
				detail={detailRow}
			/>

			<SettingsUsersGrantDialog
				open={grantOpen}
				onOpenChange={setGrantOpen}
				targets={grantTargets}
				roles={roles}
				onSubmit={handleGrant}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除用户"
				description={`确认删除选中的 ${pendingDelete?.length ?? 0} 个用户?该操作仅影响本次会话的 mock 数据,组织与授权记录不会被回滚。`}
				onConfirm={confirmDelete}
			/>

			<ExcelImportDialog
				open={importOpen}
				onOpenChange={setImportOpen}
				title="导入用户"
				description="仅支持 Excel(.xlsx/.xls)。列头与表格一致,带 * 的列为必填。"
				fields={USER_EXCEL_COLUMNS}
				isPending={false}
				fileNamePrefix="用户管理导入模板"
				onSubmit={handleImport}
				options={<SettingsImportModeOptions mode={importMode} onModeChange={setImportMode} />}
			/>
		</div>
	);
}
