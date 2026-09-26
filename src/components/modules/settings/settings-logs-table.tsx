import { actionsColumn, TextCell } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { createAppColumnHelper } from "#/lib/table";
import { formatLocalMinute } from "#/lib/time";

/** 与 `trpc.log.list` 的出参一一对应(`sys_log` 的列,一个不少) */
export type LogRow = {
	id: string;
	traceId: string | null;
	path: string;
	label: string | null;
	type: string | null;
	operatorId: string | null;
	operatorName: string | null;
	ip: string | null;
	target: string | null;
	status: number;
	errorCode: string | null;
	errorMessage: string | null;
	input: string | null;
	durationMs: number | null;
	createTime: string | null;
};

const columnHelper = createAppColumnHelper<LogRow>();

/**
 * 审计日志的列定义 —— **只读台账**。
 *
 * 行操作只有「详情」:审计表是**只增不改**的,没有编辑 / 删除入口(清理按 `log.retention_days`
 * 交给定时任务)。这与文件管理页"行内三四个动作"不同,是刻意的。
 */
export function logColumns({ onView }: { onView: (row: LogRow) => void }) {
	return columnHelper.columns([
		columnHelper.accessor("createTime", {
			header: "时间",
			size: 150,
			cell: (ctx) => <span className="tabular-nums text-xs">{formatLocalMinute(ctx.getValue())}</span>,
		}),
		columnHelper.accessor("label", {
			header: "动作",
			size: 130,
			cell: (ctx) => (
				<span className="text-xs" title={ctx.row.original.path}>
					{ctx.getValue() ?? ctx.row.original.path}
				</span>
			),
		}),
		columnHelper.accessor("path", {
			header: "接口路径",
			size: 140,
			cell: (ctx) => <span className="font-mono text-xs text-muted-foreground">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("operatorName", {
			header: "操作人",
			size: 110,
			cell: (ctx) => (
				<span className="text-xs" title={ctx.row.original.operatorId ?? ""}>
					{ctx.getValue() ?? <span className="text-muted-foreground/60">系统 / 脚本</span>}
				</span>
			),
		}),
		columnHelper.accessor("type", { header: "类型", size: 90 }),
		columnHelper.accessor("status", {
			header: "结果",
			size: 90,
			cell: (ctx) => (
				<Badge variant={ctx.getValue() === 1 ? "secondary" : "destructive"}>
					{ctx.getValue() === 1 ? "成功" : "失败"}
				</Badge>
			),
		}),
		columnHelper.accessor("target", {
			header: "目标",
			size: 180,
			cell: (ctx) => <TextCell value={ctx.getValue()} />,
		}),
		columnHelper.accessor("errorCode", {
			header: "错误码",
			size: 120,
			cell: (ctx) => <span className="font-mono text-xs">{ctx.getValue() ?? "—"}</span>,
		}),
		columnHelper.accessor("errorMessage", {
			header: "错误信息",
			size: 200,
			cell: (ctx) => <TextCell value={ctx.getValue()} />,
		}),
		columnHelper.accessor("durationMs", {
			header: "耗时",
			size: 90,
			cell: (ctx) => (
				<span className="tabular-nums text-xs">{ctx.getValue() === null ? "—" : `${ctx.getValue()} ms`}</span>
			),
		}),
		columnHelper.accessor("ip", {
			header: "来源 IP",
			size: 130,
			cell: (ctx) => <span className="font-mono text-xs">{ctx.getValue() ?? "—"}</span>,
		}),
		columnHelper.accessor("traceId", {
			header: "追踪号",
			size: 150,
			cell: (ctx) => <span className="font-mono text-xs text-muted-foreground">{ctx.getValue() ?? "—"}</span>,
		}),
		columnHelper.accessor("input", {
			header: "入参快照",
			size: 220,
			cell: (ctx) => <TextCell value={ctx.getValue()} />,
		}),
		actionsColumn<LogRow>({
			size: 90,
			onView,
		}),
	]);
}
