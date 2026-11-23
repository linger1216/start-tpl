/**
 * 全球眼播放代理 —— `/api/globaleye/stream`。
 *
 * **为什么又一个 REST 端点(AGENTS「接口只有 tRPC」的第 4 个例外)**:
 *  1. 平台的取流地址**不带 CORS 头**,浏览器里的 hls.js / `<video>` 跨域读不了它的 m3u8 与分片 ——
 *     这是浏览器同源策略,任何前端方案都绕不过去,只能在**服务端**取数再转发;
 *  2. 它是**流式 GET**(可能持续拉分片、需要 206/透传),tRPC(superjson JSON)接不住二进制流;
 *  3. 顺带解决平台的自签证书:服务端用 `rejectUnauthorized:false` 拉取,浏览器侧看到的是本服务的正规证书。
 *
 * **安全**(不能做成开放代理):
 *  - 只接受**本服务签过名**的目标地址(`u` + HMAC `s`),签名由 `streamUrl` 查询下发 —— 攻击者造不出任意 `u`;
 *  - 仍然**要求登录**(与 `/api/sse/notice` 同口径),未登录 401;
 *  - 只放行 http / https。
 *
 * **HLS 改写**:播放列表(m3u8)里每条分片 / 子播放列表 URI 都会换成代理地址,保证后续请求也在同源,
 * 否则第一条就成了、分片照样跨域。
 */
import { createFileRoute } from "@tanstack/react-router";

import { getCurrentUser } from "#/lib/current-user";
import {
	isHlsPlaylist,
	openGlobalEyeStream,
	readStreamText,
	rewriteHlsPlaylist,
	toWebStream,
	verifyGlobalEyeTarget,
} from "#/lib/global-eye";

/** 透传给浏览器的响应头(白名单,别把上游的 set-cookie 之类带出去) */
const PASSTHROUGH_HEADERS = [
	"content-type",
	"content-length",
	"content-range",
	"accept-ranges",
	"last-modified",
	"etag",
];

async function handler({ request }: { request: Request }): Promise<Response> {
	if (request.method !== "GET") return new Response("仅支持 GET", { status: 405 });

	const user = await getCurrentUser();
	if (!user) return new Response("请先登录", { status: 401 });

	const url = new URL(request.url);
	const target = url.searchParams.get("u");
	const signature = url.searchParams.get("s") ?? "";
	if (!target || !verifyGlobalEyeTarget(target, signature)) {
		return new Response("无效的取流地址", { status: 400 });
	}

	let targetUrl: URL;
	try {
		targetUrl = new URL(target);
	} catch {
		return new Response("无效的取流地址", { status: 400 });
	}
	if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
		return new Response("不支持的取流协议", { status: 400 });
	}

	// 转发 Range(部分播放器对分片会带);其余请求头不透传
	const range = request.headers.get("range");
	let upstream: Awaited<ReturnType<typeof openGlobalEyeStream>>;
	try {
		upstream = await openGlobalEyeStream(target, range ? { range } : {});
	} catch (error) {
		return new Response(`取流失败:${error instanceof Error ? error.message : String(error)}`, { status: 502 });
	}

	// 浏览器断开 ⇒ 关掉上游流,别让分片连接挂着
	request.signal.addEventListener("abort", () => upstream.stream.destroy());

	const contentType = upstream.headers["content-type"];
	const isPlaylist = isHlsPlaylist(
		typeof contentType === "string" ? contentType : undefined,
		new URL(upstream.finalUrl).pathname,
	);
	if (isPlaylist) {
		const text = await readStreamText(upstream.stream);
		return new Response(rewriteHlsPlaylist(text, upstream.finalUrl), {
			status: 200,
			headers: {
				"content-type": "application/vnd.apple.mpegurl",
				"cache-control": "no-store",
			},
		});
	}

	const headers: Record<string, string> = {};
	for (const key of PASSTHROUGH_HEADERS) {
		const value = upstream.headers[key];
		if (typeof value === "string") headers[key] = value;
	}
	return new Response(toWebStream(upstream.stream), { status: upstream.status, headers });
}

export const Route = createFileRoute("/api/globaleye/stream")({
	server: {
		handlers: {
			GET: handler,
		},
	},
});
