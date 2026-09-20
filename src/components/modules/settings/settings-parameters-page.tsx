import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog, RefreshCw, SlidersHorizontal, Timer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "#/components/layout/page-header";
import { SettingsParametersCleanup } from "#/components/modules/settings/settings-parameters-cleanup";
import { SettingsParametersForm } from "#/components/modules/settings/settings-parameters-form";
import { type ParameterRow, SettingsParametersTable } from "#/components/modules/settings/settings-parameters-table";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { TableLoadingShell } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";

/**
 * 系统设置 ▸ 参数管理 —— 运维口径不写死在代码里。
 *
 * 现在这里管两类东西:
 * - **raw 保留**:已抽取的数据保留多久软删、软删后再多久物理删、每批清理多少行;
 * - **对接同步**:定时同步开关(默认关)、间隔、增量窗口重叠秒数。
 * 参数值改了**下一趟任务生效**,不需要重新发版。
 */
export function SettingsParametersPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [keyword, setKeyword] = useState("");
	const [editing, setEditing] = useState<ParameterRow | null>(null);

	const listQuery = useQuery({ ...trpc.config.list.queryOptions(), placeholderData: keepPreviousData });
	const rows = (listQuery.data ?? []) as ParameterRow[];

	const updateMutation = useMutation(
		trpc.config.update.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.config.pathFilter());
				setEditing(null);
				toast.success(`已保存 ${outcome.key}`, { description: `新值:${outcome.value};下一趟任务生效。` });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const filtered = useMemo(() => {
		const key = keyword.trim();
		if (!key) return rows;
		return rows.filter((row) => `${row.key} ${row.group} ${row.remark}`.includes(key));
	}, [rows, keyword]);

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "total",
				label: "参数总数",
				value: rows.length,
				description: "代码内置 + 库里覆盖",
				Icon: SlidersHorizontal,
				tone: "bg-secondary text-foreground",
				unit: "条",
			},
			{
				key: "changed",
				label: "已改过",
				value: rows.filter((row) => row.overridden).length,
				description: "被改过、不再是默认值的",
				Icon: Cog,
				tone: "bg-secondary text-foreground",
				unit: "条",
			},
			{
				key: "sync",
				label: "定时同步",
				value: rows.find((row) => row.key === "sync.enabled")?.value === "true" ? "已开启" : "已关闭",
				description: "默认关闭:先手动跑通再打开",
				Icon: Timer,
				tone: "bg-secondary text-foreground",
			},
		],
		[rows],
	);

	return (
		<div className="space-y-4">
			<PageHeader
				title="参数管理"
				description="系统设置 ▸ 参数管理:raw 保留策略(软删 / 物理删)与对接同步开关都在这儿调。参数改了下一趟任务生效,不需要发版。"
				actions={
					<Button variant="outline" size="sm" disabled={listQuery.isFetching} onClick={() => void listQuery.refetch}>
						<RefreshCw className={listQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
						刷新
					</Button>
				}
			/>

			<StatCards items={stats} />

			<SettingsParametersCleanup />

			<Card className="gap-4 hover:border-border hover:shadow-none">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<SlidersHorizontal className="size-4 text-muted-foreground" />
						参数清单
					</CardTitle>
					<Badge variant="outline" className="tabular-nums">
						匹配 {filtered.length} 条
					</Badge>
				</CardHeader>
				<CardContent className="space-y-3">
					<LedgerToolbar search={keyword} onSearchChange={setKeyword} searchPlaceholder="搜索参数名 / 分组 / 说明…" />
					<TableLoadingShell busy={listQuery.isFetching} minHeight={240}>
						<SettingsParametersTable rows={filtered} onEdit={setEditing} />
					</TableLoadingShell>
				</CardContent>
			</Card>

			<SettingsParametersForm
				row={editing}
				open={editing !== null}
				pending={updateMutation.isPending}
				onOpenChange={(next) => {
					if (!next) setEditing(null);
				}}
				onSubmit={(key, value) => updateMutation.mutate({ key, value })}
			/>
		</div>
	);
}
