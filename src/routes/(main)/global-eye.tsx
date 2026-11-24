import { createFileRoute } from "@tanstack/react-router";

import { GlobalEyeVideoPage } from "#/components/modules/global-eye/page";

export const Route = createFileRoute("/(main)/global-eye")({
	/**
	 * 通道树首次重建很慢 —— **不在 loader 里预取**,否则进入页面会被阻塞、先干等。
	 * 直接渲染页面(先显示 loading),由页面内的 query 去拉取。
	 */
	component: GlobalEyeVideoPage,
});
