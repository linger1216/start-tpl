import { createFileRoute, Outlet } from "@tanstack/react-router";

import { SidebarProvider } from "#/components/layout/sidebar-provider";
import { SIDEBAR_MODE_CONFIG_KEY } from "#/lib/sidebar-mode";

export const Route = createFileRoute("/(main)")({
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
	return (
		<SidebarProvider>
			<Outlet />
		</SidebarProvider>
	);
}
