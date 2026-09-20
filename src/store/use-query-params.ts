import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";

/**
 * 通用查询参数 store 的状态形状。
 * 任意参数都以 string 保存(空串代表"未筛选")。
 */
export type QueryParams = Record<string, string>;

type QueryParamsState = {
	/** 当前正在编辑(未提交)的参数值 */
	draft: QueryParams;
	/** 已提交、用于触发查询的参数值 */
	committed: QueryParams;
	setDraft: (next: QueryParams) => void;
	patchDraft: (partial: Partial<QueryParams>) => void;
	commit: () => void;
	reset: () => void;
};

/** Zustand store hook 类型 —— 暴露给各模块做类型推导 */
export type QueryParamsHook = UseBoundStore<StoreApi<QueryParamsState>>;

/**
 * ponytail: 单一 store 工厂。所有列表模块共享此模式 —
 * 搜索框改变 -> setDraft/patchDraft;点搜索 -> commit;点重置 -> reset。
 * 每个模块调用 createQueryParamsStore(empty) 拿到自己独立的 hook 实例。
 */
export function createQueryParamsStore(empty: QueryParams): QueryParamsHook {
	const initializer: StateCreator<QueryParamsState> = (set, get) => ({
		draft: { ...empty },
		committed: { ...empty },
		setDraft: (next) => set({ draft: { ...empty, ...next } }),
		patchDraft: (partial) => set({ draft: { ...get().draft, ...partial } as QueryParams }),
		commit: () => set({ committed: { ...get().draft } }),
		reset: () => set({ draft: { ...empty }, committed: { ...empty } }),
	});
	return create<QueryParamsState>()(initializer);
}
