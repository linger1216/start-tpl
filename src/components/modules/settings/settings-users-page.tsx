import { useQuery } from "@tanstack/react-query";
import { Building2, UserCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsUsersGrantsDialog } from "#/components/modules/settings/settings-users-grants";
import { type UserRow, userColumns } from "#/components/modules/settings/settings-users-table";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { DataTable, TableLoadingShell } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { useTRPC } from "#/integrations/trpc/react";
import { useAppTable } from "#/lib/table";

type DepartmentOption = { id: string; name: string };
type RoleOption = { id: string; name: string };

/**
 * 系统设置 ▸ 用户管理 —— **台账布局**(与参数管理同一套):
 * 页头(刷新)→ 统计卡 → 台账(搜索 + 表格 + **分页**)→ 授权对话框。
 *
 * 账号本身归 Better Auth(这里只读 `sys_user`,不建/改/删用户);这一页管的是**授权**:
 * 谁在哪些部门、每个部门是什么角色。
 */
export function SettingsUsersPage() {
	const trpc = useTRPC();
	const usersQuery = useQuery(trpc.user.list.queryOptions());
	const departmentsQuery = useQuery(trpc.department.tree.queryOptions());
	const rolesQuery = useQuery(trpc.role.list.queryOptions());

	const users = (usersQuery.data ?? []) as UserRow[];
	const departments = (departmentsQuery.data ?? []).map((row) => ({
		id: row.id,
		name: row.name,
	})) as DepartmentOption[];
	const roles = (rolesQuery.data ?? []).map((row) => ({ id: row.id, name: row.name })) as RoleOption[];

	const [keyword, setKeyword] = useState("");
	const [grantsFor, setGrantsFor] = useState<UserRow | null>(null);

	const filtered = useMemo(() => {
		const key = keyword.trim().toLowerCase();
		if (!key) return users;
		return users.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(key));
	}, [users, keyword]);

	const columns = useMemo(() => userColumns({ onGrants: setGrantsFor }), []);
	const table = useAppTable({
		columns,
		data: filtered,
		initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
	});
	const { pageIndex, pageSize } = table.state.pagination;

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
				label: "已授权",
				value: users.filter((row) => row.assignments.length > 0).length,
				description: "至少属于一个部门的人",
				Icon: UserCheck,
				tone: "bg-hue-emerald-soft text-hue-emerald-fg",
				unit: "人",
			},
			{
				key: "depts",
				label: "部门数",
				value: departments.length,
				description: "可分配的部门(含子部门)",
				Icon: Building2,
				tone: "bg-hue-violet-soft text-hue-violet-fg",
				unit: "个",
			},
		],
		[users, departments.length],
	);

	return (
		<PageFrame>
			<PageHeader
				title="用户管理"
				description="账号由登录服务管理(这里只读);这一页管的是授权 —— 谁在哪些部门、每个部门是什么角色。多部门的权限取并集。"
				actions={
					<ActionButton disabled={usersQuery.isFetching} onClick={() => void usersQuery.refetch()}>
						刷新
					</ActionButton>
				}
			/>

			<StatCards items={stats} />

			<Card className="flex min-h-104 flex-1 flex-col gap-4">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<Users className="size-4 text-muted-foreground" />
						用户台账
					</CardTitle>
					<Badge variant="outline" className="tabular-nums">
						匹配 {filtered.length} 条
					</Badge>
				</CardHeader>
				<CardContent className="flex min-h-0 flex-1 flex-col gap-3">
					<LedgerToolbar search={keyword} onSearchChange={setKeyword} searchPlaceholder="搜索姓名 / 邮箱…" />
					<TableLoadingShell fill busy={usersQuery.isFetching} minHeight={240}>
						<DataTable table={table} emptyText="没有符合条件的用户" />
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

			<SettingsUsersGrantsDialog
				key={grantsFor?.id ?? "none"}
				user={grantsFor}
				departments={departments}
				roles={roles}
				open={grantsFor !== null}
				onOpenChange={(next) => {
					if (!next) setGrantsFor(null);
				}}
			/>
		</PageFrame>
	);
}
