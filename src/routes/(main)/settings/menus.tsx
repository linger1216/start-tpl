// 系统设置 ▸ 菜单管理:菜单树的排序 / 编辑(数据源就是运行时菜单表 menu)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsMenusPage } from "#/components/modules/settings/settings-menus-page";

export const Route = createFileRoute("/(main)/settings/menus")({
	/**
	 * 预取这一页要用到的数据 —— 与「参数 / 字典管理」同一口径:SSR 首帧直出,
	 * 不先闪一下空表再填。（`菜单树`）
	 */
	loader: async ({ context }) => {
		await Promise.all([context.queryClient.ensureQueryData(context.trpc.menu.list.queryOptions())]);
	},
	component: SettingsMenusPage,
});
