import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

/**
 * 信息气泡:一个触发图标(ⓘ / 日历)+ 一段说明。四处同构的
 * `Provider + Tooltip + Trigger + Content` 收在这里;内容宽度 / 侧向按调用点给。
 */
export function InfoTooltip({
	icon,
	label,
	children,
	side = "top",
	align = "end",
	delay,
	triggerClassName,
	triggerProps,
	contentClassName,
}: {
	icon: ReactNode;
	label: string;
	children: ReactNode;
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	delay?: number;
	triggerClassName?: string;
	triggerProps?: Record<string, unknown>;
	contentClassName?: string;
}) {
	return (
		<TooltipProvider delay={delay}>
			<Tooltip>
				<TooltipTrigger aria-label={label} className={triggerClassName} {...triggerProps}>
					{icon}
				</TooltipTrigger>
				<TooltipContent side={side} align={align} className={cn("block", contentClassName)}>
					{children}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
