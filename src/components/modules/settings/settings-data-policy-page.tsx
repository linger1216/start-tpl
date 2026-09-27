import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Eye, ListChecks, Plus, ShieldCheck, ShieldX, UserRoundCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import {
	type PolicyBatchPayload,
	SettingsDataPolicyBatch,
} from "#/components/modules/settings/settings-data-policy-batch";
import { SettingsDataPolicyDetail } from "#/components/modules/settings/settings-data-policy-detail";
import { SettingsDataPolicyExplain } from "#/components/modules/settings/settings-data-policy-explain";
import {
	type PolicyCreatePayload,
	type PolicyUpdatePayload,
	SettingsDataPolicyForm,
} from "#/components/modules/settings/settings-data-policy-form";
import { policyColumns } from "#/components/modules/settings/settings-data-policy-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { DataTable, TableLoadingShell } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useColumnPrefs } from "#/hooks/use-column-prefs";
import { usePageSize } from "#/hooks/use-page-size";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import type { PolicyRowView } from "#/lib/data-policy-spec";
import { useAppTable, useRowSelection } from "#/lib/table";

/**
 * 系统设置 ▸ 数据权限 —— 行级数据权限的**管理页**。
 *
 * 这一页管的是 `sys_data_policy`(直白授权规则):谁 / 看什么 / 能做什么 / 允许还是拒绝。
 * 三条必须写在界面上、也要写在人脑子里的口径:
 *  1. **空表 = 未启用**:一条启用中的规则都没有时,所有列表都不加范围条件(与「菜单表为空 =
 *     菜单未启用」同口径)。所以这页不是"必须配"的页面,而是"要用行级权限时才配"的页面;
 *  2. **写规则 = 真的改权限**:网格履职页的「指派负责人」也会悄悄写这里(队员按行授权),
 *     所以这里能看到全部规则,也可以手工补一条「借调」;
 *  3. **拒绝是减法**:`deny` 把选中的范围从可见集合里减掉,优先级高于同样的 `allow`。
 *
 * 两个"批量"入口分工清楚:
 *  - 「新增规则」一次给**一个主体配多类资源**(每类各自的资源 / 范围 / 动作 / 效果 = 一批规则);
 *  - 勾选多行后的「批量修改」一次改掉这一批的**标量**字段(动作 / 效果 / 启用)。
 * 「谁能看到什么」是**只读排障器**(选个人摊开整条判定链)—— 与其它台账页同形(增删改查 + 详情弹窗)。
 */
