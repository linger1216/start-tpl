import { useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * 路由切换进场动画：以 pathname 作 key 触发重挂载，播放 fade-in。
 * 包裹在 main 内容外层，替换页面时产生平滑过渡。
 */
export function PageTransition({ children }: { children: ReactNode }) {
	const { pathname } = useLocation();
	return (
		<div key={pathname} className="page-enter flex min-h-0 flex-1 flex-col overflow-y-auto">
			{children}
		</div>
	);
}
