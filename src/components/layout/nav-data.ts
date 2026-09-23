import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useTRPC } from "#/integrations/trpc/react";
import { findNavTrailIn, NAV_NODES, type NavNode } from "./nav-config";
import { buildNavTree } from "./nav-menu";

/**
 * **导航数据层** —— 侧边栏 / 面包屑 / 模块概览共用的两个只读 hook。
 *
 * 只有一个数据源:`trpc.menu.mine` —— **已经按当前用户的角色并集过滤过**(部门 → 角色 → 授权,
 * 见 `lib/rbac.ts`)。服务端那三种返回要区别对待:
 *  - `rows === []`  → 菜单表本身是空的(权限体系未启用)→ 退回静态 `NAV_NODES`,
 *    这是刻意的兜底:菜单表是可以被人清空的配置表,清空了也只是"回到代码里那份菜单",而不是白屏;
 *  - `rows === null`→ 权限体系已启用、但这个人没有可见菜单(或认不到人)→ **就是空**,
 *    绝不能回落静态菜单(回落 = 把全部菜单漏给他);
 *  - 有数据 → 正常拼树。
 *
 * SSR 期间由 `(main)/route.tsx` 的 loader 预取,首屏直出就是过滤后的菜单 ——
 * 所以 `menu.mine` 必须在**服务端那次请求里也带上浏览器 cookie**(见 `root-provider.tsx`),
 * 否则首帧认不到人、菜单会先全亮再收窄。
 */
export function useNavNodes(): NavNode[] {
	const trpc = useTRPC();
	const query = useQuery(trpc.menu.mine.queryOptions());
	return useMemo(() => {
		const data = query.data;
		// 还没拿到(理论上只在请求失败时出现):宁可空也不要漏出静态全量菜单
		if (!data) return [];
		if (data.rows === null) return [];
		return data.rows.length > 0 ? buildNavTree(data.rows) : NAV_NODES;
	}, [query.data]);
}

/** 当前路径命中的菜单链(面包屑 / 侧边栏展开分支用) */
export function useNavTrail(pathname: string): NavNode[] {
	const nodes = useNavNodes();
	return useMemo(() => findNavTrailIn(nodes, pathname), [nodes, pathname]);
}
