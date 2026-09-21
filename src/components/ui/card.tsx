import type * as React from "react";

import { cn } from "#/lib/utils";

/**
 * 卡片 —— 有边界、有静置阴影,**悬停把边框刷成主色并加 3px 蓝环**。
 *
 * 悬停态(按用户偏好保留,不要改成"只抬阴影"):
 *  边框转 `primary` + `box-shadow: 0 0 0 3px var(--af-blue-ring)`(即 3px 蓝环)。
 *  这让卡片在列表 / 台账里"被点亮"得很明确,但只在 hover 时出现,不会像常驻描边那样喧宾夺主。
 *
 * 提供 `interactive`(整卡可点)与 `tone`(顶部 2px 强调色线)两个可选口子 ——
 * 需要强调的卡片用 tone 传一个色值(如 `"var(--hue-violet)"`),不必自己拼渐变。
 */
function Card({
	className,
	size = "default",
	interactive = false,
	tone,
	...props
}: React.ComponentProps<"div"> & {
	size?: "default" | "sm";
	/** 整卡可点击时传 true:hover 抬得更明显,并且给出手型光标 */
	interactive?: boolean;
	/** 顶部 2px 强调色线,传一个 CSS 颜色值(如 `"var(--hue-violet)"`) */
	tone?: string;
}) {
	return (
		<div
			data-slot="card"
			data-size={size}
			data-interactive={interactive ? "" : undefined}
			style={tone ? ({ "--tone-color": tone } as React.CSSProperties) : undefined}
			className={cn(
				"group/card relative flex flex-col gap-5 overflow-hidden rounded-xl border border-border bg-card text-card-foreground",
				// 静置:1px 描边 + 极浅一层。
				"shadow-(--af-raise-1)",
				"transition-[border-color,box-shadow] duration-200 ease-brand",
				// 悬停:边框刷主色 + 3px 蓝环(用户偏好,保留)
				"hover:border-primary hover:shadow-[0_0_0_3px_var(--af-blue-ring)]",
				interactive && "cursor-pointer",
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
			className={cn("font-heading text-[15px] leading-snug font-medium text-foreground", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("text-[13px] leading-relaxed text-muted-foreground", className)}
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
