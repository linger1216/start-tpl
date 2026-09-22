import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { SidebarProvider } from "#/components/layout/sidebar-provider";
import { SIDEBAR_MODE_CONFIG_KEY } from "#/lib/sidebar-mode";

/** 当前登录用户 —— 只带界面要用的三个字段,别把整个 session 往客户端塞 */
export type SessionUser = { id: string; name: string; email: string };

/**
 * 读当前登录用户(**只在 server 跑**)。
 *
 * ⚠️ 两条硬约束,踩过才写得出来:
 *  1. **handler 里必须动态 import server-only 模块**。路由文件被 `routeTree.gen.ts` 静态引用,
 *     顶层 import 会被 Vite 拉进客户端包 —— `#/lib/auth` → `#/db` → mysql2/dmdb,浏览器里
 *     没有 `Buffer.prototype`,直接 "Cannot read properties of undefined (reading 'prototype')" 崩掉整个应用。
 *     (同一坑的详细记录见 `routes/(main)/demo/drizzle.tsx` 顶部。)
 *  2. 会话判定必须在**服务端**做:客户端 `authClient.useSession()` 是异步的,首帧渲染不出结论,
 *     那样未登录用户会先看到后台外壳再被弹走 —— 既闪屏又等于把外壳白送出去。
 */
const getSessionUser = createServerFn({ method: "GET" }).handler(async (): Promise<SessionUser | null> => {
	const [{ auth }, { getRequestHeaders }] = await Promise.all([
		import("#/lib/auth"),
		import("@tanstack/react-start/server"),
	]);
	const session = await auth.api.getSession({ headers: getRequestHeaders() });
	if (!session) return null;
	return { id: session.user.id, name: session.user.name, email: session.user.email };
});

export const Route = createFileRoute("/(main)")({
	/**
	 * **整个后台都要登录**:没有会话就带上原地址跳登录页,登录后回到原地。
	 * 放在 `beforeLoad` 而不是 `loader` —— 它是拦截;beforeLoad 抛 redirect 时 loader 根本不跑
	 * (也就不会白读一次菜单表)。
	 */
	beforeLoad: async ({ location }) => {
		const user = await getSessionUser();
		if (!user) {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
		return { user };
	},

	/**
	 * 预取外壳依赖的两份服务端数据,让首屏(SSR)直出就是最终形态:
	 *  1. `sys_menu` 的菜单 —— 否则先渲染静态 NAV_NODES 再被表里的菜单替换;
	 *  2. 侧边栏收起形态(`sys_para` 的一条偏好)—— 否则收起时宽度会闪一下。
	 * 第 2 条失败不阻断外壳:解析侧会回落默认值(见 lib/sidebar-mode.ts),所以单独吞掉错误。
	 */
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(context.trpc.menu.list.queryOptions()),
			context.queryClient
				.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: SIDEBAR_MODE_CONFIG_KEY }))
				.catch(() => undefined),
		]);
	},
	component: MainLayout,
});

function MainLayout() {
	// 用户信息由 beforeLoad 返回,SSR 首帧就有 —— 顶栏不会先显示"管理员"再跳成真名
	const { user } = Route.useRouteContext();
	return (
		<SidebarProvider user={user}>
			<Outlet />
		</SidebarProvider>
	);
}
