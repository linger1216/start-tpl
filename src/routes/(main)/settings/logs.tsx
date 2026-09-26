import { createFileRoute } from "@tanstack/react-router";

import { SettingsLogsPage } from "#/components/modules/settings/settings-logs-page";
import { PAGE_SIZE_KEY } from "#/hooks/use-page-size";

export const Route = createFileRoute("/(main)/settings/logs")({
	/**
	 * 列表数据在路由里预取(与参数 / 字典 / 文件页同一口径):
	 * 否则 SSR 只直出卡片壳,行要等 hydration 才出现。
	 */
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: PAGE_SIZE_KEY })),
			context.queryClient.ensureQueryData(context.trpc.log.list.queryOptions()),
		]),
	component: SettingsLogsPage,
});
