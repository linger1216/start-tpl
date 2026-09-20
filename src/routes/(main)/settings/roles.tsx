// 系统设置/角色管理(根据角色信息对用户进行授权管理)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsRolesPage } from "#/components/modules/settings/settings-roles-page";

export const Route = createFileRoute("/(main)/settings/roles")({
	component: SettingsRolesPage,
});
