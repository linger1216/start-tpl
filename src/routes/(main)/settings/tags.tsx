// 标签体系 · 系统设置/标签管理(额外增补页,不在菜单清单内)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsTagsPage } from "#/components/modules/settings/settings-tags-page";

export const Route = createFileRoute("/(main)/settings/tags")({
	/**
	 * 预取这一页要用到的数据 —— 与「参数 / 字典管理」同一口径:SSR 首帧直出,
	 * 不先闪一下空表再填。（`标签树`）
	 */
	loader: async ({ context }) => {
		await Promise.all([context.queryClient.ensureQueryData(context.trpc.tag.list.queryOptions())]);
	},
	component: SettingsTagsPage,
});
