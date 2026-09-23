import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { MenuRow } from "#/components/layout/nav-menu";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { type RoleFormPayload, SettingsRolesForm } from "#/components/modules/settings/settings-roles-form";
import { SettingsRolesPermsDialog } from "#/components/modules/settings/settings-roles-perms";
import { type RoleRow, roleColumns } from "#/components/modules/settings/settings-roles-table";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import type { PermissionNode } from "#/components/modules/shared/permission-tree";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { DataTable, TableLoadingShell } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { MENU_TYPE } from "#/lib/menu-spec";
import { useAppTable } from "#/lib/table";

/**
 * 菜单行 → 权限树:菜单是枝、**按钮**(`type = 3`)是叶,后者带「操作」徽章。
 * 给角色勾按钮 = 那个按钮的 `perm` 进入他的权限集合(前端 `useHasPerm` 认它)。
 */
function buildPermTree(rows: readonly MenuRow[]): PermissionNode[] {
	const byParent = new Map<string, MenuRow[]>();
	for (const row of rows) {
		const key = row.parentId ?? "";
		byParent.set(key, [...(byParent.get(key) ?? []), row]);
	}
	for (const list of byParent.values()) {
		list.sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name, "zh-Hans-CN"));
	}
	const build = (parentKey: string): PermissionNode[] =>
		(byParent.get(parentKey) ?? []).map((row) => {
			const children = build(row.id);
			const node: PermissionNode = { id: row.id, name: row.name };
			if (Number(row.type) === MENU_TYPE.BUTTON) node.kind = "操作";
			if (children.length > 0) node.children = children;
			return node;
		});
	return build("");
}

/**
 * 系统设置 ▸ 角色管理 —— **台账布局**(与参数管理同一套):
 * 页头(刷新 / 新增角色)→ 统计卡 → 清单(搜索 + 表格 + **分页**)→ 表单 / 权限对话框。
 *
 * 角色的定位(见 `db/data-base-schema.ts`):**全局定义**,不随部门复制。
 * 「张三在上海是管理员」记在 `sys_department_member` 上,不是在这里多建一个"上海管理员"角色。
 */
