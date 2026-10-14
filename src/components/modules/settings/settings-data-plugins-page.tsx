import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsDataPluginsDetail } from "#/components/modules/settings/settings-data-plugins-detail";
import {
	type PluginFormPayload,
	SettingsDataPluginsForm,
} from "#/components/modules/settings/settings-data-plugins-form";
import { SettingsDataPluginsPreviewDialog } from "#/components/modules/settings/settings-data-plugins-preview-dialog";
import { type PluginRow, pluginColumns } from "#/components/modules/settings/settings-data-plugins-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { LedgerCard } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useLedgerTable } from "#/hooks/use-ledger-table";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { matchKeyword } from "#/lib/table";

/**
 * 系统设置 ▸ 值域插件 —— 回答「对**这个人**,哪些值算他的」。
 *
 * v2 (m20034)起:用户只能建「指定清单」类插件 —— 直接编辑 `output_values: [{key, value}]`,
 * 没有「写一段函数体」那档子;内置 4 个插件写在代码里(`self` / `my_departments` /
 * `my_dept_ancestors` / `my_street`),界面上只读。
 *
 * 「**新增**」按钮对所有登录用户显示(`m21097` / `m21161` 定稿:值域插件的增删改只跟
 * `sys:plugin:add` / `edit` / `remove` 权限点走,不再另加超管门槛 —— 被授权点的人就是能改的人)。
 *
 * 每次写完清插件缓存,不用重启服务。
 */
