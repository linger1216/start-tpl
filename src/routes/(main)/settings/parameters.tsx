// 系统设置 ▸ 参数管理:raw 保留策略与对接同步开关(运维口径不写死在代码里)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsParametersPage } from "#/components/modules/settings/settings-parameters-page";
import { ensurePageSize } from "#/hooks/use-para-prefs";

export const Route = createFileRoute("/(main)/settings/parameters")({
	loader: ({ context }) =>
		Promise.all([ensurePageSize(context), context.queryClient.ensureQueryData(context.trpc.para.list.queryOptions())]),
	component: SettingsParametersPage,
});
