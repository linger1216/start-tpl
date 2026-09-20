import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import { useTRPC } from "#/integrations/trpc/react";
import { filterNavByPermission, findVisibleNavTrailIn, NAV_NODES, type NavNode } from "./nav-config";
import { buildNavTree } from "./nav-menu";

/**
 * 菜单权限 Context —— 只存「当前用户的有效权限点编码」这一件事。
 *
 * 两个取值语义(与 `filterNavByPermission` 对齐):
 *  - `null`(= 默认值)= **权限服务未接通**:未登录、或后端接口还没实现 —— 菜单不过滤,全部可见。
 *    这是本轮的默认态,所以「加权限」不会改变现有页面的渲染结果。
 *  - `Set<string>` = 已拿到权限码(如 `data:enterprise:info` / `op:data:1`):
 *    未授权的菜单整枝隐藏,分组子项全被隐藏时分组自身也不显示。
 *
 * **这是权限下发的唯一挂载点**:服务端接口(用户 → 角色 → 权限点,见 doc/表结构设计.md §11.3)
 * 上线后,在 `src/routes/(main)/route.tsx` 把结果塞进 `<NavPermissionsProvider granted={...}>`,
 * 侧边栏 / 面包屑 / 模块概览 / 工作台四处一起生效,组件层不用改。
 */
const NavPermissionsCtx = createContext<ReadonlySet<string> | null>(null);

export function NavPermissionsProvider({
	granted = null,
	children,
}: {
	/** 有效权限码集合;不传 / 传 null = 不过滤(默认全可见) */
	granted?: ReadonlySet<string> | null;
	children: ReactNode;
}) {
	return <NavPermissionsCtx.Provider value={granted}>{children}</NavPermissionsCtx.Provider>;
}

/** 当前用户的有效权限码(未接通权限服务时为 null = 不过滤) */
export function useGrantedNavPermissions(): ReadonlySet<string> | null {
	return useContext(NavPermissionsCtx);
}

/**
 * **当前菜单树(动态)** —— 全站菜单的唯一数据源。
 *
 * 来源优先级:
 *  1. `menu` 表有数据 → 以表为准(`buildNavTree` 拼树,顺手丢掉 `visible = 0` 的整枝);
 *  2. 表为空 / 还没返回 → 退回静态 `NAV_NODES`。
 *
 * 兜底这条是刻意的:菜单表是可以被人清空的配置表,清空了也只是"回到代码里那份菜单",
 * 而不是白屏。SSR 期间由 `(main)/route.tsx` 的 loader 预取,首屏直出就是库里的菜单。
 */
export function useNavNodes(): NavNode[] {
	const trpc = useTRPC();
	const query = useQuery(trpc.menu.list.queryOptions());
	return useMemo(() => {
		const rows = query.data ?? [];
		return rows.length > 0 ? buildNavTree(rows) : NAV_NODES;
	}, [query.data]);
}

/** 当前用户可见的菜单树 —— 未接权限服务时就是全量(表里的)菜单 */
export function useVisibleNavNodes(): NavNode[] {
	const granted = useGrantedNavPermissions();
	const nodes = useNavNodes();
	return useMemo(() => filterNavByPermission(nodes, granted), [nodes, granted]);
}

/** 当前路径命中的可见菜单链(面包屑 / 展开分支) */
export function useVisibleNavTrail(pathname: string): NavNode[] {
	const granted = useGrantedNavPermissions();
	const nodes = useNavNodes();
	return useMemo(() => findVisibleNavTrailIn(nodes, pathname, granted), [nodes, pathname, granted]);
}
