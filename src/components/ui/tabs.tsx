import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { createContext, useContext } from "react";

import { Badge } from "#/components/ui/badge";
import { cn } from "#/lib/utils";

/**
 * 页签 —— 四种**分割形态**(`variant`),一套 API。
 *
 * | variant | 形态 | 用在哪 |
 * | --- | --- | --- |
 * | `underline`(默认) | 下划线页签(Linear / Vercel 风格) | 页面头部的主分区:台账页的「列表 / 已归档」 |
 * | `segmented` | 分段控件(iOS Segmented) | 同一份数据切**视图口径**(全部 / 我负责的 / 我参与的) |
 * | `pill` | 药丸子(选中 = 主色实底) | 卡片内的轻量切换、筛选预设 |
 * | `card` | 卡片式(浏览器页签,与内容区相接) | 抽屉 / 弹窗里的分区,或需要"文件夹"隐喻的地方 |
 *
 * 共同纪律(四种都要守):
 *  - 页签**不是**独立按钮:它属于某一组,所以组内几何统一、只有选中态承担强调色;
 *  - hover 只提示"这里可点",**不做**与选中态同强度的视觉(否则同时多个像选中);
 *  - 颜色/几何走 token(`--border` / `--muted` / `--primary` / `--hue-blue-*`);
 *    要在业务里换样子就往下加一种 variant,不要在调用点覆盖颜色。
 *
 * 实现要点:
 *  - variant 由 `<Tabs>` 经 context 下发,子件自己取 —— 调用方只写 `<Tabs variant="segmented">…`;
 *  - ⚠️ 类名**必须是字面量**:Tailwind 只扫描源码文本,`${variant}` 拼出来的类名不会生成 CSS。
 *    所以下面两张表里存的是**完整的、带 `data-active:` 前缀的**字面量,不做二次拼接。
 *
 * 基于 **Base UI 的 Tabs**(与 `ui/` 下其余原语同一套库):选中态是 `data-active`。
 * `pnpm dlx shadcn@latest add tabs` 会覆盖本文件(而且会换回 Radix 口径),覆盖后请按本文件重做。
 */

export const TABS_VARIANTS = ["underline", "segmented", "pill", "card"] as const;
export type TabVariant = (typeof TABS_VARIANTS)[number];

const TabVariantContext = createContext<TabVariant>("underline");

/** 每种形态的容器 */
const LIST_STYLE: Record<TabVariant, string> = {
	// 底部 1px 浅灰基线:所有 tab 共享的视觉基线
	underline: "inline-flex max-w-full flex-wrap items-stretch gap-0 border-b border-border",
	// 浅灰底轨道 + 内边距,选中项浮在轨道上
	segmented: "inline-flex max-w-full items-center gap-0.5 rounded-xl bg-muted p-1",
	// 无容器,只有药丸之间的间隙
	pill: "inline-flex max-w-full flex-wrap items-center gap-1.5",
	// 与内容区相接的文件夹页签
	card: "inline-flex max-w-full flex-wrap items-end gap-1 border-b border-border",
};

/** 每种形态的未选中态(几何 + hover 提示) */
const TRIGGER_BASE: Record<TabVariant, string> = {
	underline:
		"relative inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-3.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
	segmented:
		"relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
	pill: "relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-transparent px-3.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-200 ease-out hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
	card: "relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-t-lg border border-b-0 border-transparent bg-transparent px-3.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-200 ease-out hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
};

/** 每种形态的选中态 —— 全部写成带 `data-active:` 前缀的字面量(见文件头) */
const TRIGGER_ACTIVE: Record<TabVariant, string> = {
	underline: "data-active:font-semibold data-active:text-foreground",
	segmented:
		"data-active:bg-background data-active:font-semibold data-active:text-foreground data-active:shadow-(--af-raise-1)",
	pill: "data-active:border-primary data-active:bg-primary data-active:font-semibold data-active:text-primary-foreground data-active:shadow-(--shadow-glow)",
	card: "data-active:border-border data-active:bg-background data-active:font-semibold data-active:text-foreground",
};

