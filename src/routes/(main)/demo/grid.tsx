import { createFileRoute } from "@tanstack/react-router";

import { GridPage } from "#/components/modules/demo/grid-page";
import { PAGE_SIZE_KEY } from "#/hooks/use-page-size";

export const Route = createFileRoute("/(main)/demo/grid")({
	// 与其它台账页同口径:列表在路由里预取,SSR 首帧就有行
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: PAGE_SIZE_KEY })),
			context.queryClient.ensureQueryData(context.trpc.demoGrid.list.queryOptions()),
		]),
	component: GridPage,
});
