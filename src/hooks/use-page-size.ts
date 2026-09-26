import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "#/integrations/trpc/react";
import { PAGE_SIZES } from "#/lib/constants";

/** 参数管理里的键(值是每页条数,见 `lib/sys-para.ts` 的 `PARA_DEFAULTS`) */
export const PAGE_SIZE_KEY = "page.size";

/** 参数缺失 / 填坏时的落点 —— 与 `PARA_DEFAULTS` 里的默认值保持一致 */
export const PAGE_SIZE_FALLBACK = 20;

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
 * 列表页默认每页多少条 —— 读参数 `page.size`(在「参数管理」页改得到,不用发版)。
 *
 * 为什么要过一道参数:它和 `page.columns` / `page.tree` 一样属于**界面偏好**,
 * 换机器 / 换浏览器应该一致,而且要在参数管理页看得见、改得动。
 *
 * 每个列表路由的 `loader` 都 prefetch 了这个键 ⇒ SSR 首帧与客户端跳转拿到的都是**已就位**的值;
 * 而表格的 `initialState` 只在创建时读一次 ⇒ 改完参数对**之后打开**的页面生效(当前页不追改)。
 */
export function usePageSize(): number {
	const trpc = useTRPC();
	const query = useQuery(trpc.para.byKey.queryOptions({ key: PAGE_SIZE_KEY }));
	return parsePageSize(query.data?.value);
}
