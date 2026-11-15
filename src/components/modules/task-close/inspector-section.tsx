import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/**
 * 右侧检查器里的一块 —— 顶部细线分隔(第一块除外)+ 统一内边距。
 * 参与人 / 任务提醒 / 动作记录 / 动态四块的**外壳**都是这一段,之前各写一遍。
 */
export function InspectorSection({ children, className }: { children: ReactNode; className?: string }) {
	return <section className={cn("grid gap-2 border-t border-border p-3.5", className)}>{children}</section>;
}
