import { BadgeCheck, Layers, Tag, Tags } from "lucide-react";

import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { type TagDimension, type TagItem, tagDimensionStats, tagStats } from "#/mocks/tags";

/**
 * 标签管理顶部指标条(四段式布局的第一段,独占一行)。
 *
 * 口径来自契约中枢 `#/mocks/tags` 的两个纯函数(`tagDimensionStats` / `tagStats`),
 * 本组件只负责"取数 → 组装 StatItem[]",不读 store、不发请求。
 * 「标签数」两张表同源:维度数来自维度表,标签数来自明细表,不存在第二份计数。
 */
export function SettingsTagsStats({
	dimensionRows,
	tagRows,
}: {
	dimensionRows: readonly TagDimension[];
	tagRows: readonly TagItem[];
}) {
	const dimensionStats = tagDimensionStats(dimensionRows);
	const stats = tagStats(tagRows);

	const items: StatItem[] = [
		{
			key: "dimensions",
			label: "标签维度",
			unit: "个",
			value: dimensionStats.标签维度,
			description: "按数据对象分组",
			Icon: Tags,
			tone: "bg-primary/10 text-primary",
		},
		{
			key: "tags",
			label: "标签总数",
			unit: "条",
			value: stats.标签总数,
			description: "标签明细全量",
			Icon: Tag,
			tone: "bg-warn-soft text-warn-fg",
		},
		{
			key: "meaning",
			label: "含义完整",
			unit: "条",
			value: stats.含义完整,
			description: "含义非空,可作 tooltip",
			Icon: BadgeCheck,
			tone: "bg-success-soft text-success-fg",
		},
		{
			key: "covered",
			label: "已挂标签维度",
			unit: "个",
			value: stats.覆盖维度数,
			description: "至少有一条标签",
			Icon: Layers,
			tone: "bg-secondary text-secondary-foreground",
		},
		{
			key: "noted",
			label: "原文未枚举维度",
			unit: "个",
			value: dimensionStats.有备注维度,
			description: "备注里记录了补齐口径",
			Icon: Tags,
			tone: "bg-secondary text-secondary-foreground",
		},
	];

	return <StatCards items={items} className="flex-wrap" />;
}
