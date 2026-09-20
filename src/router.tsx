import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import TanstackQueryProvider, { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

/**
 * 路由实例工厂 —— **TanStack Start 按约定路径发现本文件**(`src/router.tsx`),
 * 不需要任何地方 import 它;插件调 `getRouter()` 拿实例。
 *
 * 三件事都在这里接线:
 *  1. `getContext()`(见 `integrations/tanstack-query/root-provider.tsx`)造出
 *     `{ queryClient, trpc }` —— 于是路由 `loader` 里能直接用
 *     `context.queryClient.ensureQueryData(context.trpc.xxx.queryOptions())` 预取数据;
 *  2. `Wrap` 把 `TRPCProvider` 包在最外层,客户端组件才能 `useTRPC()`;
 *  3. `setupRouterSsrQueryIntegration` 负责 SSR 的 Query 脱水 / 注水 ——
 *     少了它,`loader` 预取的数据首屏拿不到,页面会闪一下 loading。
 *
 * ⚠️ **不要删这个文件**:它不在任何 import 图里(纯靠约定路径被插件加载),
 * 所以"扫引用找死代码"的脚本会误判它是孤儿。删了直接起不来服务。
 */
export function getRouter() {
	const context = getContext();

	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		Wrap: (props) => <TanstackQueryProvider context={context}>{props.children}</TanstackQueryProvider>,
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient: context.queryClient,
	});

	return router;
}
