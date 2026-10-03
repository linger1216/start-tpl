// 系统设置 ▸ 个人资料(自己的账号:姓名 / 密码 / 邮箱验证)—— 入口在顶栏用户菜单
import { createFileRoute } from "@tanstack/react-router";

import { SettingsProfilePage } from "#/components/modules/settings/settings-profile-page";

export const Route = createFileRoute("/(main)/settings/profile")({
	/**
	 * 预取自己的资料 —— 与其它页面同口径:SSR 首帧直出,不先闪一下"加载中"。
	 * 这一页只有一份数据(没有表格/分页),所以不需要预取页大小之类的偏好。
	 */
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(context.trpc.user.profile.queryOptions());
	},
	component: SettingsProfilePage,
});
