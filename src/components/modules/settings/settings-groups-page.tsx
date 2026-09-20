import type { LucideIcon } from "lucide-react";
import { Building2, Download, ListChecks, Plus, ShieldCheck, Upload } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "#/components/layout/page-header";
import { SettingsGroupsDetailDialog } from "#/components/modules/settings/settings-groups-detail";
import { SettingsGroupsFormDialog } from "#/components/modules/settings/settings-groups-form";
import {
	importRowToValues,
	type SettingsGroupsSubmitValues,
} from "#/components/modules/settings/settings-groups-form-mappers";
import {
	type SettingsGroupsGrantValues,
	SettingsGroupsManageDialog,
} from "#/components/modules/settings/settings-groups-grant";
import { SettingsGroupsStats } from "#/components/modules/settings/settings-groups-stats";
import {
	createSettingsGroupsColumns,
	createSettingsGroupsGrantRecordColumns,
	type GroupRow,
	SettingsGroupsGrantRecordTable,
	type SettingsGroupsRowCallbacks,
	SettingsGroupsTable,
} from "#/components/modules/settings/settings-groups-table";
import { SettingsImportModeOptions } from "#/components/modules/settings/settings-import-options";
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
	GRANT_RECORD_EXCEL_COLUMNS,
	GROUP_EXCEL_COLUMNS,
	GROUP_LINES,
	GROUP_STATUSES,
	grantRecordTable,
	grantToGroup,
	groupTable,
	listOf,
	ROLE_NAMES,
	roleTable,
	setGroupMembers,
	userTable,
} from "#/mocks/settings";

/**
 * 系统设置 · 用户组管理(:可以添加删除用户,并且可以给整个组进行授权)。
 *
 * 编排壳:本域**唯一**的数据订阅与写操作入口(见 `doc/前端结构与组件约定.md` §5.2)。
 *
 * 版式按 `DESIGN.md` §5.3「列表页布局节奏」分四段独立成行,段间距 16px:
 * ① 指标条 → ② 快速筛选 chip bar → ③ 已选筛选 pills → ④ 台账卡片(卡头 / 工具栏 / 表格 / 分页)
 *
 * 两个业务动作都收在行内「成员/授权」弹窗的两个 tab 里(与需求原文一一对应):
 * - tab 1「管理成员」→ `setGroupMembers`,一人可同属多个组(加入只追加,不摘除原组);
 * - tab 2「组授权」→ `grantToGroup`,组内成员通过 `effectivePermissionIds` 继承。
 */

/** 快速筛选的组声明(单值;`match` 是纯谓词,筛选在编排壳里对行做前置过滤) */
type GroupsFilterSpec = {
	key: string;
	label: string;
	Icon: LucideIcon;
	tone: FilterChipTone;
	options: readonly string[];
	match: (row: GroupRow, value: string) => boolean;
};

const GROUPS_FILTER_SPECS: GroupsFilterSpec[] = [
	{
		key: "状态",
		label: "组状态",
		Icon: ShieldCheck,
		tone: "forest",
		options: GROUP_STATUSES,
		match: (row, value) => String(row.状态) === value,
	},
	{
		key: "所属条线",
		label: "所属条线",
		Icon: Building2,
		tone: "ocean",
		options: GROUP_LINES,
		match: (row, value) => String(row.所属条线) === value,
	},
	{
		// 已授权角色是多值:筛选按数组展开匹配
		key: "已授权角色",
		label: "已授权角色",
		Icon: ShieldCheck,
		tone: "lavender",
		options: ROLE_NAMES,
		match: (row, value) => listOf(row.已授权角色).includes(value),
	},
];

