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
 * 模板里不重读 cookie 鉴权(中间件已经处理),直接用 `requireCurrentUser` 兜底。
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

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			// 立即写一帧让客户端把 readyState 推到 OPEN(避免首条事件来时还没握上手)。
			controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`));

			const send = (event: SseEvent) => {
				try {
					const payload = JSON.stringify(event.data ?? {});
					controller.enqueue(encoder.encode(`event: ${event.name}\ndata: ${payload}\n\n`));
				} catch (error) {
					logger.warn("sse.encode_failed", { message: (error as Error).message });
				}
			};

			const unsubscribe = subscribe(channel, send);

			// 心跳:Nitro 默认不替我们做;每 25 秒写一帧 `: heartbeat`。
			//   注释行(SSE 规范)前端会忽略,但会刷新中间代理的 idle 计时器。
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
				} catch {
					clearInterval(heartbeat);
				}
			}, 25_000);

			// 客户端断开 ⇒ 关流、清订阅、清心跳。
			request.signal.addEventListener("abort", () => {
				clearInterval(heartbeat);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// 已经关过就忽略
				}
			});
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
