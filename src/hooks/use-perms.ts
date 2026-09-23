/**
 * 当前用户有没有某个权限标识 —— 前端判断"这个按钮该不该显示"的唯一入口。
 *
 * 数据来自 `trpc.menu.mine`(和侧边栏同一个查询,不会多打一次接口)。口径与侧边栏**完全一致**:
 *  - `perms === null`(权限体系未启用,一条授权都没配)→ **一律放行**;
 *  - `perms` 是数组(可能为空)→ 只放行集合里的标识。
 *
 * ⚠️ 这只是"显示与否",**不构成安全边界** —— 真正的拦截必须在服务端做
 * (在 procedure 里查同一份权限集合)。隐藏一个按钮不等于禁止那个操作。
 */
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "#/integrations/trpc/react";

export function useHasPerm(code: string): boolean {
	const trpc = useTRPC();
	const query = useQuery(trpc.menu.mine.queryOptions());
	// 首帧(SSR 预取过)通常就有值;拿不到时按"未启用"处理 —— 与侧边栏同一条口径
	const perms = query.data?.perms ?? null;
	return perms === null || perms.includes(code);
}
