import { CalendarClock, Layers, UserCheck, Users, UserX } from "lucide-react";

import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { userStats } from "#/mocks/settings";
import type { UserRow } from "./settings-users-table";

/**
 * 用户管理顶部指标条(四段式布局的第一段,独占一行)。
 *
 * 口径来自契约中枢 `#/mocks/settings` 的 `userStats(rows)`(纯函数);
 * 本组件只负责"取数 → 组装 StatItem[]",不读 store、不发请求。
 * 「覆盖用户组数」按 的多值数组展开去重 —— 一人多组不会被算成一个新组。
 */
export function SettingsUsersStats({ rows }: { rows: readonly UserRow[] }) {
	const stats = userStats(rows);

	const items: StatItem[] = [
		{
			key: "total",
			label: "用户总数",
			unit: "人",
			value: stats.用户总数,
			description: "账号台账全量",
			Icon: Users,
			tone: "bg-primary/10 text-primary",
		},
		{
			key: "enabled",
			label: "启用用户",
			unit: "人",
			value: stats.启用用户,
			description: "可正常登录",
			Icon: UserCheck,
			tone: "bg-success-soft text-success-fg",
		},
		{
			key: "disabled",
			label: "停用 / 锁定",
			unit: "人",
			value: stats.停用锁定,
			description: "需复核后放开",
			Icon: UserX,
			tone: "bg-danger-soft text-danger-fg",
		},
		{
			key: "groups",
			label: "覆盖用户组数",
			unit: "个",
			value: stats.覆盖用户组数,
			description: "按多组归属去重",
			Icon: Layers,
			tone: "bg-warn-soft text-warn-fg",
		},
		{
			key: "active",
			label: "近 30 天有登录",
			unit: "人",
			value: stats.近30天有登录,
			description: "活跃账号",
			Icon: CalendarClock,
			tone: "bg-secondary text-secondary-foreground",
		},
	];

	return <StatCards items={items} className="flex-wrap" />;
}
