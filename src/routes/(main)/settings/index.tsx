// 系统设置模块首页 —— 内容由导航树(菜单接口)派生,详见 module-overview.tsx
import { createFileRoute } from "@tanstack/react-router";

import { ModuleOverview } from "#/components/layout/module-overview";

export const Route = createFileRoute("/(main)/settings/")({
	component: () => <ModuleOverview path="/settings" />,
});
