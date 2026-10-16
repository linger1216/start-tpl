import type { LogRow } from "#/components/modules/settings/settings-logs-table";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import { Tag } from "#/components/ui/tag";

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
			tag={
				row ? (
					<Tag variant={row.status === 1 ? "secondary" : "destructive"}>{row.status === 1 ? "成功" : "失败"}</Tag>
				) : null
			}
			meta={{ createdAt: row?.createTime ?? null }}
		>
			{row ? (
				<>
					<DetailRow label="动作">{row.label ?? "—"}</DetailRow>
					<DetailRow label="接口路径">
						<span className="font-mono text-xs">{row.path}</span>
					</DetailRow>
					<DetailRow label="类型">{row.type ?? "—"}</DetailRow>
					<DetailRow label="操作人">
						{row.operatorName ? (
							<>
								{row.operatorName}
								<span className="ml-2 font-mono text-xs text-muted-foreground">{row.operatorId ?? ""}</span>
							</>
						) : (
							<span className="text-muted-foreground">系统 / 脚本(无请求上下文)</span>
						)}
					</DetailRow>
					<DetailRow label="目标">{row.target ?? "—"}</DetailRow>
					<DetailRow label="耗时">{row.durationMs === null ? "—" : `${row.durationMs} ms`}</DetailRow>
					<DetailRow label="来源 IP">
						<span className="font-mono text-xs">{row.ip ?? "—"}</span>
					</DetailRow>
					<DetailRow label="追踪号">
						<span className="font-mono text-xs">{row.traceId ?? "—"}</span>
						<span className="ml-2 text-xs text-muted-foreground">与后端 stdout 日志同值,可串起一次调用的全部日志</span>
					</DetailRow>
					{row.status === 0 ? (
						<>
							<DetailRow label="错误码">
								<span className="font-mono text-xs">{row.errorCode ?? "—"}</span>
							</DetailRow>
							<DetailRow label="错误信息">{row.errorMessage ?? "—"}</DetailRow>
						</>
					) : null}
					<div className="space-y-1 py-2">
						<div className="text-xs font-medium text-muted-foreground">入参快照(写入前已脱敏)</div>
						<pre className="code-block max-h-64 rounded-lg bg-muted/40 p-2.5 break-all">{row.input ?? "(无入参)"}</pre>
					</div>
				</>
			) : null}
		</DetailDialog>
	);
}
