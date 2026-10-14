import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, FlaskConical, Plus, ShieldAlert, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsDataScopeDetail } from "#/components/modules/settings/settings-data-scope-detail";
import {
	type DataScopeFormPayload,
	SettingsDataScopeForm,
} from "#/components/modules/settings/settings-data-scope-form";
import { SettingsDataScopePreviewDialog } from "#/components/modules/settings/settings-data-scope-preview-dialog";
import { type DataScopeRow, dataScopeColumns } from "#/components/modules/settings/settings-data-scope-table";
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
import { POLICY_STATUS, type PolicyStatus, policyStatusMeta } from "#/lib/data-scope-spec";
import { matchKeyword } from "#/lib/table";

/**
 * 系统设置 ▸ 数据范围 —— 行级可见范围(谁能看到哪张表的哪些行)。
 *
 * 与「权限」是两层东西:权限管**能不能调这个接口**(Casbin 的 `p, role:<id>, menu:<id>, access`),
 * 这张表管**调完之后能看见哪些行**。两层都要过,少一层没用。
 *
 * 规则的三档形态(整类可见 / `列 ∈ 插件(我)` / `主键 ∈ 插件(我, 资源)`)由值域插件决定;
 * 规则里**不存人**,存的是 `role:<id>` / `dept:<id>` / `user:<id>`,所以调岗换角色不用回刷规则。
 *
 * **写规则和开规则是两步**:新增 / 改过形态的规则落「启用」(2),引擎不加载它;
 * 行内点「预览」拿真实数据算一遍(`dataScope.trial`),行数对了再点「上线」—— 那时才影响系统。
 */
