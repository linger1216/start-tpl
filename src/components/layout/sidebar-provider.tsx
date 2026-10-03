import { type ReactNode, useState } from "react";
import { OfflineIndicator } from "./offline-indicator";
import { PageTransition } from "./page-transition";
import { RouteProgress } from "./route-progress";
import { Sidebar } from "./sidebar";
import { type SessionUser, Topbar } from "./topbar";

/**
 * 主布局外壳：左侧栏 + 顶栏 + 路由进度 + 切换动画。
 *
 * `collapsed` 只管「收没收起」;**收起之后长什么样**由系统参数
 * `ui.sidebar.collapsed_mode` 决定(窄菜单 / 完全隐藏,设置入口在「系统设置 ▸ 参数管理」)——
 * 所以这里不需要知道模式,`Sidebar` 自己读(见 `lib/sidebar-mode.ts`)。
 */
export function SidebarProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
	const [collapsed, setCollapsed] = useState(false);
	return (
		<div className="flex h-screen">
			<Sidebar collapsed={collapsed} onExpand={() => setCollapsed(false)} />
			<div className="relative flex min-w-0 flex-1 flex-col bg-background">
				{/* 内容区顶部一层极淡色温 —— 卡片是白底,底色再纯白就"糊成一片"。
				    固定在列顶部(不随内容滚动),滚动时像一层常驻的空气感。 */}
				<div aria-hidden className="ambient-veil pointer-events-none absolute inset-x-0 top-0 h-72 opacity-60" />
				<RouteProgress />
				<Topbar user={user} onToggle={() => setCollapsed((c) => !c)} />
				<OfflineIndicator />
				<main className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-6 pb-10">
					<PageTransition>{children}</PageTransition>
				</main>
			</div>
		</div>
	);
}
