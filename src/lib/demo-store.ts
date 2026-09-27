import { Store } from "@tanstack/store";

/**
 * Demo 用的最小全局 store —— 页面里用 `useStore(store, selector)` 订阅、
 * `store.setState` 更新。状态形状刻意保持扁平,方便在 devtools 面板里直接看。
 */
export const store = new Store({
	firstName: "Jane",
	lastName: "Smith",
});

type DemoStoreState = typeof store.state;

/** 派生值用普通函数算即可,不必再建一个 Store 再手动保持同步。 */
export function selectFullName(state: DemoStoreState): string {
	return `${state.firstName} ${state.lastName}`;
}
