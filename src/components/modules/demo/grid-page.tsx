import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Grid3x3, MapPin, UserRoundCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { GridForm, type GridFormPayload, type Option } from "#/components/modules/demo/grid-form";
import { type GridRow, gridColumns } from "#/components/modules/demo/grid-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { DataTable, TableLoadingShell } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useColumnPrefs } from "#/hooks/use-column-prefs";
import { usePageSize } from "#/hooks/use-page-size";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { useAppTable, useRowSelection } from "#/lib/table";

/**
 * Demo:综合网格履职 —— 行级数据权限的**演示页**。
 *
 * 三种身份看到的东西不一样(这就是这一页存在的意义):
 *  · **队员**(`self`) 只看得到 `owner_id = 自己` 的网格;
 *  · **队长**(`dept_below`) 看得到**本网格组及以下**(`group_id IN (…)`,覆盖整个街镇);
 *  · **区**(`all`)    看得到全部。
 *
 * 右上角的「切换用户」可以直接换身份看效果(`sys:user:impersonate`)。
 */
export function GridPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [keyword, setKeyword] = useState("");
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<GridRow | null>(null);
	const [viewing, setViewing] = useState<GridRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<GridRow[] | null>(null);
	const [assignOpen, setAssignOpen] = useState(false);
	const [assignTo, setAssignTo] = useState("");

	const canAdd = useHasPerm("sys:grid:add");
	const canEdit = useHasPerm("sys:grid:edit");
	const canRemove = useHasPerm("sys:grid:remove");
	const canAssign = useHasPerm("sys:grid:assign");

	const listQuery = useQuery(trpc.demoGrid.list.queryOptions());
	const usersQuery = useQuery(trpc.user.list.queryOptions());
	const deptsQuery = useQuery(trpc.department.tree.queryOptions());

	const invalidate = async () => {
		await queryClient.invalidateQueries(trpc.demoGrid.pathFilter());
	};
	const createMutation = useMutation(
		trpc.demoGrid.create.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setCreating(false);
				toast.success("已新增网格");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);
	const updateMutation = useMutation(
		trpc.demoGrid.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setEditing(null);
				toast.success("已保存");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);
	const deleteMutation = useMutation(
		trpc.demoGrid.remove.mutationOptions({
			onSuccess: async (outcome) => {
				await invalidate();
				setPendingDelete(null);
				toast.success(`已删除 ${outcome.removed} 条`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);
	const assignMutation = useMutation(
		trpc.demoGrid.assign.mutationOptions({
			onSuccess: async (outcome) => {
				await invalidate();
				setAssignOpen(false);
				toast.success(`已把 ${outcome.assigned} 条指派给负责人`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const rows = useMemo<GridRow[]>(() => listQuery.data ?? [], [listQuery.data]);
	const filtered = useMemo(() => {
		const key = keyword.trim().toLowerCase();
		if (!key) return rows;
		return rows.filter((row) =>
			`${row.name} ${row.townName ?? ""} ${row.ownerName ?? ""} ${row.duty ?? ""} ${row.remark ?? ""}`
				.toLowerCase()
				.includes(key),
		);
	}, [rows, keyword]);

	/** `owner_id` → 名字(列表里显示"负责人是谁") */
	const ownerNameOf = useCallback(
		(ownerId: string | null) =>
			ownerId ? ((usersQuery.data ?? []).find((user) => user.id === ownerId)?.name ?? ownerId) : null,
		[usersQuery.data],
	);
	const userOptions: Option[] = useMemo(
		() => (usersQuery.data ?? []).map((user) => ({ value: user.id, label: user.name || user.email })),
		[usersQuery.data],
	);
	/** 街镇下拉 = 「镇、街道」这个分组下的节点 */
	const townOptions: Option[] = useMemo(() => {
		const depts = deptsQuery.data ?? [];
		const group = depts.find((dept: { id: string; name: string }) => dept.name === "镇、街道");
		const towns = depts.filter((dept: { parentId: string | null }) => (group ? dept.parentId === group.id : false));
		return (towns.length > 0 ? towns : depts.filter((d: { name: string }) => /(镇|街道)$/.test(d.name))).map(
			(dept) => ({
				value: dept.id,
				label: dept.name,
			}),
		);
	}, [deptsQuery.data]);

	/**
	 * 「归属组织」候选 = 所选街镇的**直接子部门里,真有人挂着的那些**(演示数据里就是「××网格组」)。
	 *
	 * 这一列是**行级数据范围真正认的那个字段**,所以候选不能把整个街镇的科室都倒出来 ——
	 * 挑一个没人挂的组织,数据就等于谁都看不见(见 `doc/rbac-权限模型.md` 的「归属组织对齐」)。
	 * 一个都没人挂时(新库 / 还没挂人)退回全部子部门,否则第一条网格没得选。
	 */
	const groupOptionsOf = useCallback(
		(townId: string): Option[] => {
			const children = (deptsQuery.data ?? []).filter(
				(dept: { parentId: string | null }) => townId !== "" && dept.parentId === townId,
			);
			const staffed = new Set((usersQuery.data ?? []).flatMap((user) => user.departmentIds));
			const units = children.filter((dept: { id: string }) => staffed.has(dept.id));
			return (units.length > 0 ? units : children).map((dept: { id: string; name: string }) => ({
				value: dept.id,
				label: dept.name,
			}));
		},
		[deptsQuery.data, usersQuery.data],
	);

	/** `group_id` → 名字(详情里显示"归属组织") */
	const groupNameOf = useCallback(
		(groupId: string | null) =>
			groupId ? ((deptsQuery.data ?? []).find((dept: { id: string }) => dept.id === groupId)?.name ?? groupId) : null,
		[deptsQuery.data],
	);

	const { selected, selectedRows, toggleOne, toggleMany, clear } = useRowSelection(filtered);

	const columns = useMemo(
		() =>
			gridColumns({
				selected,
				onToggleOne: toggleOne,
				onToggleMany: toggleMany,
				ownerNameOf,
				onView: setViewing,
				onEdit: canEdit ? (row) => setEditing(row) : () => toast.error("没有编辑网格的权限"),
				onDelete: canRemove ? (row) => setPendingDelete([row]) : () => toast.error("没有删除网格的权限"),
			}),
		[selected, toggleOne, toggleMany, ownerNameOf, canEdit, canRemove],
	);

	const defaultPageSize = usePageSize();
	const table = useAppTable({
		columns,
		data: filtered,
		getRowId: (row) => row.id,
		initialState: { pagination: { pageIndex: 0, pageSize: defaultPageSize } },
	});
	const { pageIndex, pageSize } = table.state.pagination;
	const { persist: persistColumns } = useColumnPrefs("demo.grid", table);

	const assigned = rows.filter((row) => row.ownerId).length;
	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "total",
				label: "网格总数",
				value: rows.length,
				description: "你能看到的(受数据范围限制)",
				Icon: Grid3x3,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "个",
			},
			{
				key: "town",
				label: "覆盖街镇",
				value: new Set(rows.map((r) => r.townName ?? "")).size,
				description: "去重后的街镇数",
				Icon: MapPin,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
				unit: "个",
			},
			{
				key: "assigned",
				label: "已指派负责人",
				value: assigned,
				description: `未指派 ${rows.length - assigned} 个`,
				Icon: UserRoundCheck,
				tone: "bg-secondary text-foreground",
				unit: "个",
			},
		],
		[rows, assigned],
	);

	const formPayload = (payload: GridFormPayload) => {
		if (editing) updateMutation.mutate({ id: editing.id, ...payload });
		else createMutation.mutate(payload);
	};

	return (
		<PageFrame>
			<PageHeader
				title="网格履职"
				description="Demo ▸ 网格履职:数据来自《闵行区片区综合网格网格长履职情况汇总表》。这一页是**行级数据权限**的演示 —— 队员只看自己负责的、队长看整个街镇、区看全部;右上角「切换用户」可以立刻换身份看差别。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={listQuery.isFetching} onClick={() => void listQuery.refetch()} />
						{canAdd ? (
							<Button size="sm" onClick={() => setCreating(true)}>
								<Grid3x3 className="size-3.5" />
								新增网格
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
				searchPlaceholder="搜索网格名 / 街镇 / 网格长 / 职务…"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>

			<Card className="flex min-h-104 flex-1 flex-col gap-4">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<Grid3x3 className="size-4 text-muted-foreground" />
						网格清单
					</CardTitle>
					<div className="flex items-center gap-2">
						{listQuery.isFetching ? (
							<Badge variant="secondary" className="tabular-nums">
								读取中…
							</Badge>
						) : null}
						<Badge variant="outline" className="tabular-nums">
							匹配 {filtered.length} 条
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="flex min-h-0 flex-1 flex-col gap-3">
					{selected.size > 0 ? (
						<div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-border bg-brand-faint px-3 py-2">
							<span className="text-xs text-foreground">
								已选 <span className="font-semibold tabular-nums">{selected.size}</span> 条
								<span className="ml-2 text-muted-foreground">
									(
									{selectedRows
										.map((row) => row.name)
										.slice(0, 3)
										.join("、")}
									{selected.size > 3 ? " …" : ""})
								</span>
							</span>
							<div className="flex items-center gap-2">
								<ActionButton onClick={clear}>清空选择</ActionButton>
								{canAssign ? <ActionButton onClick={() => setAssignOpen(true)}>批量指派负责人</ActionButton> : null}
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
							emptyText="没有你看得到的网格 —— 要么超出你的数据范围,要么还没把网格的「负责人」指派给你"
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

			<GridForm
				open={creating || editing !== null}
				onOpenChange={(next) => {
					if (!next) {
						setCreating(false);
						setEditing(null);
					}
				}}
				pending={createMutation.isPending || updateMutation.isPending}
				editing={editing}
				townOptions={townOptions}
				groupOptionsOf={groupOptionsOf}
				userOptions={userOptions}
				onSubmit={formPayload}
			/>

			{/* 批量指派负责人 —— 测试「队员只看自己负责的」时最省事的入口。
			    ⚠️ 这里用独立 Dialog 而不是 ConfirmDialog:`ConfirmDialog` **不接受 children**(实测类型上就没有),
			    把下拉塞进去它会**渲染不出来**。 */}
			<Dialog open={assignOpen} onOpenChange={setAssignOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>批量指派负责人</DialogTitle>
						<DialogDescription>
							把选中的 {selected.size} 条网格的负责人改成下面这个人 —— **队员的可见范围就是「负责人 = 自己」**。
						</DialogDescription>
					</DialogHeader>
					<Select
						items={userOptions}
						value={assignTo || null}
						onValueChange={(next) => setAssignTo(next ? String(next) : "")}
					>
						<SelectTrigger size="sm" className="w-full">
							<SelectValue placeholder="选一个负责人" />
						</SelectTrigger>
						<SelectContent>
							{userOptions.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<DialogFooter>
						<Button variant="outline" onClick={() => setAssignOpen(false)} disabled={assignMutation.isPending}>
							取消
						</Button>
						<Button
							onClick={() => assignMutation.mutate({ ids: [...selected].map(String), ownerId: assignTo || null })}
							disabled={assignMutation.isPending}
						>
							<CheckCheck className="size-3.5" />
							{assignMutation.isPending ? "指派中…" : "指派"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除网格"
				description={
					pendingDelete && pendingDelete.length > 1
						? `确认删除选中的 ${pendingDelete.length} 个网格?`
						: `确认删除「${pendingDelete?.[0]?.name ?? ""}」?`
				}
				onConfirm={() => pendingDelete && deleteMutation.mutate({ ids: pendingDelete.map((row) => row.id) })}
			/>

			<DetailDialog
				open={viewing !== null}
				onOpenChange={(next) => {
					if (!next) setViewing(null);
				}}
				title={viewing?.name ?? "网格详情"}
				description={viewing?.townName ?? undefined}
				meta={{ updatedAt: viewing?.updateTime ?? null, createdAt: viewing?.createTime ?? null }}
			>
				{viewing ? (
					<>
						<DetailRow label="所属街镇">{viewing.townName ?? "—"}</DetailRow>
						<DetailRow label="归属组织">{groupNameOf(viewing.groupId) ?? "—"}</DetailRow>
						<DetailRow label="网格名称(片区)">{viewing.name}</DetailRow>
						<DetailRow label="网格长(Excel)">{viewing.ownerName ?? "—"}</DetailRow>
						<DetailRow label="负责人(系统账号)">{ownerNameOf(viewing.ownerId) ?? "未指派"}</DetailRow>
						<DetailRow label="工作职务">{viewing.duty ?? "—"}</DetailRow>
						<DetailRow label="备注">{viewing.remark ?? "—"}</DetailRow>
					</>
				) : null}
			</DetailDialog>
		</PageFrame>
	);
}
