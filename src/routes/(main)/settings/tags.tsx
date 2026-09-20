// 标签体系 · 系统设置/标签管理(额外增补页,不在菜单清单内)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsTagsPage } from "#/components/modules/settings/settings-tags-page";

export const Route = createFileRoute("/(main)/settings/tags")({
	component: SettingsTagsPage,
});
