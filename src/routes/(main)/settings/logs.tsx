import { createFileRoute } from "@tanstack/react-router";

import { SettingsLogsPage } from "#/components/modules/settings/settings-logs-page";

export const Route = createFileRoute("/(main)/settings/logs")({
	/**
	 * 列表数据在路由里预取(与参数 / 字典 / 文件页同一口径):
	 * 否则 SSR 只直出卡片壳,行要等 hydration 才出现。
	 */
	loader: ({ context }) => context.queryClient.ensureQueryData(context.trpc.log.list.queryOptions()),
	component: SettingsLogsPage,
});
