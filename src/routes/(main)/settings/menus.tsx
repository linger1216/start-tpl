// 系统设置 ▸ 菜单管理:菜单树的排序 / 编辑(数据源就是运行时菜单表 menu)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsMenusPage } from "#/components/modules/settings/settings-menus-page";

export const Route = createFileRoute("/(main)/settings/menus")({
	component: SettingsMenusPage,
});
