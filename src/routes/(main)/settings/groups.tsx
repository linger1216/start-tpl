// 系统设置 ▸ 用户组管理 —— 待实现(数据源未接入,不摆假数据)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsStubPage } from "#/components/modules/settings/settings-stub-page";

export const Route = createFileRoute("/(main)/settings/groups")({
	component: SettingsGroupsPage,
});

function SettingsGroupsPage() {
	return <SettingsStubPage title="用户组管理" summary="用户组台账 + 成员维护 + 组级授权;接上真实接口后重建。" />;
}
