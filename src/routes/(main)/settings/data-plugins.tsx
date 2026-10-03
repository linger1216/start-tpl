// 系统设置 ▸ 值域插件:数据范围规则里那个「我」包含哪些值(写接口额外要求超管)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsDataPluginsPage } from "#/components/modules/settings/settings-data-plugins-page";

export const Route = createFileRoute("/(main)/settings/data-plugins")({
	loader: ({ context }) => context.queryClient.ensureQueryData(context.trpc.dataPlugin.list.queryOptions()),
	component: SettingsDataPluginsPage,
});
