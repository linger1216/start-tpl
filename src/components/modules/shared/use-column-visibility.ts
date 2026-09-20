import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useTRPC } from "#/integrations/trpc/react";

/**
 * **表格列的「显示与否 + 显示顺序」**(持久化到系统设置)。
 *
 * 为什么存 `sys_config` 而不是 localStorage:这是"系统设置"级别的偏好 ——
 * 换台机器、换个浏览器都该一致,而且要在「系统设置 ▸ 参数管理」里能改。
 *
 * 键:`ui.columns.<tableKey>`(tableKey 例:`archive.enterprise` / `raw.SRC-260920-153045`)。
 *
 * 值的形状:
 * ```json
 * { "order": ["__code","name","street"], "visible": ["__code","name"] }
 * ```
 *  - `order` 是**全部列**的顺序(含被隐藏的)—— 所以把一列藏起来再显示回来,它还在原来的位置;
 *  - `visible` 是显示出来的那些。
 *
 * 兼容旧形状:以前只存一个数组(可见列),读到数组就当成 `visible`,顺序取默认。
 * **不写键 = 全部可见 + 默认顺序**(与"没配过"的语义一致)。
 */
export function useColumnVisibility(tableKey: string, allKeys: readonly string[]) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const configKey = `ui.columns.${tableKey}`;

	const listQuery = useQuery(trpc.config.list.queryOptions());
	const stored = useMemo(() => {
		const row = (listQuery.data ?? []).find((item) => item.key === configKey);
		if (!row?.value) return null;
		try {
			const parsed = JSON.parse(row.value) as unknown;
			// 旧形状:纯数组 = 可见列
			if (Array.isArray(parsed)) return { order: null, visible: new Set(parsed.map(String)) };
			if (parsed && typeof parsed === "object") {
				const record = parsed as { order?: unknown; visible?: unknown };
				return {
					order: Array.isArray(record.order) ? record.order.map(String) : null,
					visible: Array.isArray(record.visible) ? new Set(record.visible.map(String)) : null,
				};
			}
			return null;
		} catch {
			return null;
		}
	}, [listQuery.data, configKey]);

	/** 本地乐观态:拖动/勾选立刻生效,保存失败再回读 */
	const [localOrder, setLocalOrder] = useState<string[] | null>(null);
	const [localVisible, setLocalVisible] = useState<Set<string> | null>(null);

	/**
	 * 全部列的**当前顺序**:存过的顺序里认识的键排在前面(按存过的次序),
	 * 后加的列(如新登记的属性)追加在后面 —— 不会因为"顺序存过"就把新列藏起来。
	 */
	const orderedKeys = useMemo(() => {
		const known = new Set(allKeys);
		const saved = (localOrder ?? stored?.order ?? []).filter((key) => known.has(key));
		const seen = new Set(saved);
		return [...saved, ...allKeys.filter((key) => !seen.has(key))];
	}, [allKeys, localOrder, stored?.order]);

	// 身份稳定:调用方常把这个 Set 当 useMemo 依赖,每次新建会让列定义白重算
	const visible = useMemo(
		() => localVisible ?? stored?.visible ?? new Set(allKeys),
		[localVisible, stored?.visible, allKeys],
	);

	const saveMutation = useMutation(
		trpc.config.update.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.config.pathFilter());
			},
		}),
	);
	const persist = (nextVisible: Set<string>, nextOrder: string[]) => {
		setLocalVisible(nextVisible);
		setLocalOrder(nextOrder);
		saveMutation.mutate({ key: configKey, value: JSON.stringify({ order: nextOrder, visible: [...nextVisible] }) });
	};

	return {
		isVisible: (key: string) => visible.has(key),
		/** 可见列集合(身份稳定,可直接喂给列定义) */
		visibleKeys: visible,
		/** **全部列的顺序**(含隐藏的)—— 表格按它渲染,拖动就是改它 */
		orderedKeys,
		visibleCount: allKeys.filter((key) => visible.has(key)).length,
		totalCount: allKeys.length,
		loaded: !listQuery.isPending,
		toggle: (key: string) => {
			const next = new Set(visible);
			next.has(key) ? next.delete(key) : next.add(key);
			persist(next, orderedKeys);
		},
		/** 拖动排序:把 `fromKey` 放到 `toKey` 的位置(表格与面板共用一套顺序) */
		move: (fromKey: string, toKey: string) => {
			if (fromKey === toKey) return;
			const next = [...orderedKeys];
			const from = next.indexOf(fromKey);
			const to = next.indexOf(toKey);
			if (from < 0 || to < 0) return;
			next.splice(from, 1);
			next.splice(to, 0, fromKey);
			persist(new Set(visible), next);
		},
		showAll: () => persist(new Set(allKeys), orderedKeys),
		invert: () => persist(new Set(allKeys.filter((key) => !visible.has(key))), orderedKeys),
		/** 恢复默认 = 全部可见 + 默认顺序(把订单与可见都写回默认,语义明确) */
		reset: () => persist(new Set(allKeys), [...allKeys]),
	};
}
