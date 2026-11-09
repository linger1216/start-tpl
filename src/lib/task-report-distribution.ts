/** A condition compares a single scalar field to its exact value. */
export type ReportDistributionValue = string | number | boolean | null;
export type ReportDistributionCondition = { userId: string; field: string; value: ReportDistributionValue };

/** A row must match exactly one condition; callers must reject gaps and overlaps. */
export function partitionReportRows(rows: readonly unknown[], conditions: readonly ReportDistributionCondition[]) {
	const byUser = new Map(conditions.map((condition) => [condition.userId, [] as unknown[]]));
	const unassigned: number[] = [];
	const overlapping: number[] = [];
	for (const [index, row] of rows.entries()) {
		const record = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
		const matches = record
			? conditions.filter((condition) => (record[condition.field] ?? null) === condition.value)
			: [];
		if (matches.length === 0) unassigned.push(index);
		else if (matches.length > 1) overlapping.push(index);
		else byUser.get(matches[0].userId)?.push(row);
	}
	return { byUser, unassigned, overlapping };
}
