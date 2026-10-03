import { useRouterState } from "@tanstack/react-router";

/**
 * 路由进度条 —— **只在路由真的在加载**时出现。
 *
 * 曾经这里是「pathname 一变就无条件转 720ms」的假信号:与真实加载无关,还多养了
 * `useRef` / `useState` / `useEffect` / `setTimeout` 四个状态位(收敛时删掉)。
 * 现在直接读路由自己的 `isLoading`:`defaultPreload: "intent"` 命中的预加载几乎不会渲染它,
 * 冷路由要等服务端才出现 —— 该出现时才出现。
 *
 * 已知取舍:扫光是**单次**动画,加载时长超过一次动画时会提前淡出。不为它引入
 * 「延迟出现 + 最短停留 + 收尾」那套状态机(那是 nprogress 级别的复杂度,不值当)。
 */
export function RouteProgress() {
	const isLoading = useRouterState({ select: (state) => state.isLoading });

	if (!isLoading) return null;

	return (
		<div className="pointer-events-none fixed inset-x-0 top-0 z-50 px-1">
			<div className="route-progress-bar" />
		</div>
	);
}
