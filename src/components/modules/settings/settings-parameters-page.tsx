import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog, Plus, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsParametersDetail } from "#/components/modules/settings/settings-parameters-detail";
import { PARA_EXCEL_COLUMNS, paraExcelRows } from "#/components/modules/settings/settings-parameters-excel";
import {
	type ParameterFormPayload,
	SettingsParametersForm,
} from "#/components/modules/settings/settings-parameters-form";
import { type ParameterRow, parameterColumns } from "#/components/modules/settings/settings-parameters-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { ExcelExportButton, ExcelImportButton } from "#/components/modules/shared/excel-actions";
import { LedgerCard } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useLedgerTable } from "#/hooks/use-ledger-table";
import { writeError, writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { matchKeyword } from "#/lib/table";

/**
 * 系统设置 ▸ 参数管理 —— 运维口径与界面偏好不写死在代码里。
 *
 * 页面**只展示数据库里的参数行**(`sys_para`)加代码内置默认值,不附带任何"后台任务"入口。
 * 每条参数被谁读、读来干什么,看 `lib/sys-para.ts` 的 `PARA_DEFAULTS` 注释。
 *
 * 支持**完整 CRUD**:新增(指定类型 / 分组 / 说明)、修改(按类型校验)、删除(回到默认值;自建的那行被软删,
 * 记录留着、参数名让位可以再建 —— 见 `lib/soft-delete.ts`)。
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

	/** 写完数据后让列表重新拉一次(与角色 / 字典页同形) */
	const invalidate = () => queryClient.invalidateQueries(trpc.para.pathFilter());

	const updateMutation = useMutation(
		trpc.para.update.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => setEditing(null),
				message: (o) => `已保存 ${o.key}`,
				description: (o) => `新值:${o.value}`,
			}),
			onError: writeError,
		}),
	);

	const createMutation = useMutation(
		trpc.para.create.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setCreating(false), message: (o) => `已新增参数 ${o.key}` }),
			onError: writeError,
		}),
	);

	const deleteMutation = useMutation(
		trpc.para.remove.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => setPendingDelete(null),
				message: (o) => `已删除 ${o.removed} 条参数`,
			}),
			onError: writeError,
		}),
	);

	// 导入的成败提示归对话框(整批错进警告区、逐行错进明细),这里只管把清单刷成最新的
	const importMutation = useMutation(
		trpc.para.import.mutationOptions({
			onSuccess: async () => {
				await invalidate();
			},
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

	// 导出的是**当前筛选结果**(与卡头「匹配 N 条」同源)
	const excelRows = useMemo(() => paraExcelRows(filtered), [filtered]);

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
		],
		[rows],
	);

	return (
		<PageFrame>
			<PageHeader
				title="参数管理"
				description="系统设置 ▸ 参数管理:这里只展示数据库里的参数行(库里没有的按代码内置默认值展示)。支持字符串 / 整数 / 开关 / JSON / 数组 / 映射六种类型,改动即时写库。"
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

			<LedgerToolbar
				search={keyword}
				onSearchChange={(value) => {
					setKeyword(value);
					table.setPageIndex(0);
				}}
				searchPlaceholder="搜索参数名 / 分组 / 说明…"
				actions={
					<>
						<ColumnToggle table={table} onPersist={persistColumns} />
						<ExcelExportButton columns={PARA_EXCEL_COLUMNS} rows={excelRows} fileName="参数" />
						<ExcelImportButton
							title="导入参数"
							description="一行 = 一条参数(参数名是业务键)。库里没有的建、已有的改值;代码内置的参数会跳过并报错,值会按类型校验。"
							fields={PARA_EXCEL_COLUMNS}
							fileNamePrefix="参数导入模板"
							onImport={(importRows) => importMutation.mutateAsync({ rows: importRows })}
						/>
					</>
				}
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
				description={`确认删除参数「${pendingDelete?.key}」?代码内置的参数会回到默认值;界面新建的参数会被删除(记录保留为「已删除」,同一个参数名还能再建)。`}
				isPending={deleteMutation.isPending}
				onConfirm={() => pendingDelete && deleteMutation.mutate({ keys: [pendingDelete.key] })}
			/>
		</PageFrame>
	);
}
