import { createFileRoute } from "@tanstack/react-router";

import { GridPage } from "#/components/modules/demo/grid-page";

export const Route = createFileRoute("/(main)/demo/grid")({
	// 与其它台账页同口径:列表在路由里预取,SSR 首帧就有行
	loader: ({ context }) => context.queryClient.ensureQueryData(context.trpc.demoGrid.list.queryOptions()),
	component: GridPage,
});
