import { createFileRoute, Outlet } from "@tanstack/react-router";

import { NavPermissionsProvider } from "#/components/layout/nav-permissions";
import { SidebarProvider } from "#/components/layout/sidebar-provider";
import { SIDEBAR_MODE_CONFIG_KEY } from "#/lib/sidebar-mode";

export const Route = createFileRoute("/(main)")({
	/**
	 * 预取外壳依赖的两份服务端数据,让首屏(SSR)直出就是最终形态:
	 *  1. `sys_menu` 的菜单 —— 否则先渲染静态 NAV_NODES 再被表里的菜单替换;
	 *  2. 侧边栏收起形态(`sys_config` 的一条偏好)—— 否则收起时宽度会闪一下。
	 * 第 2 条失败不阻断外壳:解析侧会回落默认值(见 lib/sidebar-mode.ts),所以单独吞掉错误。
	 */
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(context.trpc.menu.list.queryOptions()),
			context.queryClient
				.ensureQueryData(context.trpc.config.byKey.queryOptions({ key: SIDEBAR_MODE_CONFIG_KEY }))
				.catch(() => undefined),
		]);
	},
	component: MainLayout,
});

function MainLayout() {
	return (
		// 菜单权限:不传 `granted` = 权限服务未接通 → 菜单不过滤(全部可见)。
		// TBD(待补充:后端接口)—— 接上「用户 → 角色 → 权限点」的读取后把权限码集合传进来,
		// 侧边栏 / 面包屑 / 模块概览 / 工作台四处一起生效
		// (见 components/layout/nav-permissions.tsx)。
		<NavPermissionsProvider>
			<SidebarProvider>
				<Outlet />
			</SidebarProvider>
		</NavPermissionsProvider>
	);
}
