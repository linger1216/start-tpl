import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, httpBatchStreamLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { ReactNode } from "react";
import superjson from "superjson";
import { TRPCProvider } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";

function getUrl() {
	const base = (() => {
		if (typeof window !== "undefined") return "";
		return `http://localhost:${process.env.PORT ?? 3000}`;
	})();
	return `${base}/api/trpc`;
}

/**
 * tRPC 链接 —— 默认**非流式**(`httpBatchLink`)。
 *
 * 为什么默认非流式:`httpBatchStreamLink` 的响应是 **JSONL「引用协议」**(多行 + 引用指针,
 * `Transfer-Encoding: chunked`),DevTools 的 Response / Preview **读不出来**,排查很痛。
 * 非流式回的是一份**完整 JSON 数组**,DevTools 直接能看,行为与前者完全一致(只是等整批一起返回)。
 *
 * 什么时候才需要流式:批量里某个调用很慢、想让它先回(以及 SSE 订阅)。本项目全是轻查询,用不上。
 *
 * ── 切换开关(一行,不用改代码)────────────────────────────────
 *   `.env.local` 加 `VITE_TRPC_STREAM=1` → 换回流式;删掉/改成别的值 → 回到非流式。
 */
const trpcLinkOptions = { transformer: superjson, url: getUrl() };
const trpcUseStream = import.meta.env.VITE_TRPC_STREAM === "1";

export const trpcClient = createTRPCClient<TRPCRouter>({
	links: [trpcUseStream ? httpBatchStreamLink(trpcLinkOptions) : httpBatchLink(trpcLinkOptions)],
});

export function getContext() {
	const queryClient = new QueryClient({
		defaultOptions: {
			dehydrate: { serializeData: superjson.serialize },
			hydrate: { deserializeData: superjson.deserialize },
		},
	});

	const serverHelpers = createTRPCOptionsProxy({
		client: trpcClient,
		queryClient: queryClient,
	});
	const context = {
		queryClient,
		trpc: serverHelpers,
	};

	return context;
}

export default function TanstackQueryProvider({
	children,
	context,
}: {
	children: ReactNode;
	context: ReturnType<typeof getContext>;
}) {
	const { queryClient } = context;

	return (
		<TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
			{children}
		</TRPCProvider>
	);
}
