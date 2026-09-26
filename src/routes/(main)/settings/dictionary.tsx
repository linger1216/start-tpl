// 系统设置 ▸ 字典管理:全系统共用字典表 sys_dict 的维护页
import { createFileRoute } from "@tanstack/react-router";

import { SettingsDictionaryPage } from "#/components/modules/settings/settings-dictionary-page";
import { PAGE_SIZE_KEY } from "#/hooks/use-page-size";

export const Route = createFileRoute("/(main)/settings/dictionary")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: PAGE_SIZE_KEY })),
			context.queryClient.ensureQueryData(context.trpc.dict.list.queryOptions()),
		]),
	component: SettingsDictionaryPage,
});
