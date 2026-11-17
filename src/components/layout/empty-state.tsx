import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

/**
 * 通用空态 —— 标题 + 描述 + 可选图标 + 操作。
 *
 * 三条设计口径(改之前先读):
 * ① **图标不裸放**:套在一枚圆牌里(淡主题色底 + 同色细环),否则一个大图标悬在半空很像加载失败;
 * ② **标题走宋体**(`font-heading`)—— 与页头标题同族,空态才像「页面的一部分」而不是一段报错文字;
 * ③ **只有一个主操作**。空态的职责是「说清楚现在是什么情况 + 下一步点哪里」,
 *    给两个平级按钮等于没给建议。
 *
 * `bare` 去掉面板外壳 —— 放在已经有边框的 `Card` 里时用,免得白底套白底糊成一块。
 */
export function EmptyState({
	title,
	description,
	icon,
	actions,
	tone = "neutral",
	bare,
	className,
	children,
}: {
	title: string;
	description: string;
	icon?: ReactNode;
	actions?: ReactNode;
	/**
	 * 图标圆牌的色调:
	 * `neutral` = 次要灰(「这里本来就空」),`brand` = 主题色(「可以开始做点什么」)。
	 * 空态默认 `neutral`:空不等于错,别用告警色。
	 */
	tone?: "neutral" | "brand";
	bare?: boolean;
	className?: string;
	children?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center px-6 py-14 text-center",
				!bare && "rounded-xl border border-border bg-secondary/30",
				className,
			)}
		>
			{icon ? (
				<div
					className={cn(
						"mb-4 grid size-12 place-items-center rounded-full ring-1",
						tone === "brand"
							? "bg-brand-soft text-primary ring-primary/15"
							: "bg-secondary text-muted-foreground ring-border",
					)}
				>
					{icon}
				</div>
			) : null}
			<h3 className="font-heading text-base font-semibold text-foreground">{title}</h3>
			<p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
			{actions ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
			{children}
		</div>
	);
}