export function SettingsDataPluginsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [keyword, setKeyword] = useState("");
	const [editing, setEditing] = useState<PluginRow | null>(null);
	const [viewing, setViewing] = useState<PluginRow | null>(null);
	const [creating, setCreating] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<PluginRow | null>(null);
	const [forceDelete, setForceDelete] = useState(false);
	const [testing, setTesting] = useState<PluginRow | null>(null);

	const formOpen = editing !== null || creating;

	const listQuery = useQuery({ ...trpc.dataPlugin.list.queryOptions(), placeholderData: keepPreviousData });

	const rows: PluginRow[] = useMemo(() => {
		const data = listQuery.data;
		if (!data) return [];
		const builtin: PluginRow[] = data.builtin.map((item) => ({
			kind: "builtin",
			id: item.key,
			pluginKey: item.key,
			label: item.label,
			outputValues: [],
			status: 1,
			remark: item.remark ?? "",
			createdAt: null,
			updatedAt: null,
		}));
		const custom: PluginRow[] = data.custom.map((item) => ({
			kind: "custom",
			id: item.id,
			pluginKey: item.pluginKey,
			label: item.label,
			outputValues: item.outputValues,
			status: Number(item.status),
			remark: item.remark,
			createdAt: item.createdAt,
			updatedAt: item.updatedAt,
		}));
		return [...builtin, ...custom];
	}, [listQuery.data]);

	const createMutation = useMutation(
		trpc.dataPlugin.create.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.dataPlugin.pathFilter());
				setCreating(false);
				toast.success(`已新增插件 ${outcome.pluginKey}`, { description: "立即可用,不用重启服务。" });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const updateMutation = useMutation(
		trpc.dataPlugin.update.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.dataPlugin.pathFilter());
				setEditing(null);
				toast.success(`已保存插件 ${outcome.pluginKey}`, { description: "缓存 30 秒内过期,以后按新定义取数。" });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const removeMutation = useMutation(
		trpc.dataPlugin.remove.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.dataPlugin.pathFilter());
				await queryClient.invalidateQueries(trpc.dataScope.pathFilter());
				setPendingDelete(null);
				setForceDelete(false);
				toast.success(`已删除 ${outcome.removed} 个插件`);
			},
			onError: (error) => {
				const message = toApiError(error).message;
				// 头一次删被"还有规则在用"挡下 ⇒ 记住这次失败,同一个弹窗再点一次就是强制删(不用另做勾选框)
				if (message.includes("强制删除")) setForceDelete(true);
				toast.error(message);
			},
		}),
	);

	function handleSubmit(payload: PluginFormPayload) {
		if (creating) {
			createMutation.mutate(payload);
		} else if (editing) {
			updateMutation.mutate({
				pluginKey: editing.pluginKey,
				label: payload.label,
				outputValues: payload.outputValues,
				remark: payload.remark ?? null,
				status: payload.status,
			});
		}
	}

	const filtered = useMemo(
		() => rows.filter((row) => matchKeyword([row.label, row.pluginKey, row.remark], keyword)),
		[rows, keyword],
	);

	const columns = useMemo(
		() =>
			pluginColumns({
				onView: setViewing,
				onEdit: (row) => {
					setCreating(false);
					setEditing(row);
				},
				onDelete: (row) => {
					setForceDelete(false);
					setPendingDelete(row);
				},
				onTest: (row) => {
					setTesting(row);
				},
			}),
		[],
	);

	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		getRowId: (row) => `${row.kind}:${row.pluginKey}`,
		prefKey: "settings.data-plugins",
	});

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "builtin",
				label: "内置插件",
				value: rows.filter((row) => row.kind === "builtin").length,
				description: "写死在代码里,界面上只读",
				Icon: Cable,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "个",
			},
			{
				key: "custom",
				label: "自定义插件",
				value: rows.filter((row) => row.kind === "custom").length,
				description: "存在库里的一段清单,改完即生效",
				Icon: Users,
				tone: "bg-hue-violet-soft text-hue-violet-fg",
				unit: "个",
			},
		],
		[rows],
	);

	return (
		<PageFrame>
			<PageHeader
				title="值域插件"
				description="系统设置 ▸ 值域插件:数据范围规则里那个「我」到底包含哪些值。四种内置插件只读(写在代码里);自定义插件只能写「指定清单」(`output_values`),不能写代码 —— 改完即生效,不用重启服务。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={listQuery.isFetching} onClick={() => void listQuery.refetch()} />
						<Button
							size="sm"
							onClick={() => {
								setEditing(null);
								setCreating(true);
							}}
						>
							<Plus className="size-3.5" />
							新增插件
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
				searchPlaceholder="搜索插件名 / 标识 / 说明…"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>

			<LedgerCard
				title="插件清单"
				Icon={Cable}
				count={filtered.length}
				busy={listQuery.isFetching}
				showSkeleton={listQuery.isPending}
				emptyText="没有符合条件的插件"
				table={table}
			/>

			<SettingsDataPluginsForm
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
				onSubmit={handleSubmit}
			/>

			<SettingsDataPluginsDetail
				row={viewing}
				open={viewing !== null}
				onOpenChange={(next) => {
					if (!next) setViewing(null);
				}}
				onEdit={(row) => {
					setViewing(null);
					setCreating(false);
					setEditing(row);
				}}
			/>

			<SettingsDataPluginsPreviewDialog
				row={testing}
				open={testing !== null}
				onOpenChange={(next) => {
					if (!next) setTesting(null);
				}}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) {
						setPendingDelete(null);
						setForceDelete(false);
					}
				}}
				title="删除值域插件"
				confirmText={forceDelete ? "强制删除" : "删除"}
				isPending={removeMutation.isPending}
				description={
					forceDelete
						? `「${pendingDelete?.label ?? ""}」还有启用中的规则在用。再确认一次就是**强制删除** —— 那些规则会变成「一行也看不到」(失败关闭,不是放行)。`
						: `确认删除插件「${pendingDelete?.label ?? ""}」(${pendingDelete?.pluginKey ?? ""})?还有启用中的规则在用它时会被拒绝,并把条数告诉你。`
				}
				onConfirm={() =>
					pendingDelete &&
					removeMutation.mutate({
						pluginKeys: [pendingDelete.pluginKey],
						force: forceDelete || undefined,
					})
				}
			/>
		</PageFrame>
	);
}
