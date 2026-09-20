import { Database, RefreshCw, Sparkles, Timer } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";

/**
 * 归集编目信息条 —— -「功能细化」列的原文要求:
 *
 * 「还需要展示归集的编目,和归集的条数, 归集的同步时间」
 *
 * 编目表的数据默认来自上游业务表的定时同步(表内也允许人工新增 / 编辑 / 删除),
 * 所以每条编目都要能说清「从哪张表来、归集了多少条、什么时候同步的」。
 */
export type CatalogMeta = {
	/** 编目名(数据资源目录里的名字) */
	编目: string;
	/** 来源业务表(上游库表名) */
	来源表: string;
	/** 归集条数 */
	归集条数: number;
	/** 初步清洗后可用条数 */
	清洗条数: number;
	/** 最近一次同步时间 */
	同步时间: string;
	/** 同步频率 */
	同步频率: string;
	/** 责任条线 */
	责任条线?: string;
};

export function CatalogBanner({ meta, extra }: { meta: CatalogMeta; extra?: React.ReactNode }) {
	const 清洗率 = meta.归集条数 > 0 ? Math.round((meta.清洗条数 / meta.归集条数) * 100) : 0;

	return (
		<Card size="sm" className="rounded-xl bg-muted/40 shadow-none">
			<CardContent className="space-y-3 pt-4">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="outline" className="border-transparent bg-primary/10 text-primary">
						<Database className="size-3" />
						归集编目
					</Badge>
					<span className="font-medium text-foreground">{meta.编目}</span>
					{meta.责任条线 ? <Badge variant="secondary">{meta.责任条线}</Badge> : null}
					<span className="text-[12px] text-muted-foreground">来源:{meta.来源表}</span>
				</div>

				<dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] lg:grid-cols-4">
					<div className="flex items-center gap-1.5">
						<Database className="size-3.5 text-muted-foreground" />
						<dt className="text-muted-foreground">归集条数</dt>
						<dd className="font-medium tabular-nums">{meta.归集条数.toLocaleString()} 条</dd>
					</div>
					<div className="flex items-center gap-1.5">
						<Sparkles className="size-3.5 text-muted-foreground" />
						<dt className="text-muted-foreground">清洗后条数</dt>
						<dd className="font-medium tabular-nums">
							{meta.清洗条数.toLocaleString()} 条<span className="text-muted-foreground">({清洗率}%)</span>
						</dd>
					</div>
					<div className="flex items-center gap-1.5">
						<Timer className="size-3.5 text-muted-foreground" />
						<dt className="text-muted-foreground">同步时间</dt>
						<dd className="font-medium tabular-nums">{meta.同步时间}</dd>
					</div>
					<div className="flex items-center gap-1.5">
						<RefreshCw className="size-3.5 text-muted-foreground" />
						<dt className="text-muted-foreground">同步频率</dt>
						<dd className="font-medium">{meta.同步频率}</dd>
					</div>
				</dl>

				{extra}
			</CardContent>
		</Card>
	);
}
