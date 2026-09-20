import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "#/lib/utils";

/**
 * 全项目唯一的页签组件 —— **下划线页签**(underline tabs,Linear/Vercel/Stripe 风格)。
 *
 * 设计原则:
 *  - tab **不**是一个独立元素,而是页面头部延伸出的导航条 —— 无边框、无背景、无圆角
 *  - 容器底部 1px 浅灰 hairline 作为共享基线
 *  - 选中:文字加粗 + 主色 + **底部 2px 主色实线**
 *  - hover(非激活):文字加深 + **底部 2px 浅灰 hover 线** —— 让用户知道"点哪里都会激活"
 *  - 数字徽章 muted → 选中变主色
 *  - 优先 transform / opacity,200ms ease-out
 *
 * 跑 `pnpm dlx shadcn@latest add tabs` 会覆盖,覆盖后请按本文件重做。
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
	return <TabsPrimitive.Root data-slot="tabs" className={cn("group/tabs flex flex-col gap-4", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			// 容器:零间隙横向排开 + 底部 1px 浅灰基线,作为所有 tab 共享的视觉基线
			className={cn(
				"inline-flex max-w-full flex-wrap items-stretch gap-0 border-b border-[color:var(--border)]",
				className,
			)}
			{...props}
		/>
	);
}

function TabsTrigger({
	className,
	count,
	children,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
	/** 页签上的计数(如「关联记录 12」)—— 传了才渲染;全站计数样式只在这里定义 */
	count?: number;
}) {
	return (
		<TabsPrimitive.Trigger
			data-slot="tabs-trigger"
			className={cn(
				// 几何:零背景零边框,垂直 padding,水平 padding,文字基线对齐
				"group/tabs-trigger relative inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-3.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors duration-200 ease-out",
				// hover(未激活):文字加深,显示灰色 hover 位置提示线(2px 浅灰)
				"hover:text-foreground",
				// 选中:文字 + 字重 + 主色下划线
				"data-[state=active]:text-foreground data-[state=active]:font-semibold",
				// 焦点环
				"focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
				// 禁用
				"disabled:pointer-events-none disabled:opacity-50",
				className,
			)}
			{...props}
		>
			{children}
			{typeof count === "number" ? (
				<span
					className={cn(
						"inline-flex items-center justify-center min-w-[1.25rem] h-[1.125rem] rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums transition-colors duration-200",
						"bg-[color:var(--muted)] text-muted-foreground",
						"group-data-[state=active]/tabs-trigger:bg-[color:var(--af-blue)]/12 group-data-[state=active]/tabs-trigger:text-[color:var(--af-blue)]",
					)}
				>
					{count}
				</span>
			) : null}
			{/*
			 * 双层下划线:absolute 定位的 2px 蓝条 + 2px 浅灰 hover 条。
			 *  - 浅灰条:未激活时显示(hover 提示线),激活时隐藏
			 *  - 蓝色条:仅激活时显示
			 * 用 absolute 而非 border,过渡 200ms,选中切换是平滑的滑入
			 */}
			<span
				aria-hidden
				className={cn(
					"pointer-events-none absolute inset-x-0 bottom-[-1px] h-[2px] transition-[background-color,opacity,transform] duration-200 ease-out",
					// hover 位置提示线:未激活时浅灰,激活时透明
					"bg-[color:var(--border)] opacity-100 group-data-[state=active]/tabs-trigger:opacity-0",
				)}
			/>
			<span
				aria-hidden
				className={cn(
					"pointer-events-none absolute inset-x-0 bottom-[-1px] h-[2px] transition-[background-color,opacity] duration-200 ease-out",
					// 激活蓝色实线
					"bg-transparent opacity-0 group-data-[state=active]/tabs-trigger:bg-[color:var(--af-blue)] group-data-[state=active]/tabs-trigger:opacity-100",
				)}
			/>
		</TabsPrimitive.Trigger>
	);
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
