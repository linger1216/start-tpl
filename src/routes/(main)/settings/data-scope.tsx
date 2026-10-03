// 系统设置 ▸ 数据范围:行级可见范围(谁能看到哪张表的哪些行),规则里不存人
import { createFileRoute } from "@tanstack/react-router";

import { SettingsDataScopePage } from "#/components/modules/settings/settings-data-scope-page";

export const Route = createFileRoute("/(main)/settings/data-scope")({
	loader: ({ context }) => context.queryClient.ensureQueryData(context.trpc.dataScope.list.queryOptions()),
	component: SettingsDataScopePage,
});