export function SettingsDataScopePage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [keyword, setKeyword] = useState("");
	const [editing, setEditing] = useState<DataScopeRow | null>(null);
	const [viewing, setViewing] = useState<DataScopeRow | null>(null);
	const [creating, setCreating] = useState(false);
	const [previewing, setPreviewing] = useState<DataScopeRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<DataScopeRow | null>(null);

	const formOpen = editing !== null || creating;

	const listQuery = useQuery({ ...trpc.dataScope.list.queryOptions(), placeholderData: keepPreviousData });
	const rows = (listQuery.data ?? []) as DataScopeRow[];

	const createMutation = useMutation(
		trpc.dataScope.create.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.dataScope.pathFilter());
				setCreating(false);
				toast.success("已新增数据范围规则", {
					description: "现在是「启用」,引擎还不加载它 —— 点这一行的「预览」算一遍,对了再「上线」。",
				});
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const updateMutation = useMutation(
		trpc.dataScope.update.mutationOptions({
			onSuccess: async (data) => {
				await queryClient.invalidateQueries(trpc.dataScope.pathFilter());
				setEditing(null);
				if (data.demoted) {
					toast.warning("形态改过了,规则退回「启用」", {
						description: "改完的和预览过的已经不是一回事 —— 再点「预览」算一次,对了再上线。",
					});
					return;
				}
				toast.success("已保存数据范围规则", { description: "缓存 30 秒内过期,之后按新规则筛行。" });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	// 行内「启用 / 上线 / 停用」—— 走的还是 `update`,只挪 `status`(所以权限点仍是「编辑」)
	const statusMutation = useMutation(
		trpc.dataScope.update.mutationOptions({
			onSuccess: async (data) => {
				await queryClient.invalidateQueries(trpc.dataScope.pathFilter());
				const meta = policyStatusMeta(Number(data.status));
				toast.success(`已${meta.label}这条规则`, { description: meta.hint });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const removeMutation = useMutation(
		trpc.dataScope.remove.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.dataScope.pathFilter());
				setPendingDelete(null);
				toast.success("已删除数据范围规则");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	function handleSubmit(payload: DataScopeFormPayload) {
		if (creating) {
			createMutation.mutate(payload);
		} else if (editing) {
			updateMutation.mutate({ id: editing.id, ...payload });
		}
	}

	const filtered = useMemo(
		() =>
			rows.filter((row) =>
				matchKeyword(
					[row.subjectLabel, row.subject, row.resource, row.resourceLabel, row.remark, row.pluginKey ?? ""],
					keyword,
				),
			),
		[rows, keyword],
	);

	const callbacks = useMemo(
		() => ({
			onPreview: setPreviewing,
			onView: setViewing,
			onEdit: (row: DataScopeRow) => {
				setCreating(false);
				setEditing(row);
			},
			onDelete: setPendingDelete,
			onStatus: (row: DataScopeRow, status: PolicyStatus) => statusMutation.mutate({ id: row.id, status }),
		}),
		[statusMutation],
	);

	const columns = useMemo(
		() =>
			dataScopeColumns({
				onPreview: callbacks.onPreview,
				onView: callbacks.onView,
				onEdit: callbacks.onEdit,
				onDelete: callbacks.onDelete,
				onStatus: callbacks.onStatus,
			}),
		[callbacks],
	);

	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		getRowId: (row) => row.id,
		prefKey: "settings.data-scope",
	});

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "total",
				label: "规则总数",
				value: rows.length,
				description: "上线的才参与计算",
				Icon: ShieldAlert,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "条",
			},
			{
				key: "live",
				label: "已上线",
				value: rows.filter((row) => Number(row.status) === POLICY_STATUS.live).length,
				description: "一条上线的规则都没有 ⇒ 不筛行(所有人都看全部)",
				Icon: Users,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
				unit: "条",
			},
			{
				key: "enabled",
				label: "启用未上线",
				value: rows.filter((row) => Number(row.status) === POLICY_STATUS.enabled).length,
				description: "新建 / 改过形态的都先落这儿,行内「预览」算对了再「上线」",
				Icon: FlaskConical,
				tone: "bg-hue-amber-soft text-hue-amber-fg",
				unit: "条",
			},
			{
				key: "resources",
				label: "覆盖资源表",
				value: new Set(rows.map((row) => row.resource)).size,
				description: "现在只有 demo_grid 真的接了行级过滤",
				Icon: Cable,
				tone: "bg-hue-violet-soft text-hue-violet-fg",
				unit: "张",
			},
		],
		[rows],
	);

	return (
		<PageFrame>
			<PageHeader
				title="数据范围"
				description="系统设置 ▸ 数据范围:行级可见范围。规则说的是「谁 · 看哪张表的哪些行」,「哪些行」由值域插件算出来(<列 ∈ 插件(我)> 或 <主键 ∈ 插件(我)>);一条上线的规则都没有时不筛行。新增 / 改过形态的规则先落「启用」(引擎不加载),行内点「预览」算一遍,对了再「上线」。"
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
							新增规则
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
				searchPlaceholder="搜索主体 / 资源表 / 说明…"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>

			<LedgerCard
				title="规则清单"
				Icon={ShieldAlert}
				count={filtered.length}
				busy={listQuery.isFetching}
				emptyText="还没有数据范围规则 —— 现在所有人看全部;要收范围就点右上角「新增规则」"
				table={table}
			/>

			<SettingsDataScopeForm
				row={editing}
				creating={creating}
				open={formOpen}
				pending={createMutation.isPending || updateMutation.isPending}
				onOpenChange={(next: boolean) => {
					if (!next) {
						setEditing(null);
						setCreating(false);
					}
				}}
				onSubmit={handleSubmit}
			/>

			<SettingsDataScopeDetail
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

			<SettingsDataScopePreviewDialog
				row={previewing}
				open={previewing !== null}
				onOpenChange={(next) => {
					if (!next) setPreviewing(null);
				}}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除数据范围规则"
				description={`确认删除「${pendingDelete?.subjectLabel ?? ""} · ${pendingDelete?.resourceLabel ?? ""}」这条规则?删掉之后这条范围就不再生效。`}
				isPending={removeMutation.isPending}
				pendingText="删除中…"
				onConfirm={() => pendingDelete && removeMutation.mutate({ ids: [pendingDelete.id] })}
			/>
		</PageFrame>
	);
}