/** 计数胶囊的选中态(同样必须是字面量) */
const COUNT_ACTIVE: Record<TabVariant, string> = {
	underline: "group-data-[active]/tabs-trigger:bg-hue-blue-soft group-data-[active]/tabs-trigger:text-hue-blue-fg",
	segmented: "group-data-[active]/tabs-trigger:bg-hue-blue-soft group-data-[active]/tabs-trigger:text-hue-blue-fg",
	// 压在实心主色上:用反白前景的 20% 做底,不要在调用点硬编码 white
	pill: "group-data-[active]/tabs-trigger:bg-primary-foreground/20 group-data-[active]/tabs-trigger:text-primary-foreground",
	card: "group-data-[active]/tabs-trigger:bg-hue-blue-soft group-data-[active]/tabs-trigger:text-hue-blue-fg",
};

export function Tabs({
	className,
	variant = "underline",
	children,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { variant?: TabVariant }) {
	return (
		<TabVariantContext.Provider value={variant}>
			<TabsPrimitive.Root
				data-slot="tabs"
				data-variant={variant}
				className={cn("flex flex-col gap-4", className)}
				{...props}
			>
				{children}
			</TabsPrimitive.Root>
		</TabVariantContext.Provider>
	);
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
	const variant = useContext(TabVariantContext);
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant}
			className={cn(LIST_STYLE[variant], className)}
			{...props}
		/>
	);
}

export function TabsTrigger({
	className,
	count,
	children,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Tab> & {
	/** 页签上的计数(如「关联记录 12」)—— 传了才渲染;全站计数样式只在这里定义 */
	count?: number;
}) {
	const variant = useContext(TabVariantContext);
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cn(TRIGGER_BASE[variant], TRIGGER_ACTIVE[variant], className)}
			{...props}
		>
			{children}
			{typeof count === "number" ? (
				// 计数是显示值 → 用 Badge(尺寸 / 配色照旧靠 className 覆盖)
				<Badge
					variant="secondary"
					className={cn(
						"h-4.5 min-w-5 rounded-full bg-muted px-1.5 text-xs font-semibold text-muted-foreground tabular-nums transition-colors duration-200",
						COUNT_ACTIVE[variant],
					)}
				>
					{count}
				</Badge>
			) : null}

			{/* 下划线形态专属:双层 2px 下划线(浅灰 hover 提示线 + 蓝色选中线) */}
			{variant === "underline" ? (
				<>
					<span
						aria-hidden
						className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-border opacity-100 transition-[background-color,opacity,transform] duration-200 ease-out group-data-[active]/tabs-trigger:opacity-0"
					/>
					<span
						aria-hidden
						className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-transparent opacity-0 transition-[background-color,opacity,box-shadow] duration-200 ease-out group-data-[active]/tabs-trigger:bg-hue-blue group-data-[active]/tabs-trigger:opacity-100 group-data-[active]/tabs-trigger:shadow-(--shadow-glow)"
					/>
				</>
			) : null}

			{/* 卡片形态专属:遮住容器底边线,让选中页签与内容区连成一片 */}
			{variant === "card" ? (
				<span
					aria-hidden
					className="pointer-events-none absolute inset-x-0 -bottom-px hidden h-px bg-background group-data-[active]/tabs-trigger:block"
				/>
			) : null}
		</TabsPrimitive.Tab>
	);
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Panel>) {
	const variant = useContext(TabVariantContext);
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-content"
			data-variant={variant}
			className={cn("flex-1 outline-none", variant === "card" && "pt-3", className)}
			{...props}
		/>
	);
}

/** 四种形态的中文名 —— 展示页(画廊)用;业务侧的 variant 都是随形写的,不要在页面里另写 */
export const TAB_VARIANT_META: Record<TabVariant, { label: string; hint: string }> = {
	underline: { label: "下划线", hint: "页面主分区(默认)" },
	segmented: { label: "分段控件", hint: "同一份数据切视图口径" },
	pill: { label: "药丸", hint: "卡片内的轻量切换" },
	card: { label: "卡片式", hint: "弹窗 / 抽屉里的分区" },
};