export function SettingsRolesPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const rolesQuery = useQuery(trpc.role.list.queryOptions());
	const menusQuery = useQuery(trpc.menu.list.queryOptions());
	const roles = useMemo(() => (rolesQuery.data ?? []) as RoleRow[], [rolesQuery.data]);
	const permTree = useMemo(() => buildPermTree(menusQuery.data ?? []), [menusQuery.data]);

	/** 按钮级可见性:权限体系未启用时 `useHasPerm` 恒为 true */
	const canAdd = useHasPerm("sys:role:add");
	const canRemove = useHasPerm("sys:role:remove");

	const [keyword, setKeyword] = useState("");
	const [editing, setEditing] = useState<RoleRow | null>(null);
	const [creating, setCreating] = useState(false);
	const [permsFor, setPermsFor] = useState<RoleRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<RoleRow | null>(null);

	const filtered = useMemo(() => {
		const key = keyword.trim().toLowerCase();
		if (!key) return roles;
		return roles.filter((row) => `${row.name} ${row.code}`.toLowerCase().includes(key));
	}, [roles, keyword]);

	const columns = useMemo(
		() =>
			roleColumns({
				onPerms: setPermsFor,
				onEdit: (row) => {
					setCreating(false);
					setEditing(row);
				},
				// 没有「删除角色」权限就干脆不渲染那个按钮(隐藏 = 不可见)
				onDelete: canRemove ? setPendingDelete : undefined,
			}),
		[canRemove],
	);

	const table = useAppTable({
		columns,
		data: filtered,
		initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
	});
	const { pageIndex, pageSize } = table.state.pagination;

	const stats: StatItem[] = useMemo(() => {
		const assigned = roles.reduce((sum, row) => sum + row.memberCount, 0);
		return [
			{
				key: "total",
				label: "角色总数",
				value: roles.length,
				description: "全局定义,不随部门复制",
				Icon: KeyRound,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "个",
			},
			{
				key: "assigned",
				label: "成员分配",
				value: assigned,
				description: "各部门里挂在这个角色上的人次数",
				Icon: Users,
				tone: "bg-hue-violet-soft text-hue-violet-fg",
				unit: "次",
			},
			{
				key: "off",
				label: "已停用",
				value: roles.filter((row) => row.status === 0).length,
				description: "停用的角色不参与权限计算",
				Icon: KeyRound,
				tone: "bg-hue-amber-soft text-hue-amber-fg",
				unit: "个",
			},
		];
	}, [roles]);

	function invalidate() {
		return queryClient.invalidateQueries(trpc.role.pathFilter());
	}

	const createMutation = useMutation(
		trpc.role.create.mutationOptions({
			onSuccess: async (row) => {
				await invalidate();
				setCreating(false);
				toast.success(`已新增角色「${row.name}」`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const updateMutation = useMutation(
		trpc.role.update.mutationOptions({
			onSuccess: async (row) => {
				await invalidate();
				setEditing(null);
				toast.success(`已保存「${row.name}」`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const deleteMutation = useMutation(
		trpc.role.remove.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setPendingDelete(null);
				toast.success("已删除角色");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	function handleSubmit(payload: RoleFormPayload) {
		if (editing) updateMutation.mutate({ id: editing.id, ...payload });
		else createMutation.mutate(payload);
	}

	return (
		<PageFrame>
			<PageHeader
				title="角色管理"
				description="角色是全局定义的(不随部门复制);「谁在哪个部门是什么角色」记在部门成员上。勾了哪些菜单 / 按钮,就决定这个人能看见什么。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<ActionButton disabled={rolesQuery.isFetching} onClick={() => void rolesQuery.refetch()}>
							刷新
						</ActionButton>
						{canAdd ? (
							<Button
								size="sm"
								onClick={() => {
									setEditing(null);
									setCreating(true);
								}}
							>
								新增角色
							</Button>
						) : null}
					</div>
				}
			/>

			<StatCards items={stats} />

			<Card className="flex min-h-[26rem] flex-1 flex-col gap-4 hover:border-border hover:shadow-none">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<KeyRound className="size-4 text-muted-foreground" />
						角色清单
					</CardTitle>
					<Badge variant="outline" className="tabular-nums">
						匹配 {filtered.length} 条
					</Badge>
				</CardHeader>
				<CardContent className="flex min-h-0 flex-1 flex-col gap-3">
					<LedgerToolbar search={keyword} onSearchChange={setKeyword} searchPlaceholder="搜索角色名 / 标识…" />
					<TableLoadingShell fill busy={rolesQuery.isFetching} minHeight={240}>
						<DataTable table={table} emptyText="没有符合条件的角色" />
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

			<SettingsRolesForm
				role={editing}
				creating={creating}
				open={creating || editing !== null}
				pending={createMutation.isPending || updateMutation.isPending}
				onOpenChange={(next) => {
					if (!next) {
						setCreating(false);
						setEditing(null);
					}
				}}
				onSubmit={handleSubmit}
			/>

			<SettingsRolesPermsDialog
				key={permsFor?.id ?? "none"}
				role={permsFor}
				permTree={permTree}
				open={permsFor !== null}
				onOpenChange={(next) => {
					if (!next) setPermsFor(null);
				}}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title={`删除角色「${pendingDelete?.name ?? ""}」?`}
				description="还有部门成员在用这个角色时会被拒绝 —— 请先给他们换成别的角色。"
				confirmText="删除"
				confirmVariant="destructive"
				isPending={deleteMutation.isPending}
				pendingText="删除中…"
				onConfirm={() => pendingDelete && deleteMutation.mutate({ id: pendingDelete.id })}
			/>
		</PageFrame>
	);
}
