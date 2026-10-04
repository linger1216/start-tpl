// 系统设置 ▸ 数据范围:行级可见范围(谁能看到哪张表的哪些行),规则里不存人
import { createFileRoute } from "@tanstack/react-router";

import { SettingsDataScopePage } from "#/components/modules/settings/settings-data-scope-page";
import { PAGE_SIZE_KEY } from "#/hooks/use-para-prefs";

export const Route = createFileRoute("/(main)/settings/data-scope")({
	/** 预取规则清单 + 表格每页条数参数(与其余列表页同一口径:SSR 首帧直出) */
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: PAGE_SIZE_KEY })),
			context.queryClient.ensureQueryData(context.trpc.dataScope.list.queryOptions()),
		]);
	},
	component: SettingsDataScopePage,
});
