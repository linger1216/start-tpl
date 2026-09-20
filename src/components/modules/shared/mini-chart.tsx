import { cn } from "#/lib/utils";

/**
 * 轻量图表 —— 分析页、看板、大屏统计等页面共用。
 *
 * 为什么手写而不是引第三方:
 * - 项目现有依赖里没有图表库(`package.json` 无 recharts / echarts);
 * - 这些图表只需要柱 / 折线 / 环形三种形态,用 SVG + CSS 变量即可,
 * 颜色直接吃 `src/styles.css` 的语义 token(通过 `text-*` 类 + `currentColor`)。
 *
 * 所有图形都是纯函数式渲染,数据从 mock 聚合而来,没有动画与交互依赖,
 * 因此不会引入 SSR 水合差异。
 */

export type ChartDatum = {
	label: string;
	value: number;
	/** 自定义颜色类(如 "text-danger-fg"),缺省按序号循环取色 */
	tone?: string;
};

/** 图表配色轮转 —— 语义 token,不写死 hex */
export const CHART_TONES = [
	"text-primary",
	"text-warn-fg",
	"text-success-fg",
	"text-danger-fg",
	"text-foreground/60",
] as const;

const toneAt = (index: number, tone?: string) => tone ?? CHART_TONES[index % CHART_TONES.length] ?? "text-primary";

/** 柱状图(纵向,按值等比) */
export function BarChart({
	data,
	height = 180,
	unit,
	className,
}: {
	data: readonly ChartDatum[];
	height?: number;
	unit?: string;
	className?: string;
}) {
	const max = Math.max(1, ...data.map((item) => item.value));
	return (
		<div className={cn("w-full", className)}>
			<div className="flex items-end gap-2" style={{ height }}>
				{data.map((item, index) => (
					<div key={item.label} className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
						<div className={cn("text-center text-[12px] font-medium tabular-nums", toneAt(index, item.tone))}>
							{item.value}
							{unit ?? ""}
						</div>
						<div
							className={cn("w-full rounded-t-md bg-current transition-colors", toneAt(index, item.tone))}
							style={{ height: `${Math.max(2, (item.value / max) * 100)}%` }}
							title={`${item.label}:${item.value}${unit ?? ""}`}
						/>
					</div>
				))}
			</div>
			<div className="mt-2 flex gap-2 border-t border-border pt-1.5">
				{data.map((item) => (
					<div key={item.label} className="min-w-0 flex-1 truncate text-center text-[12px] text-muted-foreground">
						{item.label}
					</div>
				))}
			</div>
		</div>
	);
}

