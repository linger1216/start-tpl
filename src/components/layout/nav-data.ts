import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useTRPC } from "#/integrations/trpc/react";
import { findNavTrailIn, NAV_NODES, type NavNode } from "./nav-config";
import { buildNavTree } from "./nav-menu";

/**
 * **导航数据层** —— 侧边栏 / 面包屑 / 模块概览共用的两个只读 hook。
 *
 * 只有一个数据源:`sys_menu` 表(`trpc.menu.list`);表为空就退回静态 `NAV_NODES`。
 * 兜底这条是刻意的:菜单表是可以被人清空的配置表,清空了也只是"回到代码里那份菜单",
 * 而不是白屏。SSR 期间由 `(main)/route.tsx` 的 loader 预取,首屏直出就是库里的菜单。
 *
 * 为什么没有"按权限过滤"这一层:模板当前没有权限服务,任何过滤都只会返回原样 ——
 * 那属于"看起来预留了扩展点、实际是空转"。真接权限时,在这里加一个入参即可,
 * 不必提前把签名铺开(踩过的坑见 AGENTS.md「伪扩展点」)。
 */
export function useNavNodes(): NavNode[] {
	const trpc = useTRPC();
	const query = useQuery(trpc.menu.list.queryOptions());
	return useMemo(() => {
		const rows = query.data ?? [];
		return rows.length > 0 ? buildNavTree(rows) : NAV_NODES;
	}, [query.data]);
}

/** 当前路径命中的菜单链(面包屑 / 侧边栏展开分支用) */
export function useNavTrail(pathname: string): NavNode[] {
	const nodes = useNavNodes();
	return useMemo(() => findNavTrailIn(nodes, pathname), [nodes, pathname]);
}
