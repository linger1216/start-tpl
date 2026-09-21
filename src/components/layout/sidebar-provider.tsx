import { type ReactNode, useState } from "react";
import { PageTransition } from "./page-transition";
import { RouteProgress } from "./route-progress";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * 主布局外壳：左侧栏 + 顶栏 + 路由进度 + 切换动画。
 *
 * `collapsed` 只管「收没收起」;**收起之后长什么样**由 `lib/ui-prefs.ts` 的
 * 折叠模式决定(窄菜单 / 完全隐藏,设置入口在「系统设置 ▸ 界面偏好」)——
 * 所以这里不需要知道模式,`Sidebar` 自己读。
 */
export function SidebarProvider({ username = "管理员", children }: { username?: string; children: ReactNode }) {
	const [collapsed, setCollapsed] = useState(false);
	return (
		<div className="flex h-screen">
			<Sidebar collapsed={collapsed} onExpand={() => setCollapsed(false)} />
			<div className="relative flex min-w-0 flex-1 flex-col bg-background">
				{/* 内容区顶部一层极淡色温 —— 卡片是白底,底色再纯白就"糊成一片"。
				    固定在列顶部(不随内容滚动),滚动时像一层常驻的空气感。 */}
				<div aria-hidden className="ambient-veil pointer-events-none absolute inset-x-0 top-0 h-72 opacity-60" />
				<RouteProgress />
				<Topbar username={username} onToggle={() => setCollapsed((c) => !c)} />
				<main className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-6 pb-10">
					<PageTransition>{children}</PageTransition>
				</main>
			</div>
		</div>
	);
}