/** 横向排行条(标签分布、企业排名等) */
export function RankBars({
	data,
	className,
	unit,
}: {
	data: readonly ChartDatum[];
	className?: string;
	unit?: string;
}) {
	const max = Math.max(1, ...data.map((item) => item.value));
	return (
		<div className={cn("space-y-2", className)}>
			{data.map((item, index) => (
				<div key={item.label} className="space-y-1">
					<div className="flex items-baseline justify-between gap-2 text-[13px]">
						<span className="truncate text-foreground">{item.label}</span>
						<span className="shrink-0 tabular-nums text-muted-foreground">
							{item.value}
							{unit ?? ""}
						</span>
					</div>
					<div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
						<div
							className={cn("h-full rounded-full bg-current", toneAt(index, item.tone))}
							style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

/** 环形图 + 图例 */
export function DonutChart({
	data,
	size = 168,
	className,
	unit,
}: {
	data: readonly ChartDatum[];
	size?: number;
	className?: string;
	unit?: string;
}) {
	const total = data.reduce((acc, item) => acc + item.value, 0);
	const radius = 54;
	const circumference = 2 * Math.PI * radius;
	let offset = 0;

	return (
		<div className={cn("flex flex-wrap items-center gap-5", className)}>
			<svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label="占比环形图">
				<g transform="rotate(-90 70 70)">
					<circle
						cx="70"
						cy="70"
						r={radius}
						fill="none"
						strokeWidth="18"
						className="text-secondary"
						stroke="currentColor"
					/>
					{total > 0 &&
						data.map((item, index) => {
							const length = (item.value / total) * circumference;
							const dash = `${length} ${circumference - length}`;
							const dashOffset = -offset;
							offset += length;
							return (
								<circle
									key={item.label}
									cx="70"
									cy="70"
									r={radius}
									fill="none"
									strokeWidth="18"
									strokeDasharray={dash}
									strokeDashoffset={dashOffset}
									stroke="currentColor"
									className={toneAt(index, item.tone)}
								>
									<title>{`${item.label}:${item.value}${unit ?? ""}`}</title>
								</circle>
							);
						})}
				</g>
				<text x="70" y="66" textAnchor="middle" className="fill-foreground text-[20px] font-semibold">
					{total}
				</text>
				<text x="70" y="84" textAnchor="middle" className="fill-muted-foreground text-[11px]">
					合计
				</text>
			</svg>

			<ul className="min-w-40 flex-1 space-y-1.5">
				{data.map((item, index) => (
					<li key={item.label} className="flex items-center gap-2 text-[13px]">
						<span className={cn("size-2.5 shrink-0 rounded-full bg-current", toneAt(index, item.tone))} />
						<span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
						<span className="shrink-0 tabular-nums text-muted-foreground">
							{item.value}
							{unit ?? ""}
							{total > 0 ? ` · ${Math.round((item.value / total) * 100)}%` : ""}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/** 折线图(单一序列,按值等比;用于趋势类分析) */
export function LineChart({
	data,
	height = 180,
	unit,
	className,
}: {
	data: readonly ChartDatum[];
	height?: number;
	unit?: string;
	className?: string;
}) {
	const width = 640;
	const padding = { top: 16, right: 12, bottom: 26, left: 36 };
	const innerW = width - padding.left - padding.right;
	const innerH = height - padding.top - padding.bottom;
	const max = Math.max(1, ...data.map((item) => item.value));
	const step = data.length > 1 ? innerW / (data.length - 1) : 0;
	const points = data.map((item, index) => {
		const x = padding.left + index * step;
		const y = padding.top + innerH - (item.value / max) * innerH;
		return { ...item, x, y };
	});
	const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
	const area = `${padding.left},${padding.top + innerH} ${polyline} ${padding.left + innerW},${padding.top + innerH}`;

	return (
		<div className={cn("w-full", className)}>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				width="100%"
				height={height}
				preserveAspectRatio="none"
				role="img"
				aria-label="趋势折线图"
			>
				{[0, 0.5, 1].map((ratio) => (
					<line
						key={ratio}
						x1={padding.left}
						x2={width - padding.right}
						y1={padding.top + innerH * ratio}
						y2={padding.top + innerH * ratio}
						className="text-border"
						stroke="currentColor"
						strokeDasharray="3 4"
					/>
				))}
				<polygon points={area} className="text-primary/10" fill="currentColor" />
				<polyline points={polyline} fill="none" strokeWidth="2" stroke="currentColor" className="text-primary" />
				{points.map((point) => (
					<circle key={point.label} cx={point.x} cy={point.y} r="3" fill="currentColor" className="text-primary">
						<title>{`${point.label}:${point.value}${unit ?? ""}`}</title>
					</circle>
				))}
			</svg>
			<div className="flex justify-between text-[12px] text-muted-foreground">
				{data.map((item) => (
					<span key={item.label} className="min-w-0 flex-1 truncate first:text-left last:text-right">
						{item.label}
					</span>
				))}
			</div>
		</div>
	);
}

/**
 * 简易时间轴 —— 展示「一件事从发起到闭环」的流转过程。
 */
export function Timeline({
	items,
	className,
}: {
	items: readonly { time: string; title: string; description?: string; tone?: string }[];
	className?: string;
}) {
	return (
		<ol className={cn("relative space-y-4 border-l border-border pl-5", className)}>
			{items.map((item) => (
				<li key={`${item.time}-${item.title}`} className="relative">
					<span
						className={cn(
							"absolute -left-[26px] top-1 size-2.5 rounded-full border-2 border-background bg-current",
							item.tone ?? "text-primary",
						)}
					/>
					<div className="flex flex-wrap items-baseline gap-x-2">
						<span className="text-[13px] font-medium text-foreground">{item.title}</span>
						<span className="text-[12px] tabular-nums text-muted-foreground">{item.time}</span>
					</div>
					{item.description ? (
						<p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{item.description}</p>
					) : null}
				</li>
			))}
		</ol>
	);
}
