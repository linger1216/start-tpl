import type { ExcelColumn } from "#/lib/excel";
import { formatLocalMinute } from "#/lib/time";

import { type LogRow, statusText } from "./settings-logs-table";

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

/**
 * 行 → 导出值:**页面上看到什么就导出什么**。
 *
 * 两处刻意与列定义不同:时间走 `formatLocalMinute`(与表格里的 `TimeCell` 同口径,ISO 串在 Excel 里
 * 又长又难读)、`status` 出中文(走表格里的 `statusText`,免得徽章与导出各写一遍)。缺值一律空串,
 * 不让 `null` 落进单元格。
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
