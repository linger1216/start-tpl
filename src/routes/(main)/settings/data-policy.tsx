// 系统设置 ▸ 数据权限:行级数据权限的直白授权规则(谁 × 看什么 × 动作 × 允许/拒绝)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsDataPolicyPage } from "#/components/modules/settings/settings-data-policy-page";
import { PAGE_SIZE_KEY } from "#/hooks/use-para-prefs";

export const Route = createFileRoute("/(main)/settings/data-policy")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: PAGE_SIZE_KEY })),
			context.queryClient.ensureQueryData(context.trpc.policy.list.queryOptions()),
		]),
	component: SettingsDataPolicyPage,
});
