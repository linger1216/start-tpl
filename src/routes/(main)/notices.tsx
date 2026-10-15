import { createFileRoute } from "@tanstack/react-router";

import { NoticePage } from "#/components/modules/notice/notice-page";
import { ensurePageSize } from "#/hooks/use-para-prefs";

export const Route = createFileRoute("/(main)/notices")({
	// 与其它台账页同口径:列表在路由里预取,SSR 首帧就有行
	loader: ({ context }) =>
		Promise.all([
			ensurePageSize(context),
			context.queryClient.ensureQueryData(context.trpc.notice.list.queryOptions({ limit: 500 })),
		]),
	component: NoticePage,
});
