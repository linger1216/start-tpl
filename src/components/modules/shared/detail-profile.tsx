import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader } from "#/components/layout/page-header";
import { TagBadges } from "#/components/modules/shared/tag-badges";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import { DetailRow } from "#/components/ui/detail-row";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";

/**
 * 详情页版式 —— 「主体摘要 + 按关联业务分 tab」。
 *
 * 版式固定为三段:
 *   ① 页头(标题 + 可选来源徽章 + 右上角返回入口);
 *   ② 主体摘要卡:主体名 + 副标题 + 多个标签 + 字段网格(每项走 `DetailRow`);
 *   ③ 关联业务 tab:一个关联业务 = 一个 tab,tab 名后带条数。
 *
 * 适用场景是「以某个对象为视角,把与它相关的多类记录聚合在一页」——
 * 对象档案、企业画像、案件详情、客户 360 都属于这一类。
 * **不适合**单表单条记录的简单详情弹窗:那种直接用 `Dialog` + `DetailRow` 即可,
 * 套上本组件只会多出一个没有 tab 的空壳。
 *
 * 与「列表页」的分工:本组件只做**版式**,不含任何数据订阅与写操作 ——
 * 摘要字段与 tab 内容都由调用方组装好再传入。
 */

export type DetailTab = {
	/** tab 名(关联业务名,如「相关走访信息」) */
	label: string;
	/** tab 内容 */
	node: ReactNode;
	/** 关联条数(展示在 tab 名后的计数胶囊里) */
	count?: number;
};

export type DetailSummaryField = {
	label: string;
	value: ReactNode;
};

export function DetailProfile({
	/** 详情对象类型名,如「企业档案」 */
	title,
	/** 页头说明(默认收进 (i) trigger 的 popover 里) */
	description,
	/** 来源徽章文案(如「需求文档 §3.2」);不传则 `actions` 里只有返回入口 */
	requirement,
	/** 主体名(企业名称 / 人员姓名 / 案件标题…) */
	name,
	subtitle,
	/** 主体摘要字段 */
	summary,
	/** 主体标签 */
	tags,
	/** 按关联业务划分的 tab */
	tabs,
	/** 右上角额外入口(通常是返回列表的按钮 / 面包屑) */
	actions,
	/** 摘要区是否内联展示 `description` */
	descriptionInline = false,
}: {
	title: string;
	description?: ReactNode;
	requirement?: ReactNode;
	name: ReactNode;
	subtitle?: ReactNode;
	summary?: readonly DetailSummaryField[];
	tags?: readonly string[];
	tabs?: readonly DetailTab[];
	actions?: ReactNode;
	descriptionInline?: boolean;
}) {
	const hasSummary = (summary?.length ?? 0) > 0;
	const hasTabs = (tabs?.length ?? 0) > 0;

	return (
		<div className="space-y-5">
			<PageHeader
				title={title}
				description={description}
				descriptionInline={descriptionInline}
				actions={
					requirement || actions ? (
						<div className="flex items-center gap-2">
							{actions}
							{requirement ? (
								<Badge variant="secondary" className="gap-1">
									<HelpCircle className="size-3" />
									{requirement}
								</Badge>
							) : null}
						</div>
					) : undefined
				}
			/>

			<Card>
				<CardContent className="space-y-4 pt-5">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<h2 className="font-heading text-[19px] font-semibold text-foreground">{name}</h2>
						{subtitle ? <span className="text-[13px] text-muted-foreground">{subtitle}</span> : null}
					</div>

					{tags && tags.length > 0 ? (
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-[12px] text-muted-foreground">标签</span>
							<TagBadges tags={tags} />
						</div>
					) : null}

					{hasSummary ? (
						<div className="grid gap-x-8 gap-y-0 md:grid-cols-2 xl:grid-cols-3">
							{summary?.map((field) => (
								<DetailRow key={field.label} label={field.label}>
									{field.value}
								</DetailRow>
							))}
						</div>
					) : null}
				</CardContent>
			</Card>

			{hasTabs ? (
				<Tabs defaultValue={tabs?.[0]?.label ?? ""}>
					<TabsList>
						{tabs?.map((tab) => (
							<TabsTrigger key={tab.label} value={tab.label} count={tab.count}>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>

					{tabs?.map((tab) => (
						<TabsContent key={tab.label} value={tab.label} className="pt-4">
							{tab.node}
						</TabsContent>
					))}
				</Tabs>
			) : null}
		</div>
	);
}
