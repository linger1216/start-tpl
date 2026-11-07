/**
 * 客户端订阅通知 SSE 的 hook。
 *
 * - 挂载时建 EventSource('/api/sse/notice');卸载时关闭;
 * - 收到 `notice.new` 时失效铃铛和「我的任务」红点的查询缓存;
 * - 网络中断时由浏览器按 EventSource 规则重连。
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
			// 「我的任务」红点也吃通知(@提及 / 轮到你了都发 notice)—— 同一个事件举两杆旗
			void queryClient.invalidateQueries(trpc.taskClose.pathFilter());
		};
		es.addEventListener("notice.new", onNotice);

		return () => {
			es.removeEventListener("notice.new", onNotice);
			es.close();
		};
	}, [queryClient, trpc]);
}
