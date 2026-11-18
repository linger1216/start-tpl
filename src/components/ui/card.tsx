import type * as React from "react";

import { cn } from "#/lib/utils";

/**
 * 卡片 —— 静置是 1px `border-border` 的浅灰边界,**悬停时这条 1px 边框刷成亮蓝色**(品牌蓝 `primary`)。
 *
 * 按用户偏好保留"边框刷蓝"这个悬浮反馈(不要改成"只抬阴影"),换成 1px 边框而不是 3px 蓝环:
 * 同样是一眼能看出"鼠标在这张卡上",但不会因为每张卡都闪一圈光晕而吵。
 *
 * ⚠️ **调用点不要再传 `hover:border-border` / `hover:shadow-none`**:那样会把这里的悬浮态顶掉,
 * 症状是"页面上怎么悬浮都不变蓝"(7 个设置页踩过 —— 当年为了压住 3px 蓝环留的,现已删)。
 *
 * 另有一个可选口子:`tone`(顶部 2px 强调色线,走 `.tone-topline` +
 * `--tone-color`,如 `tone="var(--hue-violet)"`)—— 后者是"一级模块各认一色"的一环(工作台入口卡在用),
 * 别顺手删:删了这里,`styles.css` 的 `.tone-topline` 与 5 处调用会一起失效。
 */
function Card({
	className,
	size = "default",
	tone,
	...props
}: React.ComponentProps<"div"> & {
	size?: "default" | "sm";
	/** 顶部 2px 强调色线,传一个 CSS 颜色值(如 `"var(--hue-violet)"`) */
	tone?: string;
}) {
	return (
		<div
			data-slot="card"
			data-size={size}
			style={tone ? ({ "--tone-color": tone } as React.CSSProperties) : undefined}
			className={cn(
				"relative flex flex-col gap-5 overflow-hidden rounded-xl border border-border bg-card text-card-foreground",
				"transition-[border-color,box-shadow] duration-200 ease-brand",
				// 悬浮:1px 边框 → 亮蓝(`--primary` = 品牌蓝 #1b61c9,亮色主题下最深的一抹蓝,就是它)
				"hover:border-primary",
				tone && "tone-topline",
				"data-[size=sm]:rounded-lg",
				className,
			)}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-header" className={cn("flex flex-col gap-1 px-4 pt-4", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-title"
			className={cn("font-heading text-base leading-snug font-medium text-foreground", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("text-sm leading-relaxed text-muted-foreground", className)}
			{...props}
		/>
	);
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-action" className={cn("self-start justify-self-end", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-content" className={cn("flex-1 px-5 pb-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-footer"
			className={cn("flex items-center border-t border-border bg-secondary/40 px-5 py-3.5", className)}
			{...props}
		/>
	);
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
