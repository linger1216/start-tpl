import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsLogsDetail } from "#/components/modules/settings/settings-logs-detail";
import { type LogRow, logColumns } from "#/components/modules/settings/settings-logs-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { DataTable, TableLoadingShell } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useColumnPrefs } from "#/hooks/use-column-prefs";
import { usePageSize } from "#/hooks/use-page-size";
import { useTRPC } from "#/integrations/trpc/react";
import { useAppTable } from "#/lib/table";

/**
 * 审计日志(只读台账)—— `/settings/logs`。
 *
 * **只读**是刻意的:审计表只增不改,页面没有新增 / 编辑 / 删除入口;
 * 清理按参数 `log.retention_days` 交给定时任务(还没做,见 `doc/审计日志.md`)。
 *
 * 列表**默认只取最近 200 条**(接口上限 500):审计增长很快,全量返回只是把压力换个地方;
 * 搜索框一端连着后端的多字段模糊匹配(动作名 / 路径 / 目标 / 操作人),要看得更久就用它收窄。
 */
export function SettingsLogsPage() {
	const trpc = useTRPC();
	const [keyword, setKeyword] = useState("");
	const [viewing, setViewing] = useState<LogRow | null>(null);

	const listQuery = useQuery(trpc.log.list.queryOptions());

	const rows = useMemo<LogRow[]>(() => listQuery.data ?? [], [listQuery.data]);
	const filtered = useMemo(() => {
		const key = keyword.trim().toLowerCase();
		if (!key) return rows;
		return rows.filter((row) =>
			`${row.label ?? ""} ${row.path} ${row.target ?? ""} ${row.operatorName ?? ""} ${row.traceId ?? ""}`
				.toLowerCase()
				.includes(key),
		);
	}, [rows, keyword]);

	const columns = useMemo(() => logColumns({ onView: setViewing }), []);

	const defaultPageSize = usePageSize();
	const table = useAppTable({
		columns,
		data: filtered,
		getRowId: (row) => row.id,
		initialState: { pagination: { pageIndex: 0, pageSize: defaultPageSize } },
	});
	const { pageIndex, pageSize } = table.state.pagination;
	// 列顺序 / 隐藏项存进参数 `page.columns`(与参数 / 用户 / 字典 / 文件页同一套)
	const { persist: persistColumns } = useColumnPrefs("settings.logs", table);

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "loaded",
				label: "本次加载",
				value: rows.length,
				description: "最近 200 条内;要更久请用搜索收窄",
				Icon: ScrollText,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "条",
			},
			{
				key: "ok",
				label: "成功",
				value: rows.filter((row) => row.status === 1).length,
				description: "调用正常返回",
				Icon: CircleCheck,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
				unit: "条",
			},
			{
				key: "failed",
				label: "失败",
				value: rows.filter((row) => row.status === 0).length,
				description: "含权限拒绝与业务报错",
				Icon: CircleX,
				tone: "bg-secondary text-foreground",
				unit: "条",
			},
		],
		[rows],
	);

	return (
		<PageFrame>
			<PageHeader
				title="审计日志"
				description="系统设置 ▸ 审计日志:每一次**写调用**是谁、什么时候、对什么、成功没有。写入由服务端中间件结构性完成(不靠每个接口记得加),这里只读 —— 清理按保留天数交给定时任务。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={listQuery.isFetching} onClick={() => void listQuery.refetch()} />
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
				searchPlaceholder="搜索动作 / 路径 / 目标 / 操作人 / 追踪号…"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>

			<Card className="flex min-h-104 flex-1 flex-col gap-4">
				<CardHeader className="flex-row items-center justify-between gap-3">
					<CardTitle className="flex items-center gap-2">
						<ScrollText className="size-4 text-muted-foreground" />
						操作记录
					</CardTitle>
					<div className="flex items-center gap-2">
						{listQuery.isFetching ? (
							<Badge variant="secondary" className="tabular-nums">
								读取中…
							</Badge>
						) : null}
						<Badge variant="outline" className="tabular-nums">
							匹配 {filtered.length} 条
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="flex min-h-0 flex-1 flex-col gap-3">
					<TableLoadingShell fill busy={listQuery.isFetching} minHeight={240}>
						<DataTable table={table} emptyText="这段时间还没有写操作" />
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

			<SettingsLogsDetail
				row={viewing}
				open={viewing !== null}
				onOpenChange={(next) => {
					if (!next) setViewing(null);
				}}
			/>
		</PageFrame>
	);
}
