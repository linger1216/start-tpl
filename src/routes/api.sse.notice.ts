/**
 * SSE 端点 —— `/api/sse/notice`。
 *
 * 客户端(`useNoticeSse()`)以 `EventSource('/api/sse/notice')` 订阅,服务端按 `userId`
 * 把通道分到 `notice:<userId>`,**只**推属于自己的新通知事件。命中订阅后写入 SSE 帧,
 * 前端 EventSource 收到即 `invalidateQueries(["notice.list"])`。
 *
 * **为什么不上 WebSocket**:通知只是单向(服务端 → 客户端)+ 偶发(几分钟一条)——
 * SSE 的开销、握手、自动重连、原生 `EventSource` 都更贴合这个场景。
 *
 * **鉴权**:继承 better-auth session cookie;未登录返回 401,前端 EventSource 会自动 close。
 * 这里是路由处理器(不是 tRPC ctx),所以用 `#/lib/current-user` 的 `getCurrentUser()` 自己判一次。
 */
import { createFileRoute } from "@tanstack/react-router";

import { getCurrentUser } from "#/lib/current-user";
import { logger } from "#/lib/logger";
import { type SseEvent, subscribe } from "#/lib/sse-bus";

async function handler({ request }: { request: Request }): Promise<Response> {
	const user = await getCurrentUser();
	if (!user) {
		return new Response("请先登录", { status: 401 });
	}
	const channel = `notice:${user.id}`;
	const encoder = new TextEncoder();

	// 清理函数挂在流外层:`cancel()` 也要能调到它。`start` 的**返回值不会被调用**
	// (规范只把它的 thenable 当 promise 用),以前 `return cleanup` 等于没挂。
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			// 立即写一帧让客户端把 readyState 推到 OPEN(避免首条事件来时还没握上手)。
			controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`));

			let closed = false;
			let heartbeat: ReturnType<typeof setInterval> | undefined;
			let unsubscribe = () => {};
			/** 幂等清理:断流的路径不止一条(abort / 写失败 / cancel),谁先到谁干活。 */
			cleanup = () => {
				if (closed) return;
				closed = true;
				if (heartbeat !== undefined) clearInterval(heartbeat);
				unsubscribe();
			};

			const send = (event: SseEvent) => {
				try {
					const payload = JSON.stringify(event.data ?? {});
					controller.enqueue(encoder.encode(`event: ${event.name}\ndata: ${payload}\n\n`));
				} catch (error) {
					// 写失败 = 连接已不可用。这里必须自己清理:反向代理静默断链时
					// `request.signal` 未必 abort,不清理就会留下计时器和订阅(每个标签页一份)。
					logger.warn("sse.encode_failed", { message: (error as Error).message });
					cleanup();
				}
			};

			unsubscribe = subscribe(channel, send);

			// 定期通知客户端重新读取数据库，也覆盖其他进程写入的通知。
			// 该事件同时保持连接活跃；同进程写入仍通过总线即时推送。
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode("event: notice.refresh\ndata: {}\n\n"));
				} catch {
					cleanup();
				}
			}, 25_000);

			// 客户端断开 ⇒ 关流、清订阅、清心跳。
			request.signal.addEventListener("abort", () => {
				cleanup();
				try {
					controller.close();
				} catch {
					// 已经关过就忽略
				}
			});
		},
		cancel() {
			// 消费者主动取消流(适配器在断链后 cancel)时同样要清理。
			cleanup();
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			// 反向代理(nginx)默认会缓冲,显式关掉 —— 否则事件会卡到下一次 flush。
			"X-Accel-Buffering": "no",
		},
	});
}

// 把 onEvent 用好了(导出但作为 route handler 注册)
export const Route = createFileRoute("/api/sse/notice")({
	server: {
		handlers: {
			GET: handler,
		},
	},
});
