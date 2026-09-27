import type { CellData, RowData, TableFeatures } from "@tanstack/react-table";
import {
	cellSelectionFeature,
	columnFacetingFeature,
	columnFilteringFeature,
	columnGroupingFeature,
	columnOrderingFeature,
	columnPinningFeature,
	columnResizingFeature,
	columnSizingFeature,
	columnVisibilityFeature,
	createExpandedRowModel,
	createFilteredRowModel,
	createGroupedRowModel,
	createPaginatedRowModel,
	createSortedRowModel,
	createTableHook,
	filterFn_includesString,
	globalFilteringFeature,
	rowExpandingFeature,
	rowPaginationFeature,
	rowPinningFeature,
	rowSelectionFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_text,
	tableFeatures,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * 统一 TanStack Table **v9** app hook。
 * 全项目只造这一个 hook,所有 CRUD 表格用它;
 * 列 / 选中 / 分页 / 排序 / 筛选全交给 TanStack,不重复手写。
 *
 * v9 的两个硬性约定(写错不会报错,但运行时静默失效):
 *  1. 行模型工厂必须放在**具名 slot** 上,且必须**调用** —— `sortedRowModel: createSortedRowModel()`。
 *     写成 `createSortedRowModel`(无 key、未调用)会被当作无关键忽略,
 *     于是 `getSortedRowModel()` 之类根本不存在。
 *  2. 具名函数(`sortFn: "text"` / `filterFn: "includesString"`)要先用
 *     `sortFns` / `filterFns` 注册表登记,字符串名才可用。
 */
export const { useAppTable, createAppColumnHelper, appFeatures } = createTableHook({
	features: tableFeatures({
		// ── 启用的特性 ────────────────────────────────────────────
		cellSelectionFeature,
		columnFacetingFeature,
		columnFilteringFeature,
		columnGroupingFeature,
		columnOrderingFeature,
		columnPinningFeature,
		columnResizingFeature,
		columnSizingFeature,
		columnVisibilityFeature,
		globalFilteringFeature,
		rowExpandingFeature,
		rowPaginationFeature,
		rowPinningFeature,
		rowSelectionFeature,
		rowSortingFeature,

		// ── 客户端行模型(具名 slot + 必须调用) ────────────────────
		filteredRowModel: createFilteredRowModel(),
		sortedRowModel: createSortedRowModel(),
		paginatedRowModel: createPaginatedRowModel(),
		expandedRowModel: createExpandedRowModel(),
		groupedRowModel: createGroupedRowModel(),

		// ── 具名函数注册表(登记后列定义里可直接写字符串名) ────────
		sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
		filterFns: { includesString: filterFn_includesString },
	}),
});

/**
 * 表格行的最小约束:必须有 `id`。
 *
 * `DataTable` / `actionsColumn` / `selectColumn` 的泛型都挂在它上面 —— 所以它属于**表格**这一层,
 * 而不是 `lib/mock-table.ts`(那个文件是"设计期的假后端",只有工作台示例用)。
 * 之前放在那边,导致"真表格要 import 一个 mock 文件才能定类型",名字与位置都在误导。
 */
export type MockRow = { id: string } & Record<string, unknown>;

// 列 meta 扩展:允许在列定义里挂 className(模块列宽/对齐用)
declare module "@tanstack/react-table" {
	interface ColumnMeta<TFeatures extends TableFeatures, TData extends RowData, TValue extends CellData> {
		/** 单元格最小宽度(px):`width` 在 auto 布局下只是建议值,操作列会被挤成多行 */
		minWidth?: number;
		className?: string;
	}
}

/**
 * 台账列表的关键词匹配 —— 统一口径:**本项目列表搜索一律大小写不敏感**。
 *
 * 关键词先去掉首尾空白;空关键词一律命中(`null` / `undefined` 字段按空串算)。
 * 字段集合由调用方给(只搜它列出来的那几列,不隐式搜整行)。
 */
export function matchKeyword(fields: readonly unknown[], keyword: string): boolean {
	const needle = keyword.trim().toLowerCase();
	if (!needle) return true;
	return fields.some((field) =>
		String(field ?? "")
			.toLowerCase()
			.includes(needle),
	);
}

/**
 * 台账多选:选中集合 + 单个/批量切换。
 *
 * 行集合变化(删除、覆盖导入)后自动剔除已消失的 id —— 这一步此前由各页自己维护
 * `useState<Set<string>>`,只有部分页面做了清理,漏掉就会出现「已选 N 条」虚高、
 * 批量删除删不到行。放在这里,各页只留一份实现。
 */
export function useRowSelection<T extends { id: string }>(rows: readonly T[]) {
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

	useEffect(() => {
		setSelected((prev) => {
			if (prev.size === 0) return prev;
			const alive = new Set(rows.map((row) => row.id));
			const next = new Set([...prev].filter((id) => alive.has(id)));
			// 没变化时返回原引用,避免每渲染一次都触发更新(rows 常是内联过滤出来的新数组)
			return next.size === prev.size ? prev : next;
		});
	}, [rows]);

	const toggleOne = useCallback((id: string, on: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (on) next.add(id);
			else next.delete(id);
			return next;
		});
	}, []);

	const toggleMany = useCallback((ids: readonly string[], on: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			for (const id of ids) {
				if (on) next.add(id);
				else next.delete(id);
			}
			return next;
		});
	}, []);

	const clear = useCallback(() => setSelected(new Set()), []);

	const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);

	return { selected, selectedRows, toggleOne, toggleMany, clear };
}
