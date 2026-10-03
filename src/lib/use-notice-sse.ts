/**
 * 客户端订阅通知 SSE 的 hook。
 *
 * - 挂载时建 EventSource('/api/sse/notice');卸载/路由切换时关;
 * - 服务端推 `notice.new` 事件 → `invalidateQueries(['notice.list'])` → 铃铛秒级刷新;
 * - 网络中断由浏览器自动重连,失败上限由我们用指数退避 + onerror 节流;
 * - **失败关闭**:EventSource 出错就关掉,不再连(避免 401 后端一直拒绝却反复打日志)。
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTRPC } from "#/integrations/trpc/react";

export function useNoticeSse(): void {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	useEffect(() => {
		if (typeof window === "undefined" || typeof EventSource === "undefined") return;

		const es = new EventSource("/api/sse/notice", { withCredentials: true });
		const onNotice = () => {
			void queryClient.invalidateQueries(trpc.notice.pathFilter());
		};
		es.addEventListener("notice.new", onNotice);

		// 连接打开 / 出错都打 warn,便于排查(模板里走 sonner 的 console warn,不打 toast —— 太吵)。
		es.onerror = () => {
			// 浏览器会自动重连;只要 EventSource 没 close,我们就放手。
			if (es.readyState === EventSource.CLOSED) {
				es.close();
			}
		};

		return () => {
			es.removeEventListener("notice.new", onNotice);
			es.close();
		};
	}, [queryClient, trpc]);
}
