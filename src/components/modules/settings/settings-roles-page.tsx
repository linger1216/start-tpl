import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { MenuRow } from "#/components/layout/nav-menu";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsRolesDetail } from "#/components/modules/settings/settings-roles-detail";
import {
	type RoleFormPayload,
	type RoleFormTab,
	SettingsRolesForm,
} from "#/components/modules/settings/settings-roles-form";
import { type RoleRow, roleColumns } from "#/components/modules/settings/settings-roles-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import type { PermissionNode } from "#/components/modules/shared/permission-tree";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { DataTable, TableLoadingShell } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useColumnPrefs } from "#/hooks/use-column-prefs";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { MENU_TYPE } from "#/lib/menu-spec";
import { useAppTable } from "#/lib/table";
import { bySortThenName, groupByParent } from "#/lib/tree";

/**
 * 菜单行 → 权限树:菜单是枝、**按钮**(`type = 3`)是叶,后者带「操作」徽章。
 * 给角色勾按钮 = 那个按钮的 `perm` 进入他的权限集合(前端 `useHasPerm` 认它)。
 */
function buildPermTree(rows: readonly MenuRow[]): PermissionNode[] {
	// 分组 / 同级排序 / 父不存在时提升为一级 → 统一走 lib/tree.ts(节点形状不同,所以自己递归)
	const { byParent, roots } = groupByParent(rows, { rootKey: "", compare: bySortThenName });
	const build = (row: MenuRow): PermissionNode => {
		const children = (byParent.get(row.id) ?? []).map(build);
		const node: PermissionNode = { id: row.id, name: row.name };
		if (Number(row.type) === MENU_TYPE.BUTTON) node.kind = "操作";
		if (children.length > 0) node.children = children;
		return node;
	};
	return roots.map(build);
}

/**
 * 系统设置 ▸ 角色管理 —— **台账布局**(与参数管理同一套):
 * 页头(刷新 / 新增角色)→ 统计卡 → 清单(搜索 + 表格 + **分页**)→ 表单 / 权限对话框。
 *
 * 角色的定位(见 `db/data-base-schema.ts`):**全局定义**,不随部门复制。
 * 「张三在上海是管理员」记在 `sys_user_dept` 上,不是在这里多建一个"上海管理员"角色。
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
	/** 打开编辑表单时落在哪个 tab:「菜单权限」入口直接落到 menus */
	const [formTab, setFormTab] = useState<RoleFormTab>("basic");
	const [pendingDelete, setPendingDelete] = useState<RoleRow | null>(null);
	const [viewing, setViewing] = useState<RoleRow | null>(null);

	const filtered = useMemo(() => {
		const key = keyword.trim().toLowerCase();
		if (!key) return roles;
		return roles.filter((row) => `${row.name} ${row.code}`.toLowerCase().includes(key));
	}, [roles, keyword]);

	const columns = useMemo(
		() =>
			roleColumns({
				onView: setViewing,
				onEdit: (row) => {
					setFormTab("basic");
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
	// 列顺序 / 隐藏项存进参数 `page.columns`(换机器也跟着账号走)
	const { persist: persistColumns } = useColumnPrefs("settings.roles", table);

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

	// 「谁有这个角色」—— 和部门面板的成员区同源,只是看的是另一张关联表
	const roleUsersQuery = useQuery({
		...trpc.role.users.queryOptions({ roleId: editing?.id ?? "" }),
		enabled: Boolean(editing),
	});
	// 选择器的候选:只有打开表单时才需要,平时不拉全量用户
	const usersQuery = useQuery({
		...trpc.user.list.queryOptions(),
		enabled: creating || editing !== null,
	});

	const addUserMutation = useMutation(
		trpc.role.addUser.mutationOptions({
			onSuccess: async () => {
				await invalidate();
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);
	const removeUserMutation = useMutation(
		trpc.role.removeUser.mutationOptions({
			onSuccess: async () => {
				await invalidate();
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

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
				description="角色是全局定义的(不随部门复制);谁有哪些角色在「用户管理」里分配。勾了哪些菜单 / 按钮,就决定这个角色的人能看见什么、能用什么。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={rolesQuery.isFetching} onClick={() => void rolesQuery.refetch()} />
						{canAdd ? (
							<Button
								size="sm"
								onClick={() => {
									setEditing(null);
									setCreating(true);
								}}
							>
								<Plus className="size-3.5" />
								新增角色
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
				searchPlaceholder="搜索角色名 / 标识…"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>

			<Card className="flex min-h-[26rem] flex-1 flex-col gap-4">
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

			<SettingsRolesDetail
				row={viewing}
				open={viewing !== null}
				onOpenChange={(next) => {
					if (!next) setViewing(null);
				}}
				onEdit={(row) => {
					setViewing(null);
					setFormTab("basic");
					setCreating(false);
					setEditing(row);
				}}
				onPerms={(row) => {
					setViewing(null);
					setFormTab("menus");
					setEditing(row);
				}}
			/>

			<SettingsRolesForm
				role={editing}
				creating={creating}
				open={creating || editing !== null}
				pending={createMutation.isPending || updateMutation.isPending}
				initialTab={formTab}
				permTree={permTree}
				members={roleUsersQuery.data ?? []}
				userOptions={(usersQuery.data ?? []).map((user) => ({ id: user.id, name: user.name, email: user.email }))}
				membersLoading={roleUsersQuery.isFetching}
				membersPending={addUserMutation.isPending || removeUserMutation.isPending}
				onAddMembers={(userIds) => {
					if (!editing) return;
					// 逐条提交(接口按人幂等);一次选多人时它们会并发跑完
					for (const userId of userIds) addUserMutation.mutate({ roleId: editing.id, userId });
				}}
				onRemoveMember={(userId) => editing && removeUserMutation.mutate({ roleId: editing.id, userId })}
				onOpenChange={(next) => {
					if (!next) {
						setCreating(false);
						setEditing(null);
					}
				}}
				onSubmit={handleSubmit}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title={`删除角色「${pendingDelete?.name ?? ""}」?`}
				description="还有用户在用它时会被拒绝 —— 请先在「用户管理」里给他们换成别的角色。"
				confirmText="删除"
				confirmVariant="destructive"
				isPending={deleteMutation.isPending}
				pendingText="删除中…"
				onConfirm={() => pendingDelete && deleteMutation.mutate({ id: pendingDelete.id })}
			/>
		</PageFrame>
	);
}
