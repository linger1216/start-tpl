import { createFileRoute, Outlet } from "@tanstack/react-router";

import { NavPermissionsProvider } from "#/components/layout/nav-permissions";
import { SidebarProvider } from "#/components/layout/sidebar-provider";

export const Route = createFileRoute("/(main)")({
	// 菜单在库里:预取一次,首屏(SSR)直出的就是 `menu` 表的菜单,而不是先渲染静态再替换
	loader: ({ context }) => context.queryClient.ensureQueryData(context.trpc.menu.list.queryOptions()),
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
