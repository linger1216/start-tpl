import { createFileRoute } from "@tanstack/react-router";

import { GlobalEyeVideoPage } from "#/components/modules/global-eye/page";

export const Route = createFileRoute("/(main)/global-eye")({
	/**
	 * 预取通道树(SSR 首帧直出)。外部平台可能不可达,这里 `.catch` 掉 ——
	 * 不让一次外部故障把整页打进路由错误边界,页面自己按 query 的 error 态给中文提示。
	 */
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(context.trpc.globalEye.channelTree.queryOptions()).catch(() => undefined),
	component: GlobalEyeVideoPage,
});