export function SettingsGroupsPage() {
	const rows = groupTable((state) => state.rows);
	const users = userTable((state) => state.rows);
	const roles = roleTable((state) => state.rows);
	const grantRecords = grantRecordTable((state) => state.rows);

	// ── 页面 UI 态(只有本页用,不需要 store);选中态统一走公共 hook ──
	const { selected, selectedRows, toggleOne, toggleMany, clear } = useRowSelection(rows);
	const [form, setForm] = useState<{ row: GroupRow | null } | null>(null);
	const [detailRow, setDetailRow] = useState<GroupRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [importMode, setImportMode] = useState<"append" | "replace">("append");
	const [manageId, setManageId] = useState<string | null>(null);
	const [activeFilters, setActiveFilters] = useState<Partial<Record<string, string>>>({});

	/** 成员 / 授权共用的弹窗入口(行内「成员/授权」) */
	const openManage = useCallback((id: string) => setManageId(id), []);

	const callbacks = useMemo<SettingsGroupsRowCallbacks>(
		() => ({
			onView: setDetailRow,
			onEdit: (row) => setForm({ row }),
			onDelete: (row) => setPendingDelete([row.id]),
			onManage: (row) => openManage(row.id),
		}),
		[openManage],
	);

	const columns = useMemo(
		() => createSettingsGroupsColumns({ selected, onToggleOne: toggleOne, onToggleMany: toggleMany, callbacks }),
		[selected, toggleOne, toggleMany, callbacks],
	);

	const filteredRows = useMemo(
		() =>
			rows.filter((row) =>
				GROUPS_FILTER_SPECS.every((spec) => {
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

	// ── 用户组级授权记录(只读证据表):1 条组级记录 + 每位成员 1 条「继承」记录 ──
	const grantColumns = useMemo(() => createSettingsGroupsGrantRecordColumns(), []);
	const grantRows = useMemo(
		() =>
			grantRecords.filter((row) => String(row.授权对象类型) === "用户组" || String(row.授权来源) === "继承(用户组)"),
		[grantRecords],
	);
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

	const filterGroups = useMemo<FilterChipGroup[]>(
		() =>
			GROUPS_FILTER_SPECS.map((spec) => ({
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
			GROUPS_FILTER_SPECS.filter((spec) => activeFilters[spec.key]).map((spec) => ({
				key: spec.key,
				groupLabel: spec.label,
				value: activeFilters[spec.key] ?? "",
				tone: spec.tone,
			})),
		[activeFilters],
	);

	const manageGroup = useMemo(() => rows.find((row) => row.id === manageId) ?? null, [rows, manageId]);
	const detailMembers = useMemo(() => {
		if (!detailRow) return [];
		const ids = new Set(listOf(detailRow.成员ids));
		return users.filter((user) => ids.has(user.id));
	}, [detailRow, users]);

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
		groupTable.getState().remove(ids);
		// 显式清掉已删行(否则这一帧工具栏还会闪一下「已选 N 条」)
		toggleMany(ids, false);
		setPendingDelete(null);
		toast.success(`已删除 ${ids.length} 个用户组`);
	}

	function handleSubmit(values: SettingsGroupsSubmitValues) {
		const { id, ...rest } = values;
		if (id) {
			groupTable.getState().update(id, rest);
			toast.success("用户组已更新");
		} else {
			groupTable.getState().insert([rest]);
			toast.success("用户组已新增");
		}
		setForm(null);
	}

	/** 管理成员:重设本组成员并双向同步用户的「所属用户组」(多组归属只追加/摘除本组) */
	function handleSubmitMembers(memberIds: string[]) {
		if (!manageGroup) return;
		const { added, removed } = setGroupMembers(manageGroup.id, memberIds);
		toast.success(
			`已保存「${manageGroup.组名}」成员:新增 ${added} 人 / 移除 ${removed} 人,当前 ${memberIds.length} 人`,
		);
		setManageId(null);
	}

	/** 组授权:写回组表 + 追加组级与成员「继承」记录,组内成员随角色 / 权限点继承 */
	function handleSubmitGrants(values: SettingsGroupsGrantValues) {
		if (!manageGroup) return;
		const { members } = grantToGroup(manageGroup.id, {
			角色: values.角色,
			权限点: values.权限点,
			来源: "用户组授权",
			说明: ":给整个用户组配置角色与权限点,组内成员继承",
		});
		toast.success(
			`已为「${manageGroup.组名}」授权 ${values.权限点.length} 项权限 / ${values.角色.length} 个角色,组内 ${members} 名成员已继承`,
		);
		setManageId(null);
	}

	// ── Excel 导入 / 导出(公共流程件,与列表共用同一套筛选结果,导出不分页)──
	function handleImport(importRows: ImportRow[]): ImportResult {
		return importLedger({ table: groupTable, rows: importRows, mapRow: importRowToValues, mode: importMode });
	}

	function handleExport() {
		exportLedger({
			columns: GROUP_EXCEL_COLUMNS,
			rows: table.getFilteredRowModel().rows.map((row) => row.original),
			fileName: "用户组管理",
		});
	}

	function handleGrantRecordExport() {
		exportLedger({
			columns: GRANT_RECORD_EXCEL_COLUMNS,
			rows: grantTable.getFilteredRowModel().rows.map((row) => row.original),
			fileName: "用户组授权记录",
		});
	}

	return (
		<div className="space-y-4">
			{/* ── 段 0:页头(requirement 徽章 + 「?」页面说明)──────────── */}
			<PageHeader
				title="用户组管理"
				description=" · 统一授权管理-用户组授权管理:提供对角色组进行权限管理;功能细化原文「用户组管理,可以添加删除用户,并且可以给整个组进行授权」。行内「成员/授权」弹窗里可添加删除成员,并用权限树给整个组配置角色与权限点,组内成员继承授权。"
				actions={<Badge variant="secondary"> 系统设置/用户组管理</Badge>}
			/>

			{/* ── 段 1:业务指标 ──────────────────────────────────── */}
			<SettingsGroupsStats rows={rows} />

			{/* ── 段 2:快速筛选 ──────────────────────────────────── */}
			<FilterChipBar
				groups={filterGroups}
				active={activeFilters}
				onSelect={handleSelectFilter}
				onClearAll={clearAllFilters}
				note="口径来自用户组台账的状态 / 所属条线 / 已授权角色字段(角色按多值数组展开匹配)"
			/>

			{/* ── 段 3:已选筛选(无选中时不占位)────────────────────── */}
			<ActiveFilterPills
				items={activePills}
				onRemove={(groupKey) => handleSelectFilter(groupKey, undefined)}
				onClearAll={clearAllFilters}
			/>

			{/* ── 段 4:用户组台账卡片 ───────────────────────────── */}
			<Card className="gap-4 hover:border-border hover:shadow-none">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<ListChecks className="size-4 text-muted-foreground" />
						用户组台账
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
						searchPlaceholder="搜索组名 / 所属条线 / 已授权角色…"
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
									新增用户组
								</Button>
							</>
						}
					/>

					<SettingsGroupsTable table={table} />

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

			{/* ── 段 5:用户组级授权记录(只读证据表)────────────────── */}
			<div className="space-y-3">
				<div className="text-[14px] font-medium text-foreground">
					授权记录(用户组级)
					<span className="ml-2 text-[12px] font-normal text-muted-foreground">
						组授权保存后追加 1 条组级记录 + 每个成员 1 条「继承」记录,是「组成员继承授权」的落库证据
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
							searchPlaceholder="搜索用户组 / 授权内容 / 授权来源…"
							actions={
								<Button variant="outline" size="sm" onClick={handleGrantRecordExport}>
									<Download className="size-3.5" />
									导出
								</Button>
							}
						/>

						<SettingsGroupsGrantRecordTable table={grantTable} />
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

			<SettingsGroupsFormDialog
				open={form !== null}
				onOpenChange={(next) => {
					if (!next) setForm(null);
				}}
				initial={form?.row ?? null}
				onSubmit={handleSubmit}
			/>

			<SettingsGroupsDetailDialog
				open={detailRow !== null}
				onOpenChange={(next) => {
					if (!next) setDetailRow(null);
				}}
				detail={detailRow}
				members={detailMembers}
			/>

			<SettingsGroupsManageDialog
				open={manageId !== null}
				onOpenChange={(next) => {
					if (!next) setManageId(null);
				}}
				group={manageGroup}
				users={users}
				roles={roles}
				onSubmitMembers={handleSubmitMembers}
				onSubmitGrants={handleSubmitGrants}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除用户组"
				description={`确认删除选中的 ${pendingDelete?.length ?? 0} 个用户组?该操作仅影响本次会话的 mock 数据,成员的「所属用户组」不会自动回收。`}
				onConfirm={confirmDelete}
			/>

			<ExcelImportDialog
				open={importOpen}
				onOpenChange={setImportOpen}
				title="导入用户组"
				description="仅支持 Excel(.xlsx/.xls)。列头与表格一致,带 * 的列为必填;成员与权限点不通过 Excel 维护。"
				fields={GROUP_EXCEL_COLUMNS}
				isPending={false}
				fileNamePrefix="用户组管理导入模板"
				onSubmit={handleImport}
				options={<SettingsImportModeOptions mode={importMode} onModeChange={setImportMode} />}
			/>
		</div>
	);
}
