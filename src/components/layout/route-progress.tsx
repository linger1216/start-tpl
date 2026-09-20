import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

/**
 * 顶部路由进度条：路由变化时短暂显示一次从左到右的加载动画。
 */
export function RouteProgress() {
	const { pathname } = useLocation();
	const prev = useRef(pathname);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (prev.current === pathname) return;
		prev.current = pathname;
		setVisible(true);
		const timer = setTimeout(() => setVisible(false), 720);
		return () => clearTimeout(timer);
	}, [pathname]);

	if (!visible) return null;

	return (
		<div className="pointer-events-none fixed inset-x-0 top-0 z-50 px-1">
			<div className="route-progress-bar" />
		</div>
	);
}
