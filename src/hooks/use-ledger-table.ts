import { useColumnPrefs, usePageSize } from "#/hooks/use-para-prefs";
import { type MockRow, useAppTable } from "#/lib/table";

/** `useAppTable` 的入参,去掉 `initialState` —— 每页条数由这里的 `usePageSize()` 统一给 */
type LedgerTableOptions<TRow extends MockRow> = Omit<Parameters<typeof useAppTable<TRow>>[0], "initialState">;

/**
 * 台账表格装配 —— 9 个列表页各有 8 行逐字相同的「读默认每页条数 → 建表 → 读列偏好」。
 *
 * 分页器的渲染不在这里:`LedgerCard` 自己从 `table.state.pagination` 读。
 *
 * 只负责装配:`columns` / `data` / `getRowId` 的语义(行标识用 `row.key` 还是 `row.id`)仍由调用方原样给。
 * `prefKey` 是该页在 `page.columns` 里的页键(如 `settings.parameters`),**不要改** ——
 * 改了等于把所有人的列偏好清空。
 */
export function useLedgerTable<TRow extends MockRow>({
	prefKey,
	...options
}: LedgerTableOptions<TRow> & { prefKey: string }) {
	const defaultPageSize = usePageSize();
	const table = useAppTable({
		...options,
		initialState: { pagination: { pageIndex: 0, pageSize: defaultPageSize } },
	});
	// 列顺序 / 隐藏项存进参数 `page.columns`(换机器也跟着账号走)
	const { persist: persistColumns } = useColumnPrefs(prefKey, table);

	return { table, persistColumns };
}
