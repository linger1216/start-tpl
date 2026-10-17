import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { MenuRow } from "#/components/layout/nav-menu";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsRolesDetail } from "#/components/modules/settings/settings-roles-detail";
import { ROLE_EXCEL_COLUMNS, roleExcelRows } from "#/components/modules/settings/settings-roles-excel";
import {
	type RoleFormPayload,
	type RoleFormTab,
	SettingsRolesForm,
} from "#/components/modules/settings/settings-roles-form";
import { type RoleRow, roleColumns } from "#/components/modules/settings/settings-roles-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { ExcelExportButton, ExcelImportButton } from "#/components/modules/shared/excel-actions";
import { LedgerCard } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import type { PermissionNode } from "#/components/modules/shared/permission-select";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useLedgerDialogs } from "#/hooks/use-ledger-dialogs";
import { useLedgerTable } from "#/hooks/use-ledger-table";
import { writeError, writeSuccess } from "#/hooks/use-ledger-write";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { MENU_TYPE } from "#/lib/menu-spec";
import { matchKeyword } from "#/lib/table";
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
	const roles = useMemo(() => (rolesQuery.data ?? []) as RoleRow[], [rolesQuery.data]);

	/** 按钮级可见性:权限体系未启用时 `useHasPerm` 恒为 true */
	const canAdd = useHasPerm("sys:role:add");
	const canRemove = useHasPerm("sys:role:remove");

	const [keyword, setKeyword] = useState("");
	// 四态弹窗(dialogs.viewing / dialogs.createOpen / dialogs.editing / dialogs.pendingDelete)收进统一钩子
	const dialogs = useLedgerDialogs<RoleRow>();
	const [creating, setCreating] = useState(false);
	/** 打开编辑表单时落在哪个 tab:「菜单权限」入口直接落到 menus */
	const [formTab, setFormTab] = useState<RoleFormTab>("basic");

	// 权限树只在角色表单里用 —— 表单没开就不拉全量菜单(与下面的成员选择同一写法)
	const menusQuery = useQuery({
		...trpc.menu.list.queryOptions(),
		enabled: creating || dialogs.editing !== null,
	});
	const permTree = useMemo(() => buildPermTree(menusQuery.data ?? []), [menusQuery.data]);

	const filtered = useMemo(
		() => roles.filter((row) => matchKeyword([row.name, row.remark], keyword)),
		[roles, keyword],
	);

	const columns = useMemo(
		() =>
			roleColumns({
				onView: dialogs.setViewing,
				onEdit: (row) => {
					setFormTab("basic");
					setCreating(false);
					dialogs.setEditing(row);
				},
				// 没有「删除角色」权限就干脆不渲染那个按钮(隐藏 = 不可见)
				onDelete: canRemove ? dialogs.setPendingDelete : undefined,
			}),
		[canRemove, dialogs],
	);

	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		prefKey: "settings.roles",
	});

	const excelRows = useMemo(() => roleExcelRows(filtered), [filtered]);

	// 失败提示归导入对话框(整批错进警告区、逐行错进明细),这里只负责刷新列表 —— 与字典 / 参数导入同一个口径
	const importMutation = useMutation(
		trpc.role.import.mutationOptions({
			onSuccess: async () => {
				await invalidate();
			},
		}),
	);

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
		...trpc.role.users.queryOptions({ roleId: dialogs.editing?.id ?? "" }),
		enabled: Boolean(dialogs.editing),
	});
	// 选择器的候选:只有打开表单时才需要,平时不拉全量用户
	const usersQuery = useQuery({
		...trpc.user.list.queryOptions(),
		enabled: creating || dialogs.editing !== null,
	});

	const addUserMutation = useMutation(
		trpc.role.addUser.mutationOptions({
			onSuccess: writeSuccess(invalidate),
			onError: writeError,
		}),
	);
	const removeUserMutation = useMutation(
		trpc.role.removeUser.mutationOptions({
			onSuccess: writeSuccess(invalidate),
			onError: writeError,
		}),
	);

	function invalidate() {
		return queryClient.invalidateQueries(trpc.role.pathFilter());
	}

	const createMutation = useMutation(
		trpc.role.create.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => setCreating(false),
				message: (row) => `已新增角色「${row.name}」`,
			}),
			onError: writeError,
		}),
	);

	const updateMutation = useMutation(
		trpc.role.update.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => dialogs.setEditing(null),
				message: (row) => `已保存「${row.name}」`,
			}),
			onError: writeError,
		}),
	);

	const deleteMutation = useMutation(
		trpc.role.remove.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => dialogs.setPendingDelete(null), message: () => "已删除角色" }),
			onError: writeError,
		}),
	);

	function handleSubmit(payload: RoleFormPayload) {
		if (dialogs.editing) updateMutation.mutate({ id: dialogs.editing.id, ...payload });
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
									dialogs.setEditing(null);
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
				searchPlaceholder="搜索角色名 / 备注…"
				actions={
					<>
						<ColumnToggle table={table} onPersist={persistColumns} />
						<ExcelExportButton columns={ROLE_EXCEL_COLUMNS} rows={excelRows} fileName="角色" />
						<ExcelImportButton
							title="导入角色"
							description="一行 = 一个角色(角色名是业务键)。库里没有的建、已有的改排序 / 状态 / 备注;留空的单元格不动库里的值。"
							fields={ROLE_EXCEL_COLUMNS}
							fileNamePrefix="角色导入模板"
							onImport={(importRows) => importMutation.mutateAsync({ rows: importRows })}
						/>
					</>
				}
			/>

			<LedgerCard
				title="角色清单"
				Icon={KeyRound}
				count={filtered.length}
				busy={rolesQuery.isFetching}
				emptyText="没有符合条件的角色"
				table={table}
			/>

			<SettingsRolesDetail
				row={dialogs.viewing}
				open={dialogs.viewing !== null}
				onOpenChange={(next) => {
					if (!next) dialogs.setViewing(null);
				}}
				onEdit={(row) => {
					dialogs.setViewing(null);
					setFormTab("basic");
					setCreating(false);
					dialogs.setEditing(row);
				}}
			/>

			<SettingsRolesForm
				role={dialogs.editing}
				creating={creating}
				open={creating || dialogs.editing !== null}
				pending={createMutation.isPending || updateMutation.isPending}
				initialTab={formTab}
				permTree={permTree}
				members={roleUsersQuery.data ?? []}
				userOptions={(usersQuery.data ?? []).map((user) => ({ id: user.id, name: user.name, email: user.email }))}
				membersLoading={roleUsersQuery.isFetching}
				membersPending={addUserMutation.isPending || removeUserMutation.isPending}
				onAddMembers={(userIds) => {
					if (!dialogs.editing) return;
					// 逐条提交(接口按人幂等);一次选多人时它们会并发跑完
					for (const userId of userIds) addUserMutation.mutate({ roleId: dialogs.editing.id, userId });
				}}
				onRemoveMember={(userId) =>
					dialogs.editing && removeUserMutation.mutate({ roleId: dialogs.editing.id, userId })
				}
				onOpenChange={(next) => {
					if (!next) {
						setCreating(false);
						dialogs.setEditing(null);
					}
				}}
				onSubmit={handleSubmit}
			/>

			<ConfirmDialog
				open={dialogs.pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) dialogs.setPendingDelete(null);
				}}
				title="删除角色"
				description={`确认删除「${dialogs.pendingDelete?.name ?? ""}」?还有用户在用它时会被拒绝 —— 请先在「用户管理」里给他们换成别的角色。`}
				isPending={deleteMutation.isPending}
				onConfirm={() => dialogs.pendingDelete && deleteMutation.mutate({ ids: [dialogs.pendingDelete.id] })}
			/>
		</PageFrame>
	);
}
