import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/**
 * 区块标题:标题(+ 可选计数)+ 右侧动作。默认实线底边;`dashed` 用于「标签与其内容之间」的虚线。
 * 计数是小号等宽弱化,与标题基线对齐。
 */
export function BlockHeader({
	title,
	count,
	actions,
	id,
	dashed,
}: {
	title: ReactNode;
	count?: number;
	actions?: ReactNode;
	id?: string;
	dashed?: boolean;
}) {
	return (
		<header
			className={cn(
				"flex items-center justify-between border-b pb-2",
				dashed ? "border-dashed border-border" : "border-border",
			)}
		>
			<h2
				id={id}
				className="inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-base font-semibold tracking-tight text-foreground"
			>
				{title}
				{count === undefined ? null : (
					<span className="text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
				)}
			</h2>
			{actions}
		</header>
	);
}

/**
 * 右侧检查器里的一块 —— 顶部细线分隔(第一块除外)+ 统一内边距。
 * 参与人 / 任务提醒 / 动作记录 / 动态四块的**外壳**都是这一段,之前各写一遍。
 */
export function InspectorSection({ children, className }: { children: ReactNode; className?: string }) {
	return <section className={cn("grid gap-2 border-t border-border p-3.5", className)}>{children}</section>;
}
