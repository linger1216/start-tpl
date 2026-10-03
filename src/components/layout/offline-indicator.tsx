import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * 网络断线提示条 —— **只在浏览器真的离线时**出现在顶栏下方。
 *
 * 设计取舍:
 *  - 不做自动重连探测(fetch 自己的 /api/timer),浏览器原生 `online`/`offline` 事件已经够用 —
 *    真要是「网络假活」(OS 显示在线但被防火墙拦),用户调接口会拿到 4xx/5xx,走 mutation 的
 *    `onError` 走 toast;这里只兜最常见的「物理断网 / 飞行模式」。
 *  - 顶部条而不是右下角 toast:用户写一半表单时切了 wifi,右下角 4 秒就消失,看不见;
 *    顶部条是常驻的,直到恢复在线才隐去。
 *  - 不接管按钮 disable 状态:服务端已发出的 mutation 在离线时已自然 `NetworkError`,没必要再加一道。
 *  - **不在 SSR 渲染**(条件渲染永远从 `false` 起),否则 SSR HTML 会带一个「离线」提示,
 *    首屏一闪再消失。
 */
export function OfflineIndicator() {
	const [online, setOnline] = useState(true);

	useEffect(() => {
		// 用 ref-style 而不是 state:避免「状态变化 = re-render」的开销(只关心「离线时该显示」)
		const update = () => setOnline(navigator.onLine);
		update();
		window.addEventListener("online", update);
		window.addEventListener("offline", update);
		return () => {
			window.removeEventListener("online", update);
			window.removeEventListener("offline", update);
		};
	}, []);

	if (online) return null;

	return (
		<output
			aria-live="polite"
			className="flex items-center justify-center gap-2 border-b border-hue-amber-fg bg-hue-amber-soft px-3 py-1.5 text-xs text-hue-amber-fg"
		>
			<WifiOff className="size-3.5" aria-hidden />
			<span>网络已断开 —— 当前操作会在网络恢复后继续,未保存的内容请勿关闭页面。</span>
		</output>
	);
}
