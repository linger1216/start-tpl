// 系统设置 ▸ 用户管理 —— 待实现(数据源未接入,不摆假数据)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsStubPage } from "#/components/modules/settings/settings-stub-page";

export const Route = createFileRoute("/(main)/settings/users")({
	component: SettingsUsersPage,
});

function SettingsUsersPage() {
	return <SettingsStubPage title="用户管理" summary="用户台账 + 单用户授权 / 批量授权;接上真实用户接口后重建。" />;
}
