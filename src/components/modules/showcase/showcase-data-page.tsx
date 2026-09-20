import { AlertCircle, CircleGauge, Layers, TrendingUp } from "lucide-react";

import { PropTable, ShowcaseItem, ShowcasePage, ShowcaseSection } from "#/components/layout/showcase";
import { CatalogBanner } from "#/components/modules/shared/catalog-banner";
import { BarChart, DonutChart, LineChart, RankBars, Timeline } from "#/components/modules/shared/mini-chart";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { METRIC_ICON_NAMES, type StatSpec, statItems } from "#/components/modules/shared/stat-kit";
import { Card, CardContent } from "#/components/ui/card";

/**
 * 数据展示页 —— 把数据**渲染成可读形状**的展示件:指标条 / 柱 / 折线 / 环形 / 排行 / 时间轴。
 *
 * 这一层的图形全部用 SVG + CSS 变量手写,**不引第三方图表库** —— 需求只覆盖三种形态,
 * 引一个库换可定制的样式,不值。
 *
 * 颜色走 `src/styles.css` 的语义 token(CHART_TONES 提供 5 个轮转槽),
 * 调色板改动只需改 token,不用动调用处。
 */

const BAR = [
	{ label: "周一", value: 12 },
	{ label: "周二", value: 18 },
	{ label: "周三", value: 9 },
	{ label: "周四", value: 23 },
	{ label: "周五", value: 31 },
	{ label: "周六", value: 4 },
	{ label: "周日", value: 2 },
];

const RANK = [
	{ label: "消防安全", value: 87 },
	{ label: "食品安全", value: 64 },
	{ label: "施工安全", value: 52 },
	{ label: "环保投诉", value: 41 },
	{ label: "其他事项", value: 28 },
	{ label: "其他", value: 16 },
];

const DONUT = [
	{ label: "已处理", value: 184 },
	{ label: "处理中", value: 67 },
	{ label: "待复核", value: 23 },
];

const TREND = [
	{ label: "08-12", value: 22 },
	{ label: "08-13", value: 31 },
	{ label: "08-14", value: 26 },
	{ label: "08-15", value: 40 },
	{ label: "08-16", value: 35 },
	{ label: "08-17", value: 47 },
	{ label: "08-18", value: 52 },
	{ label: "08-19", value: 44 },
	{ label: "08-20", value: 58 },
	{ label: "08-21", value: 61 },
	{ label: "08-22", value: 55 },
	{ label: "08-23", value: 68 },
];

const TIMELINE = [
	{
		time: "2026-08-12 10:32",
		title: "现场检查",
		description: "营业执照、消防安全两项通过,食品卫生待复核。",
		tone: "text-primary",
	},
	{
		time: "2026-08-13 14:20",
		title: "复核完成",
		description: "食品卫生现场抽检合格,记录已归档。",
		tone: "text-success-fg",
	},
	{
		time: "2026-08-15 09:05",
		title: "整改通知",
		description: "经营场所动线调整,要求一周内完成。",
		tone: "text-warn-fg",
	},
	{ time: "2026-08-21 11:10", title: "整改复核", description: "动线已调整,通知单关闭。", tone: "text-success-fg" },
];

const STAT_ITEMS: StatItem[] = [
	{
		key: "total",
		label: "在档对象",
		description: "覆盖三类",
		value: 18742,
		unit: "条",
		Icon: Layers,
		tone: "bg-primary/10 text-primary",
		trend: "up",
		delta: "+12.4%",
		spark: "blue",
		sparkPoints: "0,16 8,14 16,15 24,11 32,9 40,8 48,5 56,3",
	},
	{
		key: "today",
		label: "今日新增",
		value: 86,
		unit: "条",
		Icon: CircleGauge,
		tone: "bg-secondary text-secondary-foreground",
		trend: "flat",
		delta: "持平",
		spark: "amber",
		sparkPoints: "0,8 8,6 16,9 24,7 32,5 40,7 48,6 56,4",
	},
	{
		key: "alert",
		label: "异常待复核",
		value: 23,
		unit: "条",
		Icon: AlertCircle,
		tone: "bg-warn-soft text-warn-fg",
		trend: "down",
		delta: "-5.1%",
		spark: "green",
		sparkPoints: "0,4 8,6 16,5 24,8 32,7 40,9 48,8 56,12",
	},
	{
		key: "events",
		label: "近 30 天事件",
		value: 1328,
		unit: "次",
		Icon: TrendingUp,
		tone: "bg-success-soft text-success-fg",
		trend: "up",
		delta: "+3.2%",
		spark: "blue",
		sparkPoints: "0,14 8,12 16,11 24,9 32,8 40,6 48,5 56,3",
	},
];

