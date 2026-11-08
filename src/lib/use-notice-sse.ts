/**
 * 客户端订阅通知 SSE 的 hook。
 *
 * - 挂载时建 EventSource('/api/sse/notice');卸载时关闭;
 * - `notice.new` 是本进程刚写入的**真事件**:失效通知列表 + 整个任务域;
 * - `notice.refresh` 是每 25 秒一次的心跳,只表示「数据库可能有别的进程写入」,
 *   所以只失效铃铛列表和侧栏红点 —— 拿心跳去全量重取 `taskClose.*`(任务列表、
 *   批次、详情…)会让每个标签页每 25 秒抖一次;
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
		const onRefresh = () => {
			void queryClient.invalidateQueries(trpc.notice.list.queryFilter());
			void queryClient.invalidateQueries(trpc.taskClose.menuBadge.queryFilter());
		};
		es.addEventListener("notice.new", onNotice);
		es.addEventListener("notice.refresh", onRefresh);

		return () => {
			es.removeEventListener("notice.new", onNotice);
			es.removeEventListener("notice.refresh", onRefresh);
			es.close();
		};
	}, [queryClient, trpc]);
}
