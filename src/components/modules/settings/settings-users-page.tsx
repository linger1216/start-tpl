import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, UserCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import {
	USER_EXCEL_COLUMNS,
	USER_IMPORT_FIELDS,
	userExcelRows,
} from "#/components/modules/settings/settings-users-excel";
import { SettingsUsersForm, type UserFormPayload } from "#/components/modules/settings/settings-users-form";
import { type UserRow, userColumns } from "#/components/modules/settings/settings-users-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { ExcelExportButton, ExcelImportButton } from "#/components/modules/shared/excel-actions";
import { LedgerCard } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import type { MultiSelectOption } from "#/components/modules/shared/multi-select";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Badge } from "#/components/ui/badge";
import { BadgeList } from "#/components/ui/badge-list";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useLedgerTable } from "#/hooks/use-ledger-table";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { matchKeyword } from "#/lib/table";

/**
 * 系统设置 ▸ 用户管理 —— **台账布局**(与参数管理同一套):
 * 页头(刷新 + 新建)→ 统计卡 → 台账(搜索 + 表格 + **分页**)→ 详情 / 编辑 / 删除对话框。
 *
 * 账号由 Better Auth 管:这里能开新账号(转调它的 `signUpEmail`),也能改姓名 / 邮箱;
 * 但**密码与邮箱验证**走 BA 自己的流程,不在这里代改。
 *
 * 这一页还管**角色分配** —— 角色是全局的(与部门无关,见表 `sys_casbin_rule` 的 `g` 行),
 * 在「编辑」里用多选框挑;部门归属是组织架构,同一个弹窗里也用多选框维护(与角色互不影响)。
 */