/** 指标语义层的示例声明 —— 只描述「是什么指标」,外观交给 stat-kit */
const SPEC_ITEMS: StatSpec[] = [
	{
		key: "total",
		label: "在档对象",
		description: "覆盖三类",
		value: 18742,
		unit: "条",
		icon: "total",
		trend: "up",
		delta: "+12.4%",
		spark: "blue",
		sparkPoints: "0,16 8,14 16,15 24,11 32,9 40,8 48,5 56,3",
	},
	{ key: "today", label: "今日新增", value: 86, unit: "条", icon: "pending", trend: "flat", delta: "持平" },
	{
		key: "alert",
		label: "异常待复核",
		value: 23,
		unit: "条",
		icon: "gauge",
		trend: "down",
		delta: "-5.1%",
		spark: "green",
		sparkPoints: "0,4 8,6 16,5 24,8 32,7 40,9 48,8 56,12",
	},
	{
		key: "events",
		label: "近 30 天事件",
		value: 1328,
		unit: "次",
		icon: "trend",
		trend: "up",
		delta: "+3.2%",
		spark: "blue",
		sparkPoints: "0,14 8,12 16,11 24,9 32,8 40,6 48,5 56,3",
	},
];

export function ShowcaseDataPage() {
	return (
		<ShowcasePage
			title="数据展示"
			description="指标条 + 柱 / 折线 / 环形 / 排行 + 时间轴 + 编目信息条。所有图形用 SVG 手写,颜色走语义 token。"
			toc={[
				["stat", "顶部指标条"],
				["stat-semantic", "指标语义层"],
				["bar", "柱状图"],
				["donut", "环形图"],
				["line", "折线图"],
				["rank", "排行条"],
				["timeline", "时间轴"],
				["catalog", "编目信息条"],
				["api", "图表 API 速查"],
			]}
		>
			<ShowcaseSection
				id="stat"
				title="顶部指标条"
				description="横向铺开的 4 卡,带趋势 chip + sparkline。常见于工作台与模块概览页。"
			>
				<ShowcaseItem
					name="StatCards"
					summary="指标条(strip / cards 两态)"
					source="shared/stat-cards.tsx"
					demo={
						<div className="space-y-3">
							<StatCards items={STAT_ITEMS} />
							<StatCards items={STAT_ITEMS.slice(0, 4)} variant="cards" />
						</div>
					}
					code={`const items: StatItem[] = [
  { key: "total", label: "在档对象", value: 18742, unit: "条",
    Icon: Layers, tone: "bg-primary/10 text-primary",
    trend: "up", delta: "+12.4%",
    spark: "blue", sparkPoints: "0,16 8,14 16,15 24,11 32,9 40,8 48,5 56,3" },
];
<StatCards items={items} />            // 横向铺开
<StatCards items={items} variant="cards" />  // 独立小卡片`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="stat-semantic"
				title="指标语义层"
				description="`StatCards` 要求调用方自己给 `Icon` 与 `tone`(它不该认识业务语义)—— 于是语义映射收在 `stat-kit.ts`。各页只声明「这是什么指标」,长什么样由这里统一裁决。"
			>
				<ShowcaseItem
					name="statItems"
					summary="语义声明 → StatCards 的 items"
					source="shared/stat-kit.ts"
					note={
						<>
							为什么不让页面直接传 <code className="font-mono">Icon</code>:60 个页面各 import 一次图标、各挑一对浅底色,
							同一类指标在不同页里就会长成不同的样子。这里定一套
							<strong className="text-foreground">固定的语义词表</strong>
							—— 指标说的是什么(总量 / 合规 / 待办 / 标签 / 金额…),而不是它长什么样。
							<code className="font-mono">statItems()</code> 不碰数据,数值仍是各页契约中枢里纯统计函数的产物。
						</>
					}
					demo={<StatCards items={statItems(SPEC_ITEMS)} />}
					code={`const specs: StatSpec[] = [
  { key: "total", label: "在档对象", value: 18742, unit: "条", icon: "total" },
  { key: "pending", label: "待复核", value: 23, unit: "条", icon: "pending",
    trend: "down", delta: "-5.1%" },
];

<StatCards items={statItems(specs)} />`}
				/>
				<ShowcaseItem
					name="可用语义名"
					summary="METRIC_ICON_NAMES —— 图标与配色都由这一组键决定"
					source="shared/stat-kit.ts"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-1.5">
							{METRIC_ICON_NAMES.map((name) => (
								<span
									key={name}
									className="rounded-full border border-border px-2.5 py-1 font-mono text-[11.5px] text-foreground"
								>
									{name}
								</span>
							))}
							<span className="text-[12px] text-muted-foreground">
								(共 {METRIC_ICON_NAMES.length} 个;`trend` / `spark` 不参与语义映射,需要时显式给)
							</span>
						</div>
					}
					code={`// 语义名 → 图标 + 配色,全站唯一
{ key: "total", label: "…", value: 0, icon: "total" }`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="bar" title="柱状图">
				<ShowcaseItem
					name="BarChart"
					summary="柱状图,按值等比"
					source="shared/mini-chart.tsx"
					dense
					demo={<BarChart data={BAR} height={180} />}
					code={`<BarChart data={[{label:"周一",value:12},…]} height={180} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="donut" title="环形图">
				<ShowcaseItem
					name="DonutChart"
					summary="环形 + 图例,中央显示合计"
					source="shared/mini-chart.tsx"
					demo={<DonutChart data={DONUT} />}
					code={`<DonutChart data={[
  {label:"已处理",value:184},{label:"处理中",value:67},{label:"待复核",value:23}
]} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="line" title="折线图">
				<ShowcaseItem
					name="LineChart"
					summary="趋势折线 + 浅色面积"
					source="shared/mini-chart.tsx"
					dense
					demo={<LineChart data={TREND} height={180} />}
					code={`<LineChart data={trend} height={180} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="rank" title="排行条">
				<ShowcaseItem
					name="RankBars"
					summary="横向排行(标签分布 / 企业排名)"
					source="shared/mini-chart.tsx"
					demo={
						<Card size="sm" className="max-w-md">
							<CardContent className="pt-4">
								<RankBars data={RANK} />
							</CardContent>
						</Card>
					}
					code={`<RankBars data={[
  {label:"消防安全",value:87},{label:"食品安全",value:64},…
]} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="timeline" title="时间轴">
				<ShowcaseItem
					name="Timeline"
					summary="左竖线 + 节点圆点的标准时间轴"
					source="shared/mini-chart.tsx"
					dense
					demo={<Timeline items={TIMELINE} />}
					code={`<Timeline items={[
  { time: "2026-08-12 10:32", title: "现场检查",
    description: "营业执照、消防安全两项通过", tone: "text-primary" },
  …
]} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="catalog"
				title="编目信息条"
				description="数据编目的元数据条:来源表 / 归集条数 / 同步时间 / 同步频率 —— 一眼看清这份数据从哪儿来、多久同步一次。"
			>
				<ShowcaseItem
					name="CatalogBanner"
					summary="归集编目元数据卡"
					source="shared/catalog-banner.tsx"
					demo={
						<CatalogBanner
							meta={{
								编目: "企业基本信息",
								来源表: "data_collect.enterprise_info",
								归集条数: 4382,
								清洗条数: 4127,
								同步时间: "2026-08-23 02:15",
								同步频率: "每日 02:00",
								责任条线: "数据管理科",
							}}
						/>
					}
					code={`<CatalogBanner meta={{
  编目: "企业基本信息",
  来源表: "data_collect.enterprise_info",
  归集条数: 4382,
  清洗条数: 4127,
  同步时间: "2026-08-23 02:15",
  同步频率: "每日 02:00",
}} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="api" title="图表 API 速查">
				<PropTable
					rows={[
						{
							name: "ChartDatum.label",
							type: "string",
							note: "横轴标签;BarChart 把它写在底部,RankBars 写在左,DonutChart 进图例",
						},
						{ name: "ChartDatum.value", type: "number", note: "值;=0 在柱状图仍画细条以保可见" },
						{ name: "ChartDatum.tone", type: "string(类名)", note: "覆盖默认轮转;用 text-* 类即可" },
						{
							name: "CHART_TONES",
							type: "5 个语义 token",
							note: "primary / warn-fg / success-fg / danger-fg / foreground/60 —— 按数据序号轮转",
						},
						{
							name: "StatItem.sparkPoints",
							type: "SVG points 字符串",
							note: "viewBox 是 0 0 56 18;传 '0,16 8,14 …' 这种坐标串",
						},
					]}
				/>
			</ShowcaseSection>
		</ShowcasePage>
	);
}
