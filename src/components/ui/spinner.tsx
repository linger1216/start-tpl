import { cn } from "#/lib/utils";

/**
 * 轻量加载指示器:单个细圆弧匀速旋转。
 *
 * 动画走 Tailwind 的 `animate-spin`(一段 3/4 圆弧,端点是圆角),**不引动画库** ——
 * 全站动效口径就是 CSS + `prefers-reduced-motion`(styles.css 已全局兜底),
 * 为一个转圈再引 `motion` 不值得(它会被打进客户端 chunk)。
 */
export function Spinner({
	className,
	size = "md",
	label,
}: {
	className?: string;
	size?: "sm" | "md" | "lg";
	label?: string;
}) {
	const px = size === "sm" ? "size-4" : size === "lg" ? "size-7" : "size-5";
	return (
		<div role="status" className={cn("flex items-center justify-center gap-2", className)}>
			<svg className={cn("animate-spin text-muted-foreground", px)} viewBox="0 0 24 24" fill="none" aria-hidden>
				<circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
				<circle
					cx="12"
					cy="12"
					r="9"
					stroke="currentColor"
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeDasharray="42.4"
					strokeDashoffset="10.6"
				/>
			</svg>
			{label ? (
				<span className="text-xs text-muted-foreground">{label}</span>
			) : (
				/* 只转圈不带字时,给 `role="status"` 留一段可播报的文本(视觉不可见) */
				<span className="sr-only">加载中</span>
			)}
		</div>
	);
}
