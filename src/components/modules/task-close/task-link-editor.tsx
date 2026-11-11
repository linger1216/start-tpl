import { ExternalLink, Link2, Plus, X } from "lucide-react";
import { useState } from "react";

import { ActionIconButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { useStableKeys } from "#/hooks/use-stable-keys";
import { blankBlock, isInternalUrl, type TaskLinkBlock } from "#/lib/task-payload";

/**
 * 链接区编辑器 —— 清单式交互(像待办):
 * 右上角 `+` 添一条;新条目就地输入 URL,**回车 / 失焦**后收成一条紧凑预览(一行两条)。
 * 预览不可点(表单里点链接会离开当前编辑),再点条目文字可回到输入态;空条目自动丢弃。
 *
 * 站内 / 站外由 host 判定(见 `isInternalUrl`),只在预览上标出来,不给人选。
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
	/** 正在输入的条目下标(null = 都在预览态);新加的条目 url 为空,天然进输入态 */
	const [editing, setEditing] = useState<number | null>(null);

	function setUrl(index: number, url: string) {
		onChange(value.map((block, i) => (i === index ? { ...block, url } : block)));
	}
	function remove(index: number) {
		onChange(value.filter((_, i) => i !== index));
		setEditing(null);
	}
	/** 输入收尾:空条目不留(和待办里"没写就删掉"一致),有内容就收成预览 */
	function commit(index: number) {
		const url = value[index]?.url.trim() ?? "";
		if (!url) {
			remove(index);
			return;
		}
		if (url !== value[index]?.url) setUrl(index, url);
		setEditing(null);
	}
	function add() {
		onChange([...value, blankBlock()]);
		setEditing(value.length);
	}

	return (
		<section className="space-y-1 border-t border-border pt-4">
			<div className="mb-1 flex items-center justify-between gap-2">
				<h3 className="text-sm font-medium text-foreground">
					链接区
					<span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">{value.length} / 30</span>
				</h3>
				<Button
					variant="outline"
					size="icon-sm"
					aria-label="添加链接"
					title="添加链接"
					disabled={disabled || value.length >= 30}
					onClick={add}
				>
					<Plus className="size-4" />
				</Button>
			</div>

			{value.length === 0 ? (
				<p className="text-xs text-muted-foreground">还没有链接。点右上角「+」添加。</p>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{value.map((block, index) => {
						const url = block.url.trim();
						const internal = isInternalUrl(url);
						const Icon = internal ? Link2 : ExternalLink;
						// 空条目 = 刚点「+」还没填,天然进输入态
						const inputting = editing === index || url === "";
						return inputting ? (
							<Input
								key={rowKeys[index]}
								autoFocus={editing === index}
								aria-label={`第 ${index + 1} 条链接`}
								className="h-8 font-mono text-xs"
								value={block.url}
								disabled={disabled}
								placeholder="/settings/users 或 https://…"
								onChange={(event) => setUrl(index, event.target.value)}
								onBlur={() => commit(index)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										commit(index);
									}
								}}
							/>
						) : (
							<div
								key={rowKeys[index]}
								className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
							>
								<Icon className="size-3.5 shrink-0 text-muted-foreground" />
								<button
									type="button"
									className="min-w-0 flex-1 cursor-text truncate text-left font-mono text-xs text-foreground hover:underline"
									title={url}
									onClick={() => setEditing(index)}
								>
									{url}
								</button>
								<span className="shrink-0 text-xs text-muted-foreground">{internal ? "站内" : "站外"}</span>
								<ActionIconButton label="删除链接" tone="danger" disabled={disabled} onClick={() => remove(index)}>
									<X className="size-3.5" />
								</ActionIconButton>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
