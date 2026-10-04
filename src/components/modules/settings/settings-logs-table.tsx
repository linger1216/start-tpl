import { actionsColumn, TextCell, timeColumn } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import type { ExcelColumn } from "#/lib/excel";
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
 * 行操作只有「详情」:审计表是**只增不改**的,没有编辑 / 删除入口(清理策略由使用方自行决定)。
 * 这与文件管理页"行内三四个动作"不同,是刻意的。
 */
export function logColumns({ onView }: { onView: (row: LogRow) => void }) {
	return columnHelper.columns([
		timeColumn<LogRow>("createTime", { header: "时间" }),
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
				<Badge variant={ctx.getValue() === 1 ? "secondary" : "destructive"}>{statusText(ctx.getValue())}</Badge>
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

/** 导出列的业务字段名(与 `LOG_EXCEL_COLUMNS` 的 key 严格同集) */
type LogExcelKey =
	| "createTime"
	| "label"
	| "path"
	| "operatorName"
	| "type"
	| "status"
	| "target"
	| "errorCode"
	| "errorMessage"
	| "durationMs"
	| "ip"
	| "traceId"
	| "input";

/**
 * 审计日志的导出列契约 —— 表头与列宽的**唯一真源**(`ExcelColumn` 见 `lib/excel.ts`)。
 *
 * 与屏幕上的列同序同义,但少了「操作」列(导出不该带按钮文案);`status` 走 `logExcelRows` 转成
 * 「成功 / 失败」—— 导出给人看的,不该是一列 0 / 1(接口那边仍是 `0|1`,见 `log.list`)。
 */
export const LOG_EXCEL_COLUMNS: readonly ExcelColumn<LogExcelKey>[] = [
	{ key: "createTime", label: "时间", width: 20 },
	{ key: "label", label: "动作", width: 18 },
	{ key: "path", label: "接口路径", width: 26 },
	{ key: "operatorName", label: "操作人", width: 14 },
	{ key: "type", label: "类型", width: 10 },
	{ key: "status", label: "结果", width: 8 },
	{ key: "target", label: "目标", width: 30 },
	{ key: "errorCode", label: "错误码", width: 12 },
	{ key: "errorMessage", label: "错误信息", width: 40 },
	{ key: "durationMs", label: "耗时(ms)", width: 12 },
	{ key: "ip", label: "来源 IP", width: 16 },
	{ key: "traceId", label: "追踪号", width: 34 },
	{ key: "input", label: "入参快照", width: 40 },
];

/** 状态码 → 中文(列里的徽章与导出的单元格共用一份,免得两处各写一遍 1 ? 成功 : 失败) */
const statusText = (status: number) => (status === 1 ? "成功" : "失败");

/**
 * 行 → 导出值:**页面上看到什么就导出什么**。
 *
 * 两处刻意与列定义不同:时间走 `formatLocalMinute`(与表格里的 `TimeCell` 同口径,ISO 串在 Excel 里
 * 又长又难读)、`status` 出中文。缺值一律空串,不让 `null` 落进单元格。
 */
export function logExcelRows(rows: readonly LogRow[]): Array<Record<LogExcelKey, string | number>> {
	return rows.map((row) => ({
		createTime: formatLocalMinute(row.createTime),
		label: row.label ?? "",
		path: row.path,
		operatorName: row.operatorName ?? "",
		type: row.type ?? "",
		status: statusText(row.status),
		target: row.target ?? "",
		errorCode: row.errorCode ?? "",
		errorMessage: row.errorMessage ?? "",
		durationMs: row.durationMs ?? "",
		ip: row.ip ?? "",
		traceId: row.traceId ?? "",
		input: row.input ?? "",
	}));
}
