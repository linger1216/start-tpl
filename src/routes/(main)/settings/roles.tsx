// 系统设置 ▸ 角色管理 —— 待实现(数据源未接入,不摆假数据)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsStubPage } from "#/components/modules/settings/settings-stub-page";

export const Route = createFileRoute("/(main)/settings/roles")({
	component: SettingsRolesPage,
});

function SettingsRolesPage() {
	return <SettingsStubPage title="角色管理" summary="角色台账 + 权限点勾选 + 数据范围;接上真实接口后重建。" />;
}
