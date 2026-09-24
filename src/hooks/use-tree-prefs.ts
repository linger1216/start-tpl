import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useTRPC } from "#/integrations/trpc/react";

/** 参数管理里的键(值是一段 JSON,形状见下) */
export const PAGE_TREE_KEY = "page.tree";

/** 单个页面记下的"展开到哪" —— 已展开节点的 id */
export type PageTreePrefs = { expanded: string[] };
/** 整段 JSON 的形状:页面标识 → 该页的树展开态 */
export type PageTreeMap = Record<string, PageTreePrefs>;

/**
 * 解析 `page.tree` 的值。
 *
 * **容错优先**:这个参数是给人看的(参数管理页能直接改),写坏了不能让页面崩 ——
 * 解析不出来就当"没设置",回落到树自己的默认(全部折叠)。
 */
export function parsePageTree(raw: string | null | undefined): PageTreeMap {
	if (!raw) return {};
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return value as PageTreeMap;
	} catch {
		return {};
	}
}

/**
 * 树的展开态持久化 —— 存在 `sys_para` 的 `page.tree` 里(与 `page.columns` 一个套路)。
 *
 * 为什么不放 `localStorage`:展开到哪是**使用者的偏好**,不是这台机器的 —— 换台电脑也该是同一套;
 * 而且参数管理页能看见 / 改 / 备份它(有人就是靠这个把树的默认态"发"给别人的)。
 *
 * 记的是**已展开的节点 id**(不是已折叠的):这样"没设置过 = 全部折叠"天然成立 ——
 * 节点是异步来的,若按"已折叠集合"存,首帧拿到空数组会把初始状态算错。
 *
 * 写入时机:每次折叠 / 展开、或点「全部展开 / 全部折叠」后立即写(单键 upsert,极轻)。
 * 应用时机:由 `SortableTree` 在**第一次拿到这个值时套用一次**(用 ref 记住,之后再渲染不再覆盖)——
 * 否则用户刚展开,树上层的 query 一刷新就把展开态打回旧值。
 */
export function useTreePrefs(pageKey: string) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const prefsQuery = useQuery(trpc.para.byKey.queryOptions({ key: PAGE_TREE_KEY }));
	const raw = prefsQuery.data?.value;
	const parsed = useMemo(() => parsePageTree(raw), [raw]);

	const updateMutation = useMutation(
		trpc.para.update.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.para.pathFilter());
			},
		}),
	);

	const persist = useCallback(
		(expanded: string[]) => {
			const merged: PageTreeMap = { ...parsePageTree(raw), [pageKey]: { expanded } };
			updateMutation.mutate({ key: PAGE_TREE_KEY, value: JSON.stringify(merged) });
		},
		[raw, pageKey, updateMutation],
	);

	/** 库里那套展开态;`undefined` = 还没读到(树别急着套用)。调用方直接传给 `initialExpandedIds` */
	return { initialExpandedIds: prefsQuery.data === undefined ? undefined : (parsed[pageKey]?.expanded ?? []), persist };
}
