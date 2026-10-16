import { ListChecks } from "lucide-react";
import { useMemo, useState } from "react";

import { ActionButton } from "#/components/ui/action-button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { TagList } from "#/components/ui/tag-list";
import { cn } from "#/lib/utils";

/**
 * 多选框 —— 从一份选项里挑多个(选中态就是 `string[]`)。
 *
 * **布局与 TagInput 一致**:上面一排「已选」(可点 × 删掉),下面是候选列表(勾选框)。
 * 关键约定 —— **勾选不会改变列表次序**:选中项不会跳到第一条,列表永远是 `options` 给的顺序。
 * 想确认"我选了哪些"看上面那排就够了;下面那排只管勾 / 取消勾。
 *
 * **为什么不用现成的两个**:`PermissionSelect` 与任何"下拉多选"都是**把选项全渲染出来**,
 * 而部门有 3691 个 —— 全渲染会把 DOM 撑到几万个节点(同类教训实测过:2908ms / 83,526 DOM)。
 * 所以这里是**搜索优先**:不输关键词时最多渲染 `maxRender` 条,并明确告诉使用者"还有多少条没显示"。
 *
 * 业务无关:`options` 从哪来(通常是一个 tRPC query)、选中态存哪、保存调哪个接口,全由调用方决定。
 */
export type MultiSelectOption = {
	value: string;
	label: string;
	/** 标签右侧的次要说明(如部门的上级路径),可选 */
	hint?: string;
};

export function MultiSelect({
	options,
	value,
	onChange,
	placeholder = "搜索…",
	emptyText = "没有匹配的项",
	maxRender = 50,
	maxRenderSearching = 200,
	maxHeight = 224,
	disabled = false,
	className,
	fill = false,
	trailing,
}: {
	options: readonly MultiSelectOption[];
	value: readonly string[];
	onChange: (next: string[]) => void;
	placeholder?: string;
	emptyText?: string;
	/** 未搜索时最多渲染多少条(默认 50) */
	maxRender?: number;
	/** 搜索时最多渲染多少条(默认 200) */
	maxRenderSearching?: number;
	/** 滚动区最大高度(px) */
	maxHeight?: number;
	disabled?: boolean;
	className?: string;
	/** 让候选列表**填满父容器的剩余高度**(父容器需为 flex 列且高度有界);默认 false = 用 `maxHeight` 定高 */
	fill?: boolean;
	/** 搜索行最右侧的插槽(如 MemberZone 的「加入」按钮)—— 与输入框同一行 */
	trailing?: React.ReactNode;
}) {
	const [keyword, setKeyword] = useState("");
	const selected = useMemo(() => new Set(value), [value]);
	const byValue = useMemo(
		() => new Map(options.map((option) => [option.value, option])) as Map<string, MultiSelectOption>,
		[options],
	);

	/** 上面那排「已选」标签:按**点选的先后顺序**排,不重排列表 */
	const chips = useMemo(
		() => value.map((id) => ({ id, label: byValue.get(id)?.label ?? `${id}(已不存在)` })),
		[value, byValue],
	);

	/** 下面的候选列表:只按关键词过滤 + 限流,**次序永远是 `options` 的顺序** */
	const { rows, hidden } = useMemo(() => {
		const kw = keyword.trim().toLowerCase();
		const matched = kw
			? options.filter(
					(option) => option.label.toLowerCase().includes(kw) || (option.hint ?? "").toLowerCase().includes(kw),
				)
			: options;
		const cap = kw ? maxRenderSearching : maxRender;
		return { rows: matched.slice(0, cap), hidden: Math.max(0, matched.length - cap) };
	}, [options, keyword, maxRender, maxRenderSearching]);

	const toggle = (id: string, on: boolean) => {
		if (on) {
			if (selected.has(id)) return;
			// 追加到末尾 →「已选」那排按点选顺序增长,和 TagInput 一样
			onChange([...value, id]);
			return;
		}
		onChange(value.filter((item) => item !== id));
	};

	return (
		<div className={cn(className, fill && "flex min-h-0 flex-1 flex-col")}>
			<div className="flex flex-wrap items-center gap-2">
				<ListChecks className="size-3.5 text-primary" />
				<span className="text-xs text-muted-foreground tabular-nums">
					已选 <span className="font-medium text-foreground">{value.length}</span> 项 / 共 {options.length} 项
				</span>
				<Input
					value={keyword}
					onChange={(event) => setKeyword(event.target.value)}
					placeholder={placeholder}
					disabled={disabled}
					className="h-7 w-52"
				/>
				<ActionButton disabled={disabled || value.length === 0} onClick={() => onChange([])}>
					清空
				</ActionButton>
				{trailing ? <div className="ml-auto">{trailing}</div> : null}
			</div>

			{chips.length > 0 ? (
				<div className="mt-2">
					<TagList
						values={chips.map((chip) => chip.label)}
						layout="wrap"
						justify="start"
						onRemove={(index) => {
							const chip = chips[index];
							if (!chip) return;
							onChange(value.filter((item) => item !== chip.id));
						}}
					/>
				</div>
			) : null}

			<div
				className={cn("mt-2 space-y-0.5 overflow-y-auto rounded-xl border border-border p-2", fill && "min-h-0 flex-1")}
				style={fill ? undefined : { maxHeight }}
			>
				{rows.length === 0 ? (
					<p className="px-1 py-2 text-xs text-muted-foreground">{emptyText}</p>
				) : (
					rows.map((option) => (
						// 行里**唯一的表单控件**是 Checkbox(带 aria-label);标签文字包一个 tabIndex={-1} 的按钮,
						// 只当"点一下也能勾"的鼠标帮手 —— 不加 div+onClick(缺键盘语义),也不包 <label>
						// (Base UI 的 Checkbox 不是表单控件,包 label 会被 a11y 规则拦下)。
						<div
							key={option.value}
							className={cn(
								"flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors",
								disabled ? "opacity-50" : "hover:bg-hover",
							)}
						>
							<Checkbox
								aria-label={`选择${option.label}`}
								checked={selected.has(option.value)}
								disabled={disabled}
								onCheckedChange={(checked) => toggle(option.value, checked === true)}
							/>
							<button
								type="button"
								tabIndex={-1}
								disabled={disabled}
								className="min-w-0 flex-1 truncate text-left text-sm text-foreground disabled:cursor-not-allowed"
								onClick={() => toggle(option.value, !selected.has(option.value))}
							>
								{option.label}
							</button>
							{option.hint ? (
								<span className="shrink-0 truncate text-xs text-muted-foreground">{option.hint}</span>
							) : null}
						</div>
					))
				)}
				{hidden > 0 ? (
					<p className="px-1.5 pt-1 text-xs text-muted-foreground">还有 {hidden} 项没显示 —— 输入关键词缩小范围</p>
				) : null}
			</div>
		</div>
	);
}
