export async function upgradeTaskStatusIndex(
	schema: string,
	query: (sql: string) => Promise<Array<Record<string, unknown>>>,
	run: (sql: string) => Promise<unknown>,
): Promise<void> {
	const columns = await query(
		`select COLUMN_NAME from SYS.ALL_IND_COLUMNS where TABLE_OWNER='${schema}' and TABLE_NAME='tc_task' and INDEX_NAME='idx_task_status_created' order by COLUMN_POSITION`,
	);
	const names = columns.map((row) => String(row.COLUMN_NAME ?? row.column_name).toLowerCase());
	if (names.length && names.join(",") !== "status,created_at") {
		await run(`drop index "idx_task_status_created" on "${schema}"."tc_task"`);
	}
}
