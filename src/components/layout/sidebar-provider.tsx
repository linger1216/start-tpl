import { type ReactNode, useState } from "react";
import { PageTransition } from "./page-transition";
import { RouteProgress } from "./route-progress";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * 主布局外壳：左侧栏 + 顶栏 + 路由进度 + 切换动画。
 * 维护 collapsed 态；菜单/用户名在接入动态 menu 模块前使用占位。
 */
export function SidebarProvider({ username = "管理员", children }: { username?: string; children: ReactNode }) {
	const [collapsed, setCollapsed] = useState(false);
	return (
		<div className="flex h-screen">
			<Sidebar collapsed={collapsed} />
			<div className="flex min-w-0 flex-1 flex-col">
				<RouteProgress />
				<Topbar username={username} onToggle={() => setCollapsed((c) => !c)} />
				<main className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-6 pb-10">
					<PageTransition>{children}</PageTransition>
				</main>
			</div>
		</div>
	);
}
