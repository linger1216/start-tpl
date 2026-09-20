import { cn } from "#/lib/utils";

/**
 * 通用空态占位：标题 + 描述 + 可选 icon + 操作按钮。
 * Apple 风格：灰白面板、大号图标、宽松留白。
 */
export function EmptyState({
	title,
	description,
	icon,
	actions,
	className,
}: {
	title: string;
	description: string;
	icon?: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center rounded-2xl border border-border bg-secondary/40 px-6 py-16 text-center",
				className,
			)}
		>
			{icon && (
				<div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
					{icon}
				</div>
			)}
			<h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
			<p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted-foreground">{description}</p>
			{actions && <div className="mt-5 flex items-center gap-2">{actions}</div>}
		</div>
	);
}
