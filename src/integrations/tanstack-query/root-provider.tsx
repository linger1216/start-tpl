import { QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
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
 * 服务端那次 tRPC 请求要**带上浏览器的 cookie**。
 *
 * 为什么:`menu.mine` 是"认人"的查询,而 SSR 期间的 tRPC 调用是**服务端 fetch 自己**
 * (走 `http://localhost:PORT/api/trpc`)—— 不转发 cookie 它认不到会话,首屏就会先渲染出
 * 未过滤的菜单,客户端再收窄 = 闪一下。
 *
 * ⚠️ 为什么用 `createIsomorphicFn` 而不是"`typeof window === "undefined"` 分支 + 动态 import":
 * `@tanstack/react-start/server` 是 **server-only**,只要它出现在一个**客户端可达**的文件里
 * (哪怕在 `window` 判断后面、哪怕写成 `await import(...)`),Start 的 **import-protection 插件
 * 会在构建期直接报错**——实测整个构建挂掉(`RolldownError`,提示就是"用 createIsomorphicFn")。
 * 这个写法它认得:客户端分支与服务端专属导入会在构建时各自消失。
 *
 * 只转发 `cookie`(host / content-length 交给 fetch 自己算)。
 */
const trpcFetch = createIsomorphicFn()
	.server(async (input: RequestInfo | URL, init?: RequestInit) => {
		const { getRequestHeaders } = await import("@tanstack/react-start/server");
		const cookie = getRequestHeaders().get("cookie");
		const headers = new Headers(init?.headers);
		if (cookie) headers.set("cookie", cookie);
		return fetch(input, { ...init, headers });
	})
	.client((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

export function getContext() {
	// SSR 每个路由实例独立持有批处理队列，避免不同请求共用认证上下文。
	const trpcClient = createTRPCClient<TRPCRouter>({
		links: [httpBatchLink({ transformer: superjson, url: getUrl(), fetch: trpcFetch })],
	});
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
		trpcClient,
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
	const { queryClient, trpcClient } = context;

	return (
		<TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
			{children}
		</TRPCProvider>
	);
}
