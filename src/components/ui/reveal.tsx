import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "#/lib/utils";

/**
 * 滚动入场动画：元素进入视口时淡入上浮。
 * - 一次性触发，不重复播放；
 * - 通过 delay(ms) 实现同级元素的错落进入；
 * - 尊重 prefers-reduced-motion（globals.css 已处理）。
 */
export function Reveal({
	children,
	delay = 0,
	className,
	as: Tag = "div",
}: {
	children: ReactNode;
	delay?: number;
	className?: string;
	as?: "div" | "section" | "li" | "span";
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [shown, setShown] = useState(false);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (typeof IntersectionObserver === "undefined") {
			setShown(true);
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setShown(true);
						io.disconnect();
						break;
					}
				}
			},
			{ threshold: 0.1, rootMargin: "0px 0px -8% 0px" },
		);
		io.observe(el);
		return () => io.disconnect();
	}, []);

	return (
		<Tag
			ref={ref as never}
			className={cn("reveal", shown && "reveal-in", className)}
			style={delay ? { animationDelay: `${delay}ms` } : undefined}
		>
			{children}
		</Tag>
	);
}
