import type { LogRow } from "#/components/modules/settings/settings-logs-table";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { Badge } from "#/components/ui/badge";
import { DetailRow } from "#/components/ui/detail-row";

/**
 * 审计日志详情 —— 只读。
 *
 * 与文件详情同形(`DetailDialog` + 单列 `DetailRow`),差别只有两处:
 *  · **没有 `onEdit`** —— 审计行不可改;
 *  · 入参快照用 `<pre>` 原样展示(它本来就是一段 JSON 文本)。
 * 时间不进字段列表:由 `DetailDialog` 的 `meta` 渲染在底部那行。
 */
export function SettingsLogsDetail({
	row,
	open,
	onOpenChange,
}: {
	row: LogRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
}) {
	return (
		<DetailDialog
			open={open}
			onOpenChange={onOpenChange}
			title={row?.label ?? row?.path ?? "审计详情"}
			description={row?.path}
			badge={
				row ? (
					<Badge variant={row.status === 1 ? "secondary" : "destructive"}>{row.status === 1 ? "成功" : "失败"}</Badge>
				) : null
			}
			meta={{ createdAt: row?.createTime ?? null }}
		>
			{row ? (
				<>
					<DetailRow label="动作">{row.label ?? "—"}</DetailRow>
					<DetailRow label="接口路径">
						<span className="font-mono text-[12.5px]">{row.path}</span>
					</DetailRow>
					<DetailRow label="类型">{row.type ?? "—"}</DetailRow>
					<DetailRow label="操作人">
						{row.operatorName ? (
							<>
								{row.operatorName}
								<span className="ml-2 font-mono text-[12px] text-muted-foreground">{row.operatorId ?? ""}</span>
							</>
						) : (
							<span className="text-muted-foreground">系统 / 脚本(无请求上下文)</span>
						)}
					</DetailRow>
					<DetailRow label="目标">{row.target ?? "—"}</DetailRow>
					<DetailRow label="耗时">{row.durationMs === null ? "—" : `${row.durationMs} ms`}</DetailRow>
					<DetailRow label="来源 IP">
						<span className="font-mono text-[12.5px]">{row.ip ?? "—"}</span>
					</DetailRow>
					<DetailRow label="追踪号">
						<span className="font-mono text-[12.5px]">{row.traceId ?? "—"}</span>
						<span className="ml-2 text-[12px] text-muted-foreground">
							与后端 stdout 日志同值,可串起一次调用的全部日志
						</span>
					</DetailRow>
					{row.status === 0 ? (
						<>
							<DetailRow label="错误码">
								<span className="font-mono text-[12.5px]">{row.errorCode ?? "—"}</span>
							</DetailRow>
							<DetailRow label="错误信息">{row.errorMessage ?? "—"}</DetailRow>
						</>
					) : null}
					<div className="space-y-1 py-2">
						<div className="text-[12px] font-medium text-muted-foreground">入参快照(写入前已脱敏)</div>
						<pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-[12px] break-all whitespace-pre-wrap">
							{row.input ?? "(无入参)"}
						</pre>
					</div>
				</>
			) : null}
		</DetailDialog>
	);
}
