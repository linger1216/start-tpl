import { motion } from "motion/react";

import { cn } from "#/lib/utils";

/**
 * 轻量加载指示器:单个细圆弧匀速旋转。
 * ponytail: 只画一段 3/4 圆弧,端点是圆角 —— 视觉上一个圈,流畅平滑;
 * 旋转动画走 motion,不手写 CSS keyframes。
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
		<div
			role="status"
			aria-label={label ?? "加载中"}
			className={cn("flex items-center justify-center gap-2", className)}
		>
			<svg className={cn("text-muted-foreground", px)} viewBox="0 0 24 24" fill="none" aria-hidden>
				<circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
				<motion.circle
					cx="12"
					cy="12"
					r="9"
					stroke="currentColor"
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeDasharray="42.4"
					strokeDashoffset="10.6"
					style={{ transformOrigin: "12px 12px" }}
					animate={{ rotate: 360 }}
					transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
				/>
			</svg>
			{label && <span className="text-xs text-muted-foreground">{label}</span>}
		</div>
	);
}