export function SettingsUsersPage() {
	const trpc = useTRPC();
	const usersQuery = useQuery(trpc.user.list.queryOptions());
	const users = (usersQuery.data ?? []) as UserRow[];

	const [keyword, setKeyword] = useState("");
	const [detailFor, setDetailFor] = useState<UserRow | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<UserRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<UserRow | null>(null);

	// 部门 / 角色只在账号表单里用 —— 表单没开就不拉全量候选(与角色页、通知页同一写法)
	const departmentsQuery = useQuery({
		...trpc.department.tree.queryOptions(),
		enabled: createOpen || editing !== null,
	});
	const rolesQuery = useQuery({
		...trpc.role.list.queryOptions(),
		enabled: createOpen || editing !== null,
	});
	const departmentRows = departmentsQuery.data ?? [];
	const roles = (rolesQuery.data ?? []).map((row) => ({
		value: row.id,
		label: row.name,
	})) as MultiSelectOption[];
	// 部门重名很常见(每个大区下面都有一个"财务部"),所以带一个"上级"提示帮助分辨
	const departmentOptions = (() => {
		const nameOf = new Map(departmentRows.map((row) => [row.id, row.name]));
		return departmentRows.map((row) => ({
			value: row.id,
			label: row.name,
			hint: row.parentId ? (nameOf.get(row.parentId) ?? undefined) : undefined,
		})) as MultiSelectOption[];
	})();

	const queryClient = useQueryClient();
	const updateMutation = useMutation(
		trpc.user.update.mutationOptions({
			onSuccess: async (updated) => {
				await queryClient.invalidateQueries(trpc.user.pathFilter());
				setEditing(null);
				toast.success(`已保存 ${updated.name}`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const deleteMutation = useMutation(
		trpc.user.remove.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.user.pathFilter());
				setPendingDelete(null);
				toast.success("账号已删除");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const createMutation = useMutation(
		trpc.user.create.mutationOptions({
			onSuccess: async (created) => {
				await queryClient.invalidateQueries(trpc.user.pathFilter());
				setCreateOpen(false);
				toast.success(`已创建账号 ${created.email}`, { description: "还没有角色 —— 点「编辑」给他分配。" });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	// 导入不写 onError:整批失败 / 逐行错误都由对话框自己显示(红字警告区 + 明细)
	const importMutation = useMutation(
		trpc.user.import.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.user.pathFilter());
			},
		}),
	);

	const filtered = useMemo(() => users.filter((row) => matchKeyword([row.name, row.email], keyword)), [users, keyword]);
	// 导出的是**当前筛选结果**,不是全表 —— 所见即所得
	const excelRows = useMemo(() => userExcelRows(filtered), [filtered]);

	const columns = useMemo(
		() => userColumns({ onView: setDetailFor, onEdit: setEditing, onDelete: setPendingDelete }),
		[],
	);
	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		prefKey: "settings.users",
	});

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "total",
				label: "用户总数",
				value: users.length,
				description: "账号由登录服务管理,这里只读",
				Icon: Users,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "人",
			},
			{
				key: "assigned",
				label: "已分配角色",
				value: users.filter((row) => row.roleNames.length > 0).length,
				description: "没有角色的人看不到任何菜单",
				Icon: UserCheck,
				tone: "bg-hue-emerald-soft text-hue-emerald-fg",
				unit: "人",
			},
			{
				key: "depts",
				label: "部门数",
				value: departmentOptions.length,
				description: "组织架构(在「部门管理」里维护)",
				Icon: Building2,
				tone: "bg-hue-violet-soft text-hue-violet-fg",
				unit: "个",
			},
		],
		[users, departmentOptions.length],
	);

	return (
		<PageFrame>
			<PageHeader
				title="用户管理"
				description="账号由登录服务管理;这一页改姓名 / 邮箱并分配**全局角色**(与部门无关)。多个角色的可见菜单取并集。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={usersQuery.isFetching} onClick={() => void usersQuery.refetch()} />
						<Button size="sm" onClick={() => setCreateOpen(true)}>
							<Plus className="size-3.5" />
							新增用户
						</Button>
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
				searchPlaceholder="搜索姓名 / 邮箱…"
				actions={
					<>
						<ColumnToggle table={table} onPersist={persistColumns} />
						<ExcelExportButton columns={USER_EXCEL_COLUMNS} rows={excelRows} fileName="用户" />
						<ExcelImportButton
							title="导入用户"
							description="一行 = 一个账号(邮箱是业务键),**只建不改**:邮箱已存在的行会跳过并报出来。导出的文件回导时要手补「初始密码」列(密码是散列的,导不出来)。"
							fields={USER_IMPORT_FIELDS}
							fileNamePrefix="用户导入模板"
							onImport={(importRows) => importMutation.mutateAsync({ rows: importRows })}
						/>
					</>
				}
			/>

			<LedgerCard
				title="用户台账"
				Icon={Users}
				count={filtered.length}
				busy={usersQuery.isFetching}
				emptyText="没有符合条件的用户"
				table={table}
			/>

			<DetailDialog
				open={detailFor !== null}
				onOpenChange={(next) => {
					if (!next) setDetailFor(null);
				}}
				title={`用户详情 · ${detailFor?.name ?? ""}`}
				description={detailFor?.email ?? ""}
				badge={
					detailFor ? (
						<Badge variant={detailFor.emailVerified ? "secondary" : "outline"} className="text-xs">
							{detailFor.emailVerified ? "邮箱已验证" : "邮箱未验证"}
						</Badge>
					) : null
				}
				meta={{ createdAt: detailFor?.createdAt, updatedAt: detailFor?.updatedAt }}
				onEdit={() => {
					if (detailFor) setEditing(detailFor);
				}}
			>
				{detailFor ? (
					<div className="grid gap-x-6 gap-y-1 sm:grid-cols-1">
						<DetailRow label="ID">
							<span className="font-mono text-xs">{detailFor.id}</span>
						</DetailRow>
						<DetailRow label="姓名">
							<span className="text-sm font-medium">{detailFor.name}</span>
						</DetailRow>
						<DetailRow label="邮箱">{detailFor.email}</DetailRow>
						<DetailRow label="邮箱已验证">{detailFor.emailVerified ? "是" : "否"}</DetailRow>
						<DetailRow label="头像">
							<div className="flex items-center gap-2">
								<Avatar className="size-8">
									{detailFor.image ? <AvatarImage src={detailFor.image} alt={detailFor.name} /> : null}
									<AvatarFallback className="text-xs">{(detailFor.name || "?").slice(0, 1)}</AvatarFallback>
								</Avatar>
								<span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
									{detailFor.image ?? "—"}
								</span>
							</div>
						</DetailRow>

						<DetailRow label="部门">
							{" "}
							<BadgeList
								values={detailFor.departmentNames}
								layout="wrap"
								color="stable"
								emptyPlaceholder="未加入部门"
							/>
						</DetailRow>
						<DetailRow label="角色">
							{" "}
							<BadgeList
								values={detailFor.roleNames}
								layout="wrap"
								color="stable"
								emptyPlaceholder="未分配(看不到任何菜单)"
							/>
						</DetailRow>
					</div>
				) : null}
			</DetailDialog>

			<SettingsUsersForm
				user={editing}
				creating={editing === null}
				open={createOpen || editing !== null}
				pending={createMutation.isPending || updateMutation.isPending}
				roles={roles}
				departments={departmentOptions}
				onOpenChange={(next) => {
					if (next) return;
					setCreateOpen(false);
					setEditing(null);
				}}
				onSubmit={(payload: UserFormPayload) => {
					if (editing) {
						// 覆盖式:角色与部门传进去的就是最终状态
						updateMutation.mutate({
							id: editing.id,
							name: payload.name,
							email: payload.email,
							image: payload.image,
							emailVerified: payload.emailVerified,
							roleIds: payload.roleIds,
							departmentIds: payload.departmentIds,
						});
					} else {
						// 新建只开账号(密码归 BA);角色 / 部门建完在「编辑」里分配
						createMutation.mutate({
							name: payload.name,
							email: payload.email,
							password: payload.password,
						});
					}
				}}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title={`删除账号「${pendingDelete?.email ?? ""}」?`}
				description="会同时清掉它的登录会话、密码记录、部门成员关系与角色分配。账号可以再建,但授权信息不会回来。"
				confirmText="删除"
				confirmVariant="destructive"
				isPending={deleteMutation.isPending}
				pendingText="删除中…"
				onConfirm={() => {
					if (pendingDelete) deleteMutation.mutate({ id: pendingDelete.id });
				}}
			/>
		</PageFrame>
	);
}
