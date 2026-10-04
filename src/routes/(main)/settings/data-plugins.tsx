// 系统设置 ▸ 值域插件:数据范围规则里那个「我」包含哪些值
import { createFileRoute } from "@tanstack/react-router";

import { SettingsDataPluginsPage } from "#/components/modules/settings/settings-data-plugins-page";
import { PAGE_SIZE_KEY } from "#/hooks/use-para-prefs";

export const Route = createFileRoute("/(main)/settings/data-plugins")({
	/** 预取插件清单 + 表格每页条数参数(与其余列表页同一口径:SSR 首帧直出) */
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: PAGE_SIZE_KEY })),
			context.queryClient.ensureQueryData(context.trpc.dataPlugin.list.queryOptions()),
		]);
	},
	component: SettingsDataPluginsPage,
});
