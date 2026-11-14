import { ExternalLink, Link2, X } from "lucide-react";

import { ActionIconButton } from "#/components/ui/action-button";
import { Input } from "#/components/ui/input";
import { useStableKeys } from "#/hooks/use-stable-keys";
import { blankBlock, isInternalUrl, type TaskLinkBlock } from "#/lib/task/payload";

/**
 * 链接区编辑器 —— 清单式交互(像待办):
 * 「+」由调用方放在折叠区标题行(见 `task-form.tsx`),它只是往数组末尾推一条空块;
 * 中间是**可编辑的地址输入框**(全宽),下面是**预览**
 * (站内 / 站外由 host 判定,见 `isInternalUrl`,只在预览上标出来,不给人选)。
 * 回车 = 提交这一条并**自动续一行**;空条目失焦即丢弃 —— 与待办里「没写就删掉」一致。
 */
export function TaskLinkEditor({
	value,
	onChange,
	disabled,
}: {
	value: TaskLinkBlock[];
	onChange: (next: TaskLinkBlock[]) => void;
	disabled?: boolean;
}) {
	const rowKeys = useStableKeys(value.length, "tc-link");

	function setUrl(index: number, url: string) {
		onChange(value.map((block, i) => (i === index ? { ...block, url } : block)));
	}
	function remove(index: number) {
		onChange(value.filter((_, i) => i !== index));
	}
	/** 输入收尾:空条目不留,有内容就裁掉首尾空白 */
	function commit(index: number) {
		const url = value[index]?.url.trim() ?? "";
		if (!url) {
			remove(index);
			return;
		}
		if (url !== value[index]?.url) setUrl(index, url);
	}
	/** 回车:提交本条;已经是最后一条且还有空位就顺手开一条新的,省一次点「+」 */
	function commitAndContinue(index: number) {
		const url = value[index]?.url.trim() ?? "";
		if (!url) {
			remove(index);
			return;
		}
		commit(index);
		if (index === value.length - 1 && value.length < 30) onChange([...value, blankBlock()]);
	}

	/** 预览只显示填好的条目(还没写完的不出现在下面) */
	const previews = value
		.map((block, index) => ({ block, index, url: block.url.trim() }))
		.filter((item) => item.url !== "");

	return (
		<div className="space-y-2">
			{value.map((block, index) => (
				<div key={rowKeys[index]} className="flex items-center gap-1.5">
					<Input
						autoFocus={index === value.length - 1 && block.url === ""}
						aria-label={`第 ${index + 1} 条链接`}
						className="h-8 flex-1 font-mono text-xs"
						value={block.url}
						disabled={disabled}
						placeholder="/settings/users 或 https://…"
						onChange={(event) => setUrl(index, event.target.value)}
						onBlur={() => commit(index)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commitAndContinue(index);
							}
						}}
					/>
					<ActionIconButton label="删除链接" tone="danger" disabled={disabled} onClick={() => remove(index)}>
						<X className="size-3.5" />
					</ActionIconButton>
				</div>
			))}

			{previews.length > 0 ? (
				<div className="grid gap-2 pt-1 sm:grid-cols-2">
					{previews.map(({ index, url }) => {
						const internal = isInternalUrl(url);
						const Icon = internal ? Link2 : ExternalLink;
						return (
							<div
								key={rowKeys[index]}
								className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
								title={url}
							>
								<Icon className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{url}</span>
								<span className="shrink-0 text-xs text-muted-foreground">{internal ? "站内" : "站外"}</span>
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
