import type { LucideIcon } from "lucide-react";
import {
	BarChart3,
	ClipboardCheck,
	ClipboardList,
	Database,
	FileStack,
	Gauge,
	Layers,
	Repeat2,
	ShieldCheck,
	Tags,
	TrendingUp,
	Users,
	Wallet,
} from "lucide-react";

import type { StatItem } from "#/components/modules/shared/stat-cards";

/**
 * 指标卡的**语义组装层** —— 把「语义图标 + 语义配色」从各页的 `-stats.tsx` 里收上来。
 *
 * 为什么需要它:`stat-cards.tsx` 的 `StatItem` 要求每个调用方自己给 `Icon` 与 `tone`
 * (那是对的 —— 它是纯展示件,不该认识业务语义),但结果是 60 个页面各自 import 图标、
 * 各自挑一对浅底色,同一类指标在不同页里图标不一样、配色也不一样。
 *
 * 这里定义一套**固定的语义词表**:指标说的是什么(总量 / 合规 / 待办 / 标签 / 金额…),
 * 而不是它长什么样。各页只声明语义,外观由本文件统一裁决。
 *
 * 口径:指标数值本身仍然是**纯统计函数**的产物(在各页契约中枢里算),本文件不碰数据。
 */

/** 指标语义 → 图标(全站统一:同一语义在任何页面都是同一个图标) */
const METRIC_ICONS = {
	total: Layers,
	checked: ClipboardCheck,
	pending: ClipboardList,
	db: Database,
	file: FileStack,
	people: Users,
	money: Wallet,
	tags: Tags,
	sync: Repeat2,
	chart: BarChart3,
	gauge: Gauge,
	trend: TrendingUp,
	safe: ShieldCheck,
} satisfies Record<string, LucideIcon>;

/** 指标语义名 */
export type MetricIcon = keyof typeof METRIC_ICONS;

/** 指标语义 → 图标底色 + 文字色(只用规范内的功能色,不引入新色板) */
const METRIC_TONES: Record<MetricIcon, string> = {
	total: "bg-primary/10 text-primary",
	checked: "bg-success-soft text-success-fg",
	pending: "bg-warn-soft text-warn-fg",
	db: "bg-primary/10 text-primary",
	file: "bg-secondary text-secondary-foreground",
	people: "bg-primary/10 text-primary",
	money: "bg-success-soft text-success-fg",
	tags: "bg-warn-soft text-warn-fg",
	sync: "bg-secondary text-secondary-foreground",
	chart: "bg-primary/10 text-primary",
	gauge: "bg-warn-soft text-warn-fg",
	trend: "bg-success-soft text-success-fg",
	safe: "bg-success-soft text-success-fg",
};

/** 一条指标的语义声明 —— 只描述「这是什么指标」,不描述「长什么样」 */
export type StatSpec = {
	key: string;
	label: string;
	value: number | string;
	/** 单位后缀,如「条」「个」「家」 */
	unit?: string;
	description?: string;
	icon: MetricIcon;
	/** 趋势与 sparkline 需要时再显式给(不参与语义映射,由调用方按真实数据决定) */
	trend?: StatItem["trend"];
	delta?: string;
	spark?: StatItem["spark"];
	sparkPoints?: string;
};

/** 语义声明 → `StatCards` 需要的 items;各页 `-stats.tsx` 只调用这一句 */
export function statItems(specs: readonly StatSpec[]): StatItem[] {
	return specs.map((spec) => ({
		key: spec.key,
		label: spec.label,
		value: spec.value,
		unit: spec.unit,
		description: spec.description,
		Icon: METRIC_ICONS[spec.icon],
		tone: METRIC_TONES[spec.icon],
		trend: spec.trend,
		delta: spec.delta,
		spark: spec.spark,
		sparkPoints: spec.sparkPoints,
	}));
}

/** 可用语义清单(展示台与文档用) */
export const METRIC_ICON_NAMES = Object.keys(METRIC_ICONS) as MetricIcon[];
