import { formatJson } from "#/lib/format";
import { cn } from "#/lib/utils";

/** JSON 字段的统一渲染容器 —— 详情/调试面板通用;`className` 追加在容器上(可覆盖 max-h) */
export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
	return (
		<pre
			className={cn(
				"max-h-32 overflow-auto rounded-lg bg-secondary/60 p-2 font-mono text-xs leading-relaxed",
				className,
			)}
		>
			{formatJson(value)}
		</pre>
	);
}
