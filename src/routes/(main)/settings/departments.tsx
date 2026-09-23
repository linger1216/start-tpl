// 系统设置 ▸ 部门管理(部门树 + 成员/角色)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsDepartmentsPage } from "#/components/modules/settings/settings-departments-page";

export const Route = createFileRoute("/(main)/settings/departments")({
	/**
	 * 预取这一页要用到的数据 —— 与「参数 / 字典管理」同一口径:SSR 首帧直出,
	 * 不先闪一下空表再填。（`部门树 + 成员区要用的角色/用户`）
	 */
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(context.trpc.department.tree.queryOptions()),
			context.queryClient.ensureQueryData(context.trpc.role.list.queryOptions()),
			context.queryClient.ensureQueryData(context.trpc.user.list.queryOptions()),
		]);
	},
	component: SettingsDepartmentsPage,
});
