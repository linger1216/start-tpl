import { useMemo, useRef } from "react";

/** 稳定 key 的序号源(模块级自增;不参与渲染,不影响 SSR 水合) */
let keySeq = 0;

/**
 * 稳定行 key:按**位置**复用,内容变化不换 key。
 *
 * 用于「列表项里有输入框」的场景(字段映射行、可改列名的表头):
 *  - 若 key 里带上内容(如源字段名),每敲一个字 React 就重建 input → 输入框失焦;
 *  - 纯下标 key 会被 `suspicious/noArrayIndexKey` 拦下。
 *
 * 所以自己管一份「按位置稳定」的 key:`count` 变化时按需增删,已有位置保持原 key。
 */
export function useStableKeys(count: number, prefix: string): string[] {
	const ref = useRef<string[]>([]);
	return useMemo(() => {
		if (ref.current.length !== count) {
			const prev = ref.current;
			ref.current = Array.from({ length: count }, (_, index) => prev[index] ?? `${prefix}-${++keySeq}`);
		}
		return ref.current;
	}, [count, prefix]);
}