export function SettingsDataPolicyPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [keyword, setKeyword] = useState("");
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<PolicyRowView | null>(null);
	const [viewing, setViewing] = useState<PolicyRowView | null>(null);
	/** 单条删除也是数组(批量条与单个删除共用同一个对话框) */
	const [pendingDelete, setPendingDelete] = useState<PolicyRowView[] | null>(null);
	const [explainOpen, setExplainOpen] = useState(false);
	const [explainUserId, setExplainUserId] = useState<string | null>(null);
	/** 批量修改(动作 / 效果 / 启用)弹窗 */
	const [batching, setBatching] = useState(false);

	const canAdd = useHasPerm("sys:policy:add");
	const canEdit = useHasPerm("sys:policy:edit");
	const canRemove = useHasPerm("sys:policy:remove");

	const formOpen = editing !== null || creating;

	const listQuery = useQuery({ ...trpc.policy.list.queryOptions(), placeholderData: keepPreviousData });
	const rows = (listQuery.data ?? []) as PolicyRowView[];

	const createMutation = useMutation(
		trpc.policy.create.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.policy.pathFilter());
				setCreating(false);
				toast.success("已新增数据权限规则", {
					description:
						outcome.existed > 0
							? `新增 ${outcome.created} 条;${outcome.existed} 条已存在,保持原样。`
							: `新增 ${outcome.created} 条,立即生效。`,
				});
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const updateMutation = useMutation(
		trpc.policy.update.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.policy.pathFilter());
				setEditing(null);
				toast.success(outcome.moved ? "规则已搬到新的键上,立即生效" : "已保存规则");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const removeMutation = useMutation(
		trpc.policy.remove.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.policy.pathFilter());
				setPendingDelete(null);
				clear();
				toast.success(`已删除 ${outcome.removed} 条规则`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	/** 批量改标量:撞键的那几行会被服务端跳过并回报名单 —— 这里如实转述,不假装全成功 */
	const updateManyMutation = useMutation(
		trpc.policy.updateMany.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.policy.pathFilter());
				setBatching(false);
				clear();
				const notes: string[] = [];
				if (outcome.conflicts.length > 0) {
					notes.push(`${outcome.conflicts.length} 条因目标键已存在(同一个主体 + 资源 + 动作)没改`);
				}
				if (outcome.skipped > 0) notes.push(`${outcome.skipped} 条在库里已不存在`);
				toast.success(`已修改 ${outcome.updated} 条规则`, { description: notes.join(";") || undefined });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const { selected, selectedRows, toggleOne, toggleMany, clear } = useRowSelection(rows);

	function handleCreate(payload: PolicyCreatePayload) {
		createMutation.mutate({
			subKind: payload.subKind,
			subjectIds: payload.subjectIds,
			resources: payload.resources,
			remark: payload.remark ?? null,
		});
	}

	function handleUpdate(payload: PolicyUpdatePayload) {
		if (!editing) return;
		// 编辑:三要素(谁 / 看什么 / 动作)可以改,服务端撞了唯一键会回冲突
		updateMutation.mutate({
			id: editing.id,
			subKind: payload.subKind,
			subjectIds: payload.subjectIds,
			resourceType: payload.resourceType,
			scopeKind: payload.scopeKind,
			scopeIds: payload.scopeIds,
			action: payload.action,
			effect: payload.effect,
			status: payload.status,
			remark: payload.remark ?? null,
		});
	}

	function handleBatch(payload: PolicyBatchPayload) {
		updateManyMutation.mutate({ ids: selectedRows.map((row) => row.id), ...payload });
	}

	const filtered = useMemo(() => {
		const key = keyword.trim();
		if (!key) return rows;
		return rows.filter((row) =>
			`${row.subjectLabel} ${row.subjectRaw} ${row.resourceTypeLabel} ${row.resourceDetail} ${row.resourceRaw} ${row.remark}`.includes(
				key,
			),
		);
	}, [rows, keyword]);

	const columns = useMemo(
		() =>
			policyColumns({
				selected,
				onToggleOne: toggleOne,
				onToggleMany: toggleMany,
				onView: setViewing,
				onEdit: (row) => {
					setCreating(false);
					setEditing(row);
				},
				onDelete: (row) => setPendingDelete([row]),
				onExplain: (row) => {
					setExplainUserId(row.subjectKind === "user" ? row.subjectId : null);
					setExplainOpen(true);
				},
			}),
		[selected, toggleOne, toggleMany],
	);

	const defaultPageSize = usePageSize();
	const table = useAppTable({
		columns,
		data: filtered,
		getRowId: (row) => row.id,
		initialState: { pagination: { pageIndex: 0, pageSize: defaultPageSize } },
	});
	const { pageIndex, pageSize } = table.state.pagination;
	const { persist: persistColumns } = useColumnPrefs("settings.data-policy", table);

	const stats: StatItem[] = useMemo(() => {
		const enabled = rows.filter((row) => row.status === 1);
		return [
			{
				key: "total",
				label: "规则总数",
				value: rows.length,
				description: `启用中 ${enabled.length} 条(停用的不参与判定)`,
				Icon: ListChecks,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "条",
			},
			{
				key: "user",
				label: "按人授权",
				value: rows.filter((row) => row.subjectKind === "user").length,
				description: "借调 · 队员看自己的行 —— 都写在这里",
				Icon: UserRoundCheck,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
				unit: "条",
			},
			{
				key: "org",
				label: "按组织授权",
				value: rows.filter((row) => row.resourceKind === "org").length,
				description: "该组织及其子树里的数据都看得到",
				Icon: Building2,
				tone: "bg-hue-amber-soft text-hue-amber-fg",
				unit: "条",
			},
			{
				key: "deny",
				label: "拒绝规则",
				value: rows.filter((row) => row.effect === "deny").length,
				description: "从可见集合里做减法,优先级高于允许",
				Icon: ShieldX,
				tone: "bg-hue-rose-soft text-hue-rose-fg",
				unit: "条",
			},
		];
	}, [rows]);

	return (
		<PageFrame>
			<PageHeader
				title="数据权限"
				description="系统设置 ▸ 数据权限:行级数据权限的直白授权规则。谁(用户 / 角色 / 部门 / 所有人)× 看什么(整类资源 / 该组织及以下 / 具体某行)× 动作,允许或拒绝。表里一条启用规则都没有时 = 数据权限未启用,列表不过滤。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={listQuery.isFetching} onClick={() => void listQuery.refetch()} />
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								setExplainUserId(null);
								setExplainOpen(true);
							}}
						>
							<Eye className="size-3.5" />
							谁能看到什么
						</Button>
						{canAdd ? (
							<Button
								size="sm"
								onClick={() => {
									setEditing(null);
									setCreating(true);
								}}
							>
								<Plus className="size-3.5" />
								新增规则
							</Button>
						) : null}
					</div>
				}
			/>

			<StatCards items={stats} />

			<LedgerToolbar
				search={keyword}
				onSearchChange={(value) => {
					setKeyword(value);
					table.setPageIndex(0);
				}}
				searchPlaceholder="搜索主体 / 资源 / 说明(原始串也能搜,如 user: 或 @org:)…"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>

			<Card className="flex min-h-104 flex-1 flex-col gap-4">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<ShieldCheck className="size-4 text-muted-foreground" />
						规则清单
					</CardTitle>
					<Badge variant="outline" className="tabular-nums">
						匹配 {filtered.length} 条
					</Badge>
				</CardHeader>
				<CardContent className="flex min-h-0 flex-1 flex-col gap-3">
					{selected.size > 0 ? (
						<div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-border bg-brand-faint px-3 py-2">
							<span className="text-xs text-foreground">
								已选 <span className="font-semibold tabular-nums">{selected.size}</span> 条
								<span className="ml-2 text-muted-foreground">
									(
									{selectedRows
										.map((row) => row.subjectLabel)
										.slice(0, 3)
										.join("、")}
									{selected.size > 3 ? " …" : ""})
								</span>
							</span>
							<div className="flex items-center gap-2">
								<ActionButton onClick={clear}>清空选择</ActionButton>
								{canEdit ? <ActionButton onClick={() => setBatching(true)}>批量修改</ActionButton> : null}
								{canRemove ? (
									<ActionButton tone="danger" onClick={() => setPendingDelete(selectedRows)}>
										批量删除
									</ActionButton>
								) : null}
							</div>
						</div>
					) : null}

					<TableLoadingShell fill busy={listQuery.isFetching} minHeight={240}>
						<DataTable
							table={table}
							emptyText="还没有任何数据权限规则 —— 此时所有列表都不做范围过滤(空表 = 未启用)"
							rowClassName={(row) => (selected.has(row.id) ? "bg-brand-faint" : undefined)}
						/>
					</TableLoadingShell>
					<div className="shrink-0 border-t border-border pt-1">
						<PaginationControl
							page={pageIndex + 1}
							pageSize={pageSize}
							total={table.getFilteredRowModel().rows.length}
							onPageChange={(next) => table.setPageIndex(next - 1)}
							onPageSizeChange={(next) => table.setPageSize(next)}
						/>
					</div>
				</CardContent>
			</Card>

			<SettingsDataPolicyForm
				row={editing}
				creating={creating}
				open={formOpen}
				pending={createMutation.isPending || updateMutation.isPending}
				onOpenChange={(next) => {
					if (!next) {
						setEditing(null);
						setCreating(false);
					}
				}}
				onCreate={handleCreate}
				onUpdate={handleUpdate}
			/>

			<SettingsDataPolicyBatch
				count={selected.size}
				open={batching}
				onOpenChange={setBatching}
				pending={updateManyMutation.isPending}
				onSubmit={handleBatch}
			/>

			<SettingsDataPolicyDetail
				row={viewing}
				open={viewing !== null}
				onOpenChange={(next) => {
					if (!next) setViewing(null);
				}}
				onEdit={(row) => {
					if (!canEdit) return;
					setViewing(null);
					setCreating(false);
					setEditing(row);
				}}
			/>

			<SettingsDataPolicyExplain open={explainOpen} onOpenChange={setExplainOpen} initialUserId={explainUserId} />

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title={pendingDelete && pendingDelete.length > 1 ? "批量删除规则" : "删除规则"}
				description={
					pendingDelete && pendingDelete.length > 1
						? `确认删除选中的 ${pendingDelete.length} 条规则?删掉之后这些人/角色/部门会立刻失去对应的数据范围(判定即时生效,没有缓存)。`
						: `确认删除「${pendingDelete?.[0]?.subjectLabel} 看 ${pendingDelete?.[0]?.resourceTypeLabel}${
								pendingDelete?.[0]?.resourceDetail ? ` ▸ ${pendingDelete[0].resourceDetail}` : ""
							}」这条规则?判定即时生效。`
				}
				onConfirm={() => pendingDelete && removeMutation.mutate({ ids: pendingDelete.map((row) => row.id) })}
			/>
		</PageFrame>
	);
}
