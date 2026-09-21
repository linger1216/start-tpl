import { BadgeCheck, Layers, ShieldCheck, UserSquare, Users } from "lucide-react";

import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { groupStats } from "#/mocks/settings";
import type { GroupRow } from "./settings-groups-table";

/**
 * 用户组管理顶部指标条(四段式布局的第一段,独占一行)。
 *
 * 口径来自契约中枢 `#/mocks/settings` 的 `groupStats(rows)`(纯函数);
 * 本组件只负责"取数 → 组装 StatItem[]",不读 store、不发请求。
 * 「组内成员合计」按组内成员数组求和 —— 多组用户在所属的每个组里各计一次,与表内列口径一致。
 */
export function SettingsGroupsStats({ rows }: { rows: readonly GroupRow[] }) {
	const stats = groupStats(rows);

	const items: StatItem[] = [
		{
			key: "total",
			label: "用户组数",
			unit: "个",
			value: stats.用户组数,
			description: "全部用户组",
			Icon: UserSquare,
			tone: "bg-hue-blue-soft text-hue-blue-fg",
		},
		{
			key: "members",
			label: "组内成员合计",
			unit: "人次",
			value: stats.组内成员合计,
			description: "多组用户在每组各计一次",
			Icon: Users,
			tone: "bg-hue-teal-soft text-hue-teal-fg",
		},
		{
			key: "granted",
			label: "已授权的组",
			unit: "个",
			value: stats.已授权的组,
			description: "组权限点非空",
			Icon: ShieldCheck,
			tone: "bg-hue-violet-soft text-hue-violet-fg",
		},
		{
			key: "average",
			label: "平均成员数",
			unit: "人",
			value: stats.平均成员数,
			description: "按组数取均值",
			Icon: Layers,
			tone: "bg-hue-amber-soft text-hue-amber-fg",
		},
		{
			key: "ready",
			label: "可继承授权",
			unit: "个",
			value: stats.已授权的组,
			description: "组内成员继承组授权",
			Icon: BadgeCheck,
			tone: "bg-success-soft text-success-fg",
		},
	];

	return <StatCards items={items} className="flex-wrap" />;
}
