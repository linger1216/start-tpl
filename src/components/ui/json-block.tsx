import { formatJson } from "#/lib/format";

/** JSON 字段的统一渲染容器 —— 详情/调试面板通用 */
export function JsonBlock({ value }: { value: unknown }) {
	return (
		<pre className="max-h-32 overflow-auto rounded-lg bg-secondary/60 p-2 font-mono text-[11.5px] leading-relaxed">
			{formatJson(value)}
		</pre>
	);
}
