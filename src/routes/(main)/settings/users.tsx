// 系统设置/用户管理(单用户授权) · 系统设置/用户管理(批量授权)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsUsersPage } from "#/components/modules/settings/settings-users-page";

export const Route = createFileRoute("/(main)/settings/users")({
	component: SettingsUsersPage,
});
