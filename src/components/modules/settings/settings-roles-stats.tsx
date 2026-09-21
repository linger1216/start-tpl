import { BarChart3, Database, Layers, ShieldCheck, Users } from "lucide-react";

import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { roleStats } from "#/mocks/settings";
import type { RoleRow } from "./settings-roles-table";

/**
 * 角色管理顶部指标条(四段式布局的第一段,独占一行)。
 *
 * 口径来自契约中枢 `#/mocks/settings` 的 `roleStats(rows)`(纯函数);
 * 本组件只负责"取数 → 组装 StatItem[]",不读 store、不发请求。
 * 「关联用户合计」按多角色数组逐行累加 —— 一个用户持 N 个角色就在 N 行里各计一次。
 */
export function SettingsRolesStats({ rows }: { rows: readonly RoleRow[] }) {
	const stats = roleStats(rows);

	const items: StatItem[] = [
		{
			key: "total",
			label: "角色总数",
			unit: "个",
			value: stats.角色总数,
			description: "全部角色",
			Icon: Layers,
			tone: "bg-hue-blue-soft text-hue-blue-fg",
		},
		{
			key: "enabled",
			label: "启用角色",
			unit: "个",
			value: stats.启用角色,
			description: "可被授予",
			Icon: ShieldCheck,
			tone: "bg-success-soft text-success-fg",
		},
		{
			key: "permissions",
			label: "权限点总量",
			unit: "项",
			value: stats.权限点总量,
			description: `覆盖 ${stats.覆盖模块数} 个一级模块`,
			Icon: Database,
			tone: "bg-hue-violet-soft text-hue-violet-fg",
		},
		{
			key: "users",
			label: "关联用户合计",
			unit: "人次",
			value: stats.关联用户合计,
			description: "多角色用户在各角色下各计一次",
			Icon: Users,
			tone: "bg-hue-teal-soft text-hue-teal-fg",
		},
		{
			key: "average",
			label: "平均权限点数",
			unit: "项",
			value: stats.平均权限点数,
			description: "按角色数取均值",
			Icon: BarChart3,
			tone: "bg-hue-amber-soft text-hue-amber-fg",
		},
	];

	return <StatCards items={items} className="flex-wrap" />;
}
