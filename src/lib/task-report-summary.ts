/** 输入必须来自当前有效提交；每一行均带完整来源，汇总始终可重算。 */
export type TaskReportSource = {
	taskId: string;
	executorId: string;
	submissionId: string;
	submittedAt: string;
	rowIndex: number;
};
export type TaskReportSummaryRow = { values: Record<string, unknown>; sources: TaskReportSource[] };
export type TaskReportSummaryInput = {
	taskId: string;
	executorId: string;
	submissionId: string;
	submittedAt: string;
	payload: unknown;
};
export type TaskReportSummaryOptions =
	| { strategy: "APPEND_ROWS" }
	| { strategy: "MERGE_BY_KEY"; keys: string[] }
	| {
			strategy: "AGGREGATE";
			keys: string[];
			metrics: Array<{ field: string; operation: "sum" | "count" | "average" }>;
	  };

export function summarizeTaskReports(records: TaskReportSummaryInput[], options: TaskReportSummaryOptions) {
	const rows: TaskReportSummaryRow[] = [];
	for (const record of [...records].sort((a, b) => a.taskId.localeCompare(b.taskId))) {
		const payload = Array.isArray(record.payload) ? record.payload : [record.payload];
		for (const [rowIndex, value] of payload.entries()) {
			if (!value || typeof value !== "object" || Array.isArray(value)) continue;
			rows.push({
				values: value as Record<string, unknown>,
				sources: [
					{
						taskId: record.taskId,
						executorId: record.executorId,
						submissionId: record.submissionId,
						submittedAt: record.submittedAt,
						rowIndex,
					},
				],
			});
		}
	}
	if (options.strategy === "APPEND_ROWS")
		return {
			rows,
			conflicts: [] as Array<{ field: string; first: TaskReportSource; other: TaskReportSource; message: string }>,
		};
	const conflicts: Array<{ field: string; first: TaskReportSource; other: TaskReportSource; message: string }> = [];
	const groups = new Map<string, TaskReportSummaryRow[]>();
	for (const row of rows) {
		const values = options.keys.map((key) => row.values[key]);
		if (values.some((value) => value === null || value === undefined || value === "" || typeof value === "object")) {
			conflicts.push({
				field: options.keys.join(","),
				first: row.sources[0],
				other: row.sources[0],
				message: "业务键缺失或不是标量",
			});
			continue;
		}
		const key = JSON.stringify(values);
		groups.set(key, [...(groups.get(key) ?? []), row]);
	}
	const result: TaskReportSummaryRow[] = [];
	for (const group of groups.values()) {
		const first = group[0];
		const sources = group.flatMap((row) => row.sources);
		if (options.strategy === "MERGE_BY_KEY") {
			const merged = { ...first.values };
			for (const row of group.slice(1))
				for (const [field, value] of Object.entries(row.values)) {
					if (value === null || value === undefined || value === "") continue;
					if (merged[field] === null || merged[field] === undefined || merged[field] === "") merged[field] = value;
					else if (JSON.stringify(merged[field]) !== JSON.stringify(value))
						conflicts.push({
							field,
							first: first.sources[0],
							other: row.sources[0],
							message: "同一业务键的字段值不一致",
						});
				}
			result.push({ values: merged, sources });
		} else {
			const values: Record<string, unknown> = Object.fromEntries(options.keys.map((key) => [key, first.values[key]]));
			for (const metric of options.metrics) {
				const numbers = group
					.map((row) => row.values[metric.field])
					.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
				const sum = numbers.reduce((a, b) => a + b, 0);
				values[`${metric.field}_${metric.operation}`] =
					metric.operation === "count"
						? numbers.length
						: metric.operation === "sum"
							? sum
							: numbers.length
								? sum / numbers.length
								: null;
			}
			result.push({ values, sources });
		}
	}
	return { rows: result, conflicts };
}
