import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, KeyRound, Plus, ShieldCheck, UserCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsGuestsDetail } from "#/components/modules/settings/settings-guests-detail";
import { type GuestFormPayload, SettingsGuestsForm } from "#/components/modules/settings/settings-guests-form";
import { type ShareTokenRow, shareTokenColumns } from "#/components/modules/settings/settings-guests-table";
import { SettingsUsersDetail } from "#/components/modules/settings/settings-users-detail";
import {
	USER_EXCEL_COLUMNS,
	USER_IMPORT_FIELDS,
	userExcelRows,
} from "#/components/modules/settings/settings-users-excel";
import { SettingsUsersForm, type UserFormPayload } from "#/components/modules/settings/settings-users-form";
import { type UserRow, userColumns } from "#/components/modules/settings/settings-users-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { ExcelExportButton, ExcelImportButton } from "#/components/modules/shared/excel-actions";
import { LedgerCard } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import type { MultiSelectOption } from "#/components/modules/shared/multi-select";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useLedgerDialogs } from "#/hooks/use-ledger-dialogs";
import { useLedgerTable } from "#/hooks/use-ledger-table";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { isShareTokenExpired } from "#/lib/share-token-spec";
import { matchKeyword } from "#/lib/table";

/** 这一页的主分区:用户台账 / 访客管理(Base UI 只挂当前面板,弹窗 state 都不放进面板) */
type UserPageTab = "users" | "guests";

/**
 * 系统设置 ▸ 用户管理 —— **台账布局 + 主分区 Tab**(`ui/tabs` 的 underline 形态):
 * 页头(标题与动作跟随当前 Tab)→ Tab「用户」= 原台账;Tab「访客管理」= 外链令牌台账。
 *
 * 用户台账:账号由 Better Auth 管,这里能开新账号(转调它的 `signUpEmail`),也能改姓名 / 邮箱;
 * 但**密码与邮箱验证**走 BA 自己的流程。角色分配也在这里 —— 角色是全局的(与部门无关,
 * 见表 `sys_casbin_rule` 的 `g` 行),在「编辑」里用多选框挑。
 *
 * 访客管理(见 `doc/外链分享.md`):签发外链令牌,让外部人员免登**只读**查看允许页面。
 * 存在「启用 ∧ 未过期」的令牌 = 访客开启,行级启停就是总开关 —— 不引入额外的全局状态。
 */
