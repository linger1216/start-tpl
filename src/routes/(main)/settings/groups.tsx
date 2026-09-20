// 系统设置/用户组管理(可添加删除用户,并且可以给整个组进行授权)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsGroupsPage } from "#/components/modules/settings/settings-groups-page";

export const Route = createFileRoute("/(main)/settings/groups")({
	component: SettingsGroupsPage,
});
