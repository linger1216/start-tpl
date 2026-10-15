// 系统设置 ▸ 用户管理(只读账号台账 + 部门/角色授权)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsUsersPage } from "#/components/modules/settings/settings-users-page";
import { ensurePageSize } from "#/hooks/use-para-prefs";

export const Route = createFileRoute("/(main)/settings/users")({
	/**
	 * 预取这一页要用到的数据 —— 与「参数 / 字典管理」同一口径:SSR 首帧直出,
	 * 不先闪一下空表再填。（`用户台账 + 授权对话框要用的部门/角色`）
	 */
	loader: async ({ context }) => {
		await Promise.all([
			ensurePageSize(context),
			context.queryClient.ensureQueryData(context.trpc.user.list.queryOptions()),
			context.queryClient.ensureQueryData(context.trpc.department.tree.queryOptions()),
			context.queryClient.ensureQueryData(context.trpc.role.list.queryOptions()),
		]);
	},
	component: SettingsUsersPage,
});
