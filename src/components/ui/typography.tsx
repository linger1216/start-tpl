import { cn } from "#/lib/utils";

/**
 * **Typography 三原语**(DESIGN.md「公文·印鉴」§3 的组件落点)。
 *
 * 三套成文规格过去**全靠各页手抄类名**,字号/字距/字重迟早各漂各的 ——
 * 这里给一个**唯一落点**:新的排版需求先来这里找,找不到再写 utility 并回填本文件。
 *
 *  - `PageTitle` 页头 / 记录标题 —— 宋体(`--font-heading`)22px/700;
 *    消费:`PageHeader`、任务详情记录头。
 *  - `MetaRow` **版记行** —— 12px 黑体 + 0.05em 字距 + 圆点分隔,元信息专用;
 *    消费:任务详情 meta 行;配合 `DocDot` 圆点分隔。
 *  - `KpiValue` KPI 大数字 —— 宋体 + tabular-nums(对位是台账数字的硬要求);
 *    消费:`stat-cards` 的 `.kpi-value`(类名版保留,CSS 层同一规格)。
 */

/** 页头 / 记录标题 —— 宋体 24px/700(满强度:这是世界最重的声音)。 */
export function PageTitle({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<h1 className={cn("font-heading text-2xl font-bold leading-snug tracking-[-0.015em] text-foreground", className)}>
			{children}
		</h1>
	);
}

/** 版记行的圆点分隔符(纯装饰,读屏跳过) */
export function DocDot({ className }: { className?: string }) {
	return <span aria-hidden className={cn("size-1 shrink-0 rounded-full bg-border", className)} />;
}

/** 版记行容器 —— 12px + 0.05em 字距,子项间用 `<DocDot />` 分隔;元信息专用,别塞控件 */
export function MetaRow({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs tracking-[0.05em] text-muted-foreground",
				className,
			)}
		>
			{children}
		</div>
	);
}

/** KPI 大数字 —— 宋体 700 + tabular-nums;`unit` 场景在子元素里自带(见 stat-cards) */
export function KpiValue({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<span
			className={cn(
				"font-heading text-[28px] font-bold leading-none tracking-normal text-foreground tabular-nums",
				className,
			)}
		>
			{children}
		</span>
	);
}
