import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useTRPC } from "#/integrations/trpc/react";
import type { MockRow, useAppTable } from "#/lib/table";

/** 参数管理里的键(值是一段 JSON,见下方的结构) */
export const PAGE_COLUMNS_KEY = "page.columns";

/** 单个页面的列偏好:顺序 + 隐藏列 */
export type PageColumnPrefs = { order: string[]; hidden: string[] };
/** 整段 JSON 的形状:页面标识 → 该页的列偏好 */
export type PageColumnsMap = Record<string, PageColumnPrefs>;

/**
 * 解析 `page.columns` 的值。
 *
 * **容错优先**:这个参数是给人看的、也可能被人在参数管理里手改,写坏了不能让整个列表页崩 ——
 * 解析不出来就当"没有设置",回落到"全部列、默认顺序"。
 */
export function parsePageColumns(raw: string | null | undefined): PageColumnsMap {
	if (!raw) return {};
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return value as PageColumnsMap;
	} catch {
		return {};
	}
}

/**
 * 表格的列偏好(顺序 + 隐藏)持久化 —— 存在 `sys_para` 的 `page.columns` 里。
 *
 * 为什么不放 `localStorage`:列设置是**使用者的偏好**,不是这台机器的偏好 ——
 * 换台电脑、换个浏览器应该还是自己那套列;而且参数管理页能直接看到 / 改 / 备份它。
 *
 * 写入时机:每次勾选或拖动后立即写(单键 upsert,极轻)。
 * 应用时机:**只在库里的值第一次到位时套用一次**(用 ref 记住已套用的原始串),
 * 之后再渲染不再覆盖 —— 否则用户刚拖完、`listQuery` 一刷新就把顺序打回旧值。
 */
export function useColumnPrefs<TRow extends MockRow>(pageKey: string, table: ReturnType<typeof useAppTable<TRow>>) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const prefsQuery = useQuery(trpc.para.byKey.queryOptions({ key: PAGE_COLUMNS_KEY }));
	const raw = prefsQuery.data?.value;
	const parsed = useMemo(() => parsePageColumns(raw), [raw]);

	const appliedRef = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只认「库里那个原始串」的变化,表格实例每次渲染都是新引用
	useEffect(() => {
		if (raw === undefined || appliedRef.current === raw) return;
		appliedRef.current = raw;
		const mine = parsePageColumns(raw)[pageKey];
		if (!mine) return;
		/**
		 * ⚠️ 保存的顺序必须**和当前列合并**再套用,不能原样 setColumnOrder。
		 *
		 * 踩过:文件管理页新加了一列「勾选框」,而 `page.columns` 里是**旧**的顺序(没有那一列)——
		 * 原样套用之后 **表头与表体对不齐**(表头按新列算、表体按旧顺序渲染),
		 * 症状是"第一格表头是勾选框、第一格数据却是文件名",极难一眼看出是**列偏好的锅**。
		 * 规则:旧的顺序里保留(过滤掉已删除的列),**当前存在但没记录的列追加到后面**。
		 */
		const currentIds = table.getAllLeafColumns().map((column) => column.id);
		// 保存的顺序只决定「**已知列之间**的相对次序」;新列(没有记录的)要回到它在**代码里的声明位置**,
		// 不能一律追加到末尾 —— 否则新加的勾选列会跑到最后一列去(实测踩到)。
		const savedKnown = mine.order.filter((id) => currentIds.includes(id));
		const knownSlots = currentIds.filter((id) => savedKnown.includes(id));
		const reordered = knownSlots.map((_, index) => savedKnown[index] as string);
		const merged = currentIds.map((id) =>
			savedKnown.includes(id) ? (reordered[knownSlots.indexOf(id)] as string) : id,
		);
		table.setColumnOrder(merged);
		// 传空对象 = 全部可见(把上一次渲染残留的隐藏态清掉)
		table.setColumnVisibility(Object.fromEntries((mine.hidden ?? []).map((id) => [id, false])));
	}, [raw, pageKey]);

	const updateMutation = useMutation(
		trpc.para.update.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.para.pathFilter());
			},
		}),
	);

	const persist = useCallback(
		(next: PageColumnPrefs) => {
			const merged: PageColumnsMap = { ...parsePageColumns(raw), [pageKey]: next };
			updateMutation.mutate({ key: PAGE_COLUMNS_KEY, value: JSON.stringify(merged) });
		},
		[raw, pageKey, updateMutation],
	);

	return { persist, remote: parsed[pageKey] ?? null };
}
