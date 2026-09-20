/**
 * TagInput —— 业务无关的数组型标签输入组件。
 *
 * 用法(回车提交 = 常见 TagInput 交互):
 *   <TagInput value={entries} onChange={setEntries} max={20} />
 *
 * 交互:
 *  - 输入后回车 / 失焦 / 点 + → 加入列表(去空 / 去重),清空输入框
 *  - 草稿展开:`a,b,c` 一次添加 3 条、`["x","y"]` 一次添加 2 条
 *    (逗号分隔 / JSON 数组字符串自动展开;细节见 parseTagDraft)
 *  - 已添加的 Badge 上有 × 按钮,点击删除单个条目
 *  - 输入框自身始终保持空白(条目存到列表)
 *  - 达到 max 后禁用添加;展开后超过 max 会被截断
 *  - 可选:复制按钮(值以分隔符拼接复制到剪贴板)
 *
 * 注意:本组件保持业务无关 —— 跳过率等业务概念(addr-sim 前后缀)由
 * 业务模块自己渲染(参见 addr-sim-step-row 的 RateSlider),不塞进通用控件。
 */

import { Copy, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BadgeList } from "#/components/ui/badge-list";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";

/** 标签条目(通用形态:仅一个 value 字段) */
export type TagEntry = { value: string };

/**
 * 草稿展开:把 `"a,b,c"` 拆成多值、把 `'["x","y"]'` 识别为 JSON 数组并展开;
 * 其他情况按单值处理。失败返回 null。
 */
function parseDraftItems(draft: string): string[] {
	const text = draft.trim();
	if (!text) return [];
	if (text.startsWith("[")) {
		try {
			const parsed = JSON.parse(text);
			if (Array.isArray(parsed)) {
				return parsed.map((item) => String(item).trim()).filter(Boolean);
			}
		} catch {
			// 落到下面的单值处理
		}
	}
	return text
		.split(/[,，;；|]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** 去空 + 去重(保留首次出现顺序) */
function dedupEntries(entries: TagEntry[]): TagEntry[] {
	const seen = new Set<string>();
	const out: TagEntry[] = [];
	for (const e of entries) {
		const v = e.value.trim();
		if (!v) continue;
		if (seen.has(v)) continue;
		seen.add(v);
		out.push({ value: v });
	}
	return out;
}

export function TagInput({
	value,
	onChange,
	max = 20,
	placeholder = "输入后回车添加",
	disabled,
	enableCopy,
	copySeparator = ",",
}: {
	value: TagEntry[];
	onChange: (next: TagEntry[]) => void;
	max?: number;
	placeholder?: string;
	disabled?: boolean;
	/** 启用"复制"按钮:把当前所有值以指定分隔符(默认逗号)拼成字符串复制到剪贴板 */
	enableCopy?: boolean;
	/** 复制拼接的分隔符,默认英文逗号(若需中文逗号可传 "，") */
	copySeparator?: string;
}) {
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);

	// 父组件外部重置(例如 dialog 重新打开)时,清空草稿
	useEffect(() => {
		setDraft("");
	}, [value]);

	const remaining = Math.max(0, max - value.length);
	const isDisabled = disabled === true || remaining === 0;

	function commitDraft() {
		// 草稿展开:逗号分隔或 JSON 数组字符串会一次性展开为多条;单值按原逻辑处理
		const items = parseDraftItems(draft);
		if (items.length === 0) {
			setDraft("");
			return;
		}
		// 去重 + 不超过 max(超出部分截断)
		const next = dedupEntries([...value, ...items.map((v: string) => ({ value: v }))]);
		const capped = next.length > max ? next.slice(0, max) : next;
		onChange(capped);
		setDraft("");
	}

	/** 复制全部值(以分隔符拼接)到剪贴板 */
	async function handleCopy() {
		if (value.length === 0) return;
		const text = value.map((e) => e.value).join(copySeparator);
		try {
			if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				// 旧浏览器 fallback:临时 textarea + execCommand
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.style.position = "fixed";
				ta.style.left = "-9999px";
				document.body.appendChild(ta);
				ta.select();
				document.execCommand("copy");
				document.body.removeChild(ta);
			}
			toast.success(`已复制 ${value.length} 个值到剪贴板`);
		} catch (err) {
			toast.error("复制失败,请手动选择文本复制");
			void err;
		}
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					ref={inputRef}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commitDraft();
						}
					}}
					onBlur={commitDraft}
					placeholder={placeholder}
					disabled={isDisabled}
					aria-label="输入后回车添加"
				/>
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					onClick={commitDraft}
					disabled={isDisabled || draft.trim() === ""}
					aria-label="添加"
					title="添加"
				>
					<Plus className="size-4" />
				</Button>
				{enableCopy && (
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						onClick={handleCopy}
						disabled={value.length === 0}
						aria-label={`复制 ${value.length} 个值到剪贴板(以${copySeparator}分隔)`}
						title={value.length === 0 ? "暂无可复制的值" : `复制 ${value.length} 个值(以${copySeparator}分隔)`}
					>
						<Copy className="size-4" />
					</Button>
				)}
			</div>
			<BadgeList
				values={value.map((e) => e.value)}
				layout="wrap"
				justify="start"
				onRemove={(i) => onChange(value.filter((_, idx) => idx !== i))}
			/>
		</div>
	);
}