export function SettingsUsersPage() {
	const trpc = useTRPC();
	const usersQuery = useQuery(trpc.user.list.queryOptions());
	const users = (usersQuery.data ?? []) as UserRow[];
	const tokensQuery = useQuery(trpc.shareToken.list.queryOptions());
	const tokens = (tokensQuery.data ?? []) as ShareTokenRow[];

	const [tab, setTab] = useState<UserPageTab>("users");
	const [keyword, setKeyword] = useState("");
	const [guestKeyword, setGuestKeyword] = useState("");
	// 四态弹窗(viewing / createOpen / editing / pendingDelete)收进统一钩子 —— 7 个台账页同一份样板
	const dialogs = useLedgerDialogs<UserRow>();
	const guestDialogs = useLedgerDialogs<ShareTokenRow>();

	// 部门 / 角色只在账号表单里用 —— 表单没开就不拉全量候选(与角色页、通知页同一写法)
	const departmentsQuery = useQuery({
		...trpc.department.tree.queryOptions(),
		enabled: dialogs.formOpen,
	});
	const rolesQuery = useQuery({
		...trpc.role.list.queryOptions(),
		enabled: dialogs.formOpen,
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
	/** 写完数据后让列表重新拉一次(与角色 / 字典页同形) */
	const invalidate = () => queryClient.invalidateQueries(trpc.user.pathFilter());
	const invalidateTokens = () => queryClient.invalidateQueries(trpc.shareToken.pathFilter());

	const updateMutation = useMutation(
		trpc.user.update.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => dialogs.setEditing(null),
				message: (u) => `已保存 ${u.name}`,
			}),
			onError: toastApiError,
		}),
	);

	const deleteMutation = useMutation(
		trpc.user.remove.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => dialogs.setPendingDelete(null), message: () => "账号已删除" }),
			onError: toastApiError,
		}),
	);

	const createMutation = useMutation(
		trpc.user.create.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => dialogs.setCreateOpen(false),
				message: (created) => `已创建账号 ${created.email}`,
				description: () => "还没有角色 —— 点「编辑」给他分配。",
			}),
			onError: toastApiError,
		}),
	);

	// 导入不写 onError:整批失败 / 逐行错误都由对话框自己显示(红字警告区 + 明细)
	const importMutation = useMutation(
		trpc.user.import.mutationOptions({
			onSuccess: async () => {
				await invalidate();
			},
		}),
	);

	const filtered = useMemo(() => users.filter((row) => matchKeyword([row.name, row.email], keyword)), [users, keyword]);
	// 导出的是**当前筛选结果**,不是全表 —— 所见即所得
	const excelRows = useMemo(() => userExcelRows(filtered), [filtered]);

	const columns = useMemo(
		() => userColumns({ onView: dialogs.setViewing, onEdit: dialogs.setEditing, onDelete: dialogs.setPendingDelete }),
		[dialogs],
	);
	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		prefKey: "settings.users",
	});

	// ── 访客管理 ──────────────────────────────────────────────
	const guestFiltered = useMemo(
		() => tokens.filter((row) => matchKeyword([row.remark, row.allowedPaths.join(" ")], guestKeyword)),
		[tokens, guestKeyword],
	);

	const tokenCreateMutation = useMutation(
		trpc.shareToken.create.mutationOptions({
			onSuccess: writeSuccess(invalidateTokens, {
				close: () => guestDialogs.setCreateOpen(false),
				message: () => "已生成访客令牌",
				description: () => "点该行的「复制链接」把外链发给对方。",
			}),
			onError: toastApiError,
		}),
	);
	const tokenUpdateMutation = useMutation(
		trpc.shareToken.update.mutationOptions({
			onSuccess: writeSuccess(invalidateTokens, {
				close: () => guestDialogs.setEditing(null),
				message: () => "已保存访客令牌",
			}),
			onError: toastApiError,
		}),
	);
	const tokenToggleMutation = useMutation(
		trpc.shareToken.toggle.mutationOptions({
			onSuccess: writeSuccess(invalidateTokens, {
				message: (r) => (r.enabled ? "已启用,外链恢复有效" : "已停用,外链立即失效"),
			}),
			onError: toastApiError,
		}),
	);
	const tokenDeleteMutation = useMutation(
		trpc.shareToken.remove.mutationOptions({
			onSuccess: writeSuccess(invalidateTokens, {
				close: () => guestDialogs.setPendingDelete(null),
				message: () => "令牌已删除,外链立即失效",
			}),
			onError: toastApiError,
		}),
	);

	const guestColumns = useMemo(
		() =>
			shareTokenColumns({
				onCopyLink: copyShareLink,
				onToggle: (row) => tokenToggleMutation.mutate({ id: row.id, enabled: !row.enabled }),
				onView: guestDialogs.setViewing,
				onEdit: guestDialogs.openEdit,
				onDelete: guestDialogs.setPendingDelete,
			}),
		[guestDialogs, tokenToggleMutation],
	);
	const { table: guestTable, persistColumns: persistGuestColumns } = useLedgerTable({
		columns: guestColumns,
		data: guestFiltered,
		prefKey: "settings.users.guests",
	});

	const guestStats: StatItem[] = useMemo(
		() => [
			{
				key: "active",
				label: "启用中",
				value: tokens.filter((row) => row.enabled && !isShareTokenExpired(row.expiresAt)).length,
				description: "启用且未过期的令牌 —— 有就是访客开启,全是 0 即访客关闭",
				Icon: ShieldCheck,
				tone: "bg-hue-emerald-soft text-hue-emerald-fg",
				unit: "条",
			},
			{
				key: "total",
				label: "令牌总数",
				value: tokens.length,
				description: "历史签发的外链令牌(含停用与已过期)",
				Icon: KeyRound,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "条",
			},
		],
		[tokens],
	);

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
				title={tab === "guests" ? "访客管理" : "用户管理"}
				description={
					tab === "guests"
						? "签发外链令牌:拿到链接的人可在允许页面上免登只读查看,写操作一律拒绝。行级「启用 / 停用」就是访客的总开关。"
						: "账号由登录服务管理;这一页改姓名 / 邮箱并分配**全局角色**(与部门无关)。多个角色的可见菜单取并集。"
				}
				actions={
					tab === "guests" ? (
						<div className="flex flex-wrap items-center gap-2">
							<RefreshButton busy={tokensQuery.isFetching} onClick={() => void tokensQuery.refetch()} />
							<Button size="sm" onClick={() => guestDialogs.openCreate()}>
								<Plus className="size-3.5" />
								新增令牌
							</Button>
						</div>
					) : (
						<div className="flex flex-wrap items-center gap-2">
							<RefreshButton busy={usersQuery.isFetching} onClick={() => void usersQuery.refetch()} />
							<Button size="sm" onClick={() => dialogs.openCreate()}>
								<Plus className="size-3.5" />
								新增用户
							</Button>
						</div>
					)
				}
			/>

			<Tabs
				variant="underline"
				value={tab}
				onValueChange={(next) => setTab(next as UserPageTab)}
				className="min-h-0 flex-1"
			>
				<TabsList>
					<TabsTrigger value="users">用户</TabsTrigger>
					<TabsTrigger value="guests">访客管理</TabsTrigger>
				</TabsList>

				{/* ── 用户台账(原有内容整体移入)────────────────────────── */}
				<TabsContent value="users" className="flex min-h-0 flex-1 flex-col gap-4">
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
				</TabsContent>

				{/* ── 访客管理(外链令牌台账,见 doc/外链分享.md)──────────── */}
				<TabsContent value="guests" className="flex min-h-0 flex-1 flex-col gap-4">
					<StatCards items={guestStats} />

					<LedgerToolbar
						search={guestKeyword}
						onSearchChange={(value) => {
							setGuestKeyword(value);
							guestTable.setPageIndex(0);
						}}
						searchPlaceholder="搜索备注 / 允许页面…"
						actions={<ColumnToggle table={guestTable} onPersist={persistGuestColumns} />}
					/>

					<LedgerCard
						title="访客令牌"
						Icon={KeyRound}
						count={guestFiltered.length}
						busy={tokensQuery.isFetching}
						emptyText="还没有外链令牌 —— 点右上角「新增令牌」签发一条"
						table={guestTable}
					/>
				</TabsContent>
			</Tabs>

			{/* ── 用户台账的三态弹窗(放 Tabs 外:切 Tab 不会把开着的弹窗卸掉)── */}
			<SettingsUsersDetail
				row={dialogs.viewing}
				open={dialogs.viewingOpen}
				onOpenChange={(next) => {
					if (!next) dialogs.setViewing(null);
				}}
				onEdit={(row) => {
					dialogs.openEdit(row);
				}}
			/>

			<SettingsUsersForm
				user={dialogs.editing}
				creating={dialogs.editing === null}
				open={dialogs.formOpen}
				pending={createMutation.isPending || updateMutation.isPending}
				roles={roles}
				departments={departmentOptions}
				onOpenChange={(next) => {
					if (next) return;
					dialogs.setCreateOpen(false);
					dialogs.setEditing(null);
				}}
				onSubmit={(payload: UserFormPayload) => {
					if (dialogs.editing) {
						// 覆盖式:角色与部门传进去的就是最终状态
						updateMutation.mutate({
							id: dialogs.editing.id,
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
				open={dialogs.confirmOpen}
				onOpenChange={dialogs.closeConfirm}
				title="删除账号"
				description={`确认删除「${dialogs.pendingDelete?.email ?? ""}」?会同时清掉它的登录会话、密码记录、部门成员关系与角色分配(账号行保留为「已删除」,审计留痕)。`}
				isPending={deleteMutation.isPending}
				onConfirm={() => {
					if (dialogs.pendingDelete) deleteMutation.mutate({ ids: [dialogs.pendingDelete.id] });
				}}
			/>

			{/* ── 访客令牌的三态弹窗(凭证表硬删,确认文案说清"不可恢复")── */}
			<SettingsGuestsDetail
				row={guestDialogs.viewing}
				open={guestDialogs.viewingOpen}
				onOpenChange={(next) => {
					if (!next) guestDialogs.setViewing(null);
				}}
				onEdit={(row) => {
					guestDialogs.openEdit(row);
				}}
			/>

			<SettingsGuestsForm
				token={guestDialogs.editing}
				creating={guestDialogs.editing === null}
				open={guestDialogs.formOpen}
				pending={tokenCreateMutation.isPending || tokenUpdateMutation.isPending}
				onOpenChange={(next) => {
					if (next) return;
					guestDialogs.setCreateOpen(false);
					guestDialogs.setEditing(null);
				}}
				onSubmit={(payload: GuestFormPayload) => {
					if (guestDialogs.editing) {
						tokenUpdateMutation.mutate({ id: guestDialogs.editing.id, ...payload });
					} else {
						tokenCreateMutation.mutate(payload);
					}
				}}
			/>

			<ConfirmDialog
				open={guestDialogs.confirmOpen}
				onOpenChange={guestDialogs.closeConfirm}
				title="删除访客令牌"
				description={`确认删除「${guestDialogs.pendingDelete?.remark || "无备注"}」这条令牌?它签发的外链会**立即失效**,删除后不可恢复(审计留痕)。`}
				isPending={tokenDeleteMutation.isPending}
				onConfirm={() => {
					if (guestDialogs.pendingDelete) tokenDeleteMutation.mutate({ id: guestDialogs.pendingDelete.id });
				}}
			/>
		</PageFrame>
	);
}

/** 「复制链接」= 第一个允许页面 + 令牌拼出完整外链(允许页面没配时按钮本来就置灰) */
function copyShareLink(row: ShareTokenRow) {
	const path = row.allowedPaths[0];
	if (!path) return;
	const url = `${window.location.origin}${path}?share=${row.token}`;
	void navigator.clipboard.writeText(url).then(
		() => toast.success("外链已复制", { description: "发给外部人员即可免登查看;令牌停用 / 过期 / 删除后立即失效。" }),
		() => toast.error("复制失败,请手动复制令牌"),
	);
}
