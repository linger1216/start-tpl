// 系统设置 ▸ 角色管理(角色台账 + 权限点勾选;权限点是菜单/按钮本身)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsRolesPage } from "#/components/modules/settings/settings-roles-page";
import { PAGE_SIZE_KEY } from "#/hooks/use-page-size";

export const Route = createFileRoute("/(main)/settings/roles")({
	/**
	 * 预取这一页要用到的数据 —— 与「参数 / 字典管理」同一口径:SSR 首帧直出,
	 * 不先闪一下空表再填。（`角色清单 + 权限树`）
	 */
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: PAGE_SIZE_KEY })),
			context.queryClient.ensureQueryData(context.trpc.role.list.queryOptions()),
			context.queryClient.ensureQueryData(context.trpc.menu.list.queryOptions()),
		]);
	},
	component: SettingsRolesPage,
});
