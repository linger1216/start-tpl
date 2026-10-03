import { createFileRoute } from "@tanstack/react-router";

import { BusinessHomeDemo } from "#/components/modules/demo/business-home-page";

export const Route = createFileRoute("/(main)/demo/business-home")({
	// 与其它台账页同口径:首屏预取,SSR 直接拿到统计数 + 最近 5 条
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(context.trpc.user.list.queryOptions()),
			context.queryClient.ensureQueryData(context.trpc.department.tree.queryOptions()),
			context.queryClient.ensureQueryData(context.trpc.role.list.queryOptions()),
			context.queryClient.ensureQueryData(context.trpc.notice.list.queryOptions({ limit: 5 })),
			context.queryClient.ensureQueryData(context.trpc.log.list.queryOptions({ limit: 5 })),
		]),
	component: BusinessHomeDemo,
});
