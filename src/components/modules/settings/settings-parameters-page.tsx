import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog, Plus, SlidersHorizontal, Timer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsParametersCleanup } from "#/components/modules/settings/settings-parameters-cleanup";
import { SettingsParametersDetail } from "#/components/modules/settings/settings-parameters-detail";
import {
	type ParameterFormPayload,
	SettingsParametersForm,
} from "#/components/modules/settings/settings-parameters-form";
import { type ParameterRow, parameterColumns } from "#/components/modules/settings/settings-parameters-table";
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
 * 系统设置 ▸ 参数管理 —— 运维口径不写死在代码里。
 *
 * 现在这里管两类东西:
 * - **raw 保留**:已抽取的数据保留多久软删、软删后再多久物理删、每批清理多少行;
 * - **对接同步**:定时同步开关(默认关)、间隔、增量窗口重叠秒数。
 * 参数值改了**下一趟任务生效**,不需要重新发版。
 *
 * 支持**完整 CRUD**:新增(指定类型 / 分组 / 说明)、修改(按类型校验)、删除(回到默认值或彻底消失)。
 * 类型含 string / int / bool / json / array / map,json 类用多行 JSON 文本录入。
 */
export function SettingsParametersPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [keyword, setKeyword] = useState("");
	const [editing, setEditing] = useState<ParameterRow | null>(null);
	const [viewing, setViewing] = useState<ParameterRow | null>(null);
	const [creating, setCreating] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<ParameterRow | null>(null);

	const formOpen = editing !== null || creating;

	const listQuery = useQuery({ ...trpc.para.list.queryOptions(), placeholderData: keepPreviousData });
	const rows = (listQuery.data ?? []) as ParameterRow[];

	const updateMutation = useMutation(
		trpc.para.update.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.para.pathFilter());
				setEditing(null);
				toast.success(`已保存 ${outcome.key}`, { description: `新值:${outcome.value};下一趟任务生效。` });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const createMutation = useMutation(
		trpc.para.create.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.para.pathFilter());
				setCreating(false);
				toast.success(`已新增参数 ${outcome.key}`, { description: "下一趟任务生效。" });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const deleteMutation = useMutation(
		trpc.para.delete.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.para.pathFilter());
				setPendingDelete(null);
				toast.success(`已删除 ${outcome.key}`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	function handleSubmit(payload: ParameterFormPayload) {
		if (creating) {
			if (!payload.type) return;
			createMutation.mutate({
				key: payload.key,
				value: payload.value,
				type: payload.type,
				group: payload.group,
				remark: payload.remark,
				status: payload.status,
				editable: payload.editable,
			});
		} else if (payload.key) {
			// 编辑时把表单里的字段**全带上** —— 以前这里只传 value,分组/说明在界面上填了却不落库
			updateMutation.mutate({
				key: payload.key,
				value: payload.value,
				group: payload.group,
				remark: payload.remark,
				status: payload.status,
				editable: payload.editable,
			});
		}
	}

	const filtered = useMemo(
		() => rows.filter((row) => matchKeyword([row.key, row.group, row.remark], keyword)),
		[rows, keyword],
	);

	const columns = useMemo(
		() =>
			parameterColumns({
				onView: setViewing,
				onEdit: (row) => {
					setCreating(false);
					setEditing(row);
				},
				onDelete: setPendingDelete,
			}),
		[],
	);

	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		// 行标识用 `para_key`(`sys_para.id` 是库里的无意义短串,且"纯代码内置"的参数压根没落库)
		getRowId: (row) => row.key,
		prefKey: "settings.parameters",
	});

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "total",
				label: "参数总数",
				value: rows.length,
				description: "库里的参数行 + 代码内置默认",
				Icon: SlidersHorizontal,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "条",
			},
			{
				key: "editable",
				label: "可编辑",
				value: rows.filter((row) => row.editable).length,
				description: "editable = 1,界面上能改",
				Icon: Cog,
				tone: "bg-hue-amber-soft text-hue-amber-fg",
				unit: "条",
			},
			{
				key: "sync",
				label: "定时同步",
				value: rows.find((row) => row.key === "sync.enabled")?.value === "true" ? "已开启" : "已关闭",
				description: "默认关闭:先手动跑通再打开",
				Icon: Timer,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
			},
		],
		[rows],
	);

	return (
		<PageFrame>
			<PageHeader
				title="参数管理"
				description="系统设置 ▸ 参数管理:raw 保留策略(软删 / 物理删)与对接同步开关都在这儿调。支持字符串 / 整数 / 开关 / JSON / 数组 / 映射六种类型,参数改了下一趟任务生效,不需要发版。"
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
							新增参数
						</Button>
					</div>
				}
			/>

			<StatCards items={stats} />

			<SettingsParametersCleanup />

			<LedgerToolbar
				search={keyword}
				onSearchChange={(value) => {
					setKeyword(value);
					table.setPageIndex(0);
				}}
				searchPlaceholder="搜索参数名 / 分组 / 说明…"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>

			<LedgerCard
				title="参数清单"
				Icon={SlidersHorizontal}
				count={filtered.length}
				busy={listQuery.isFetching}
				emptyText="没有符合条件的参数"
				table={table}
			/>

			<SettingsParametersForm
				row={editing}
				creating={creating}
				open={formOpen}
				pending={updateMutation.isPending || createMutation.isPending}
				onOpenChange={(next) => {
					if (!next) {
						setEditing(null);
						setCreating(false);
					}
				}}
				onSubmit={handleSubmit}
			/>

			<SettingsParametersDetail
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

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除参数"
				description={`确认删除参数「${pendingDelete?.key}」?代码内置的参数会回到默认值,界面新建的参数会彻底消失。`}
				onConfirm={() => pendingDelete && deleteMutation.mutate({ key: pendingDelete.key })}
			/>
		</PageFrame>
	);
}
