import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useTRPC } from "#/integrations/trpc/react";
import { PAGE_SIZES } from "#/lib/constants";
import type { MockRow, useAppTable } from "#/lib/table";

/**
 * 「界面偏好」类参数:`page.columns`(列顺序 + 隐藏)、`page.tree`(树展开态)、
 * `page.size`(每页条数)。三者都是**使用者的偏好**而不是这台机器的偏好 ——
 * 所以存 `sys_para`(换台电脑、换个浏览器还是自己那套,参数管理页也能看见 / 改 / 备份),
 * 而不是 `localStorage`。
 *
 * 这个文件把三份逐字重复的「读一键 + 写一键 + 合并已解析的 JSON 再写回 + invalidate」收成一份。
 */

/** 参数管理里的键(值是一段 JSON,见下方的结构) */
const PAGE_COLUMNS_KEY = "page.columns";
/** 参数管理里的键(值是一段 JSON,形状见下) */
const PAGE_TREE_KEY = "page.tree";
/** 参数管理里的键(值是每页条数,见 `lib/sys-para.ts` 的 `PARA_DEFAULTS`) */
export const PAGE_SIZE_KEY = "page.size";
/** 参数缺失 / 填坏时的落点 —— 与 `PARA_DEFAULTS` 里的默认值保持一致 */
const PAGE_SIZE_FALLBACK = 20;

/** 单个页面的列偏好:顺序 + 隐藏列 */
type PageColumnPrefs = { order: string[]; hidden: string[] };
/** 整段 JSON 的形状:页面标识 → 该页的列偏好 */
type PageColumnsMap = Record<string, PageColumnPrefs>;
/** 单个页面记下的"展开到哪" —— 已展开节点的 id */
type PageTreePrefs = { expanded: string[] };

/**
 * 解析一段「页面标识 → 偏好」的 JSON 对象。
 *
 * **容错优先**:这些参数是给人看的、也可能被人在参数管理里手改,写坏了不能让页面崩 ——
 * 解析不出来就当"没有设置",回落到各自的默认值。
 */
function parsePageRecord<T>(raw: string | null | undefined): Record<string, T> {
	if (!raw) return {};
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return value as Record<string, T>;
	} catch {
		return {};
	}
}

/** 解析 `page.columns` 的值。 */
function parsePageColumns(raw: string | null | undefined): PageColumnsMap {
	return parsePageRecord<PageColumnPrefs>(raw);
}

/**
 * 解析 `page.size` 的值。
 *
 * **只认 `PAGE_SIZES` 那几档**(分页器只给这几档按钮,值不在这几档里就一个都不高亮、
 * 选中态胶囊也没地方滑),所以填别的按 20 处理 —— 不猜"最接近的那档",规则要一眼看得懂。
 */
export function parsePageSize(raw: string | null | undefined): number {
	const value = Number(raw);
	return (PAGE_SIZES as readonly number[]).includes(value) ? value : PAGE_SIZE_FALLBACK;
}

/**
 * 读 `sys_para` 某个键的原始串;`undefined` = 还没读到。
 *
 * 导出给「只读一个键、不需要写回」的调用方(如侧边栏的收起形态)——
 * 别再手写一份 `useQuery(trpc.para.byKey...)`:那会多出第三条读路径。
 */
export function useParaRaw(key: string): string | undefined {
	const trpc = useTRPC();
	const query = useQuery(trpc.para.byKey.queryOptions({ key }));
	return query.data?.value;
}

/**
 * 「读一键 + 写一键」的共用核心:`raw` 是库里那个原始串,
 * `persist` 会**合并已解析的 JSON** 再写回(不能整段覆盖,那会把别的页面的偏好抹掉)。
 */
function useParaRecord<T>(key: string) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const raw = useParaRaw(key);
	const parsed = useMemo(() => parsePageRecord<T>(raw), [raw]);
	const updateMutation = useMutation(
		trpc.para.update.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.para.pathFilter());
			},
		}),
	);

	const persist = useCallback(
		(next: T, pageKey: string) => {
			const merged: Record<string, T> = { ...parsePageRecord<T>(raw), [pageKey]: next };
			updateMutation.mutate({ key, value: JSON.stringify(merged) });
		},
		[key, raw, updateMutation],
	);

	return { raw, parsed, persist };
}

/**
 * 表格的列偏好(顺序 + 隐藏)持久化 —— 存在 `sys_para` 的 `page.columns` 里。
 *
 * 写入时机:每次勾选或拖动后立即写(单键 upsert,极轻)。
 * 应用时机:**只在库里的值第一次到位时套用一次**(用 ref 记住已套用的原始串),
 * 之后再渲染不再覆盖 —— 否则用户刚拖完、`listQuery` 一刷新就把顺序打回旧值。
 */
export function useColumnPrefs<TRow extends MockRow>(pageKey: string, table: ReturnType<typeof useAppTable<TRow>>) {
	const { raw, parsed, persist: persistRecord } = useParaRecord<PageColumnPrefs>(PAGE_COLUMNS_KEY);

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

	const persist = useCallback((next: PageColumnPrefs) => persistRecord(next, pageKey), [persistRecord, pageKey]);

	return { persist, remote: parsed[pageKey] ?? null };
}

/**
 * 树的展开态持久化 —— 存在 `sys_para` 的 `page.tree` 里(与 `page.columns` 一个套路)。
 *
 * 记的是**已展开的节点 id**(不是已折叠的):这样"没设置过 = 全部折叠"天然成立 ——
 * 节点是异步来的,若按"已折叠集合"存,首帧拿到空数组会把初始状态算错。
 *
 * 写入时机:每次折叠 / 展开、或点「全部展开 / 全部折叠」后立即写(单键 upsert,极轻)。
 * 应用时机:由 `SortableTree` 在**第一次拿到这个值时套用一次**(用 ref 记住,之后再渲染不再覆盖)——
 * 否则用户刚展开,树上层的 query 一刷新就把展开态打回旧值。
 */
export function useTreePrefs(pageKey: string) {
	const { raw, parsed, persist: persistRecord } = useParaRecord<PageTreePrefs>(PAGE_TREE_KEY);

	const persist = useCallback((expanded: string[]) => persistRecord({ expanded }, pageKey), [persistRecord, pageKey]);

	/** 库里那套展开态;`undefined` = 还没读到(树别急着套用)。调用方直接传给 `initialExpandedIds` */
	return { initialExpandedIds: raw === undefined ? undefined : (parsed[pageKey]?.expanded ?? []), persist };
}

/**
 * 列表页默认每页多少条 —— 读参数 `page.size`(在「参数管理」页改得到,不用发版)。
 *
 * 每个列表路由的 `loader` 都 prefetch 了这个键 ⇒ SSR 首帧与客户端跳转拿到的都是**已就位**的值;
 * 而表格的 `initialState` 只在创建时读一次 ⇒ 改完参数对**之后打开**的页面生效(当前页不追改)。
 */
export function usePageSize(): number {
	return parsePageSize(useParaRaw(PAGE_SIZE_KEY));
}
