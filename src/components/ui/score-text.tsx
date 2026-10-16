import { Tag } from "#/components/ui/tag";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { cn } from "#/lib/utils";

/** 0-10 评分对应的徽标配色:高(绿)/中(琥珀)/低(红) —— 复用语义状态 token */
function scoreClassName(n: number): string {
	if (n >= 8) return "bg-success-soft text-success-fg border-transparent";
	if (n >= 5) return "bg-warn-soft text-warn-fg border-transparent";
	return "bg-danger-soft text-danger-fg border-transparent";
}

/**
 * 标准化评分徽章(0-10,一位小数)。
 * null/空/非数字 → 占位符;否则按分数档位着色渲染为 Tag。
 */
export function ScoreText({ value, className }: { value: unknown; className?: string }) {
	if (value === null || value === undefined || value === "") {
		return <span className={cn("font-mono text-xs text-muted-foreground", className)}>{PLACEHOLDER_EMPTY}</span>;
	}
	const n = Number(value);
	if (Number.isNaN(n)) {
		return <span className={cn("font-mono text-xs text-muted-foreground", className)}>{PLACEHOLDER_EMPTY}</span>;
	}
	return <Tag className={cn(scoreClassName(n), className)}>{n.toFixed(1)}</Tag>;
}
