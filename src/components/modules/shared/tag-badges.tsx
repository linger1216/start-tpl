import { Badge } from "#/components/ui/badge";
import { type TagEntry, TagInput } from "#/components/ui/tag-input";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { cn } from "#/lib/utils";
import { RISK_TONE, TAG_DIMENSION_OF, TAG_MEANINGS } from "#/mocks/tags";

/**
 * 标签徽章列表 —— 全站标签的唯一渲染入口。
 *
 * 上色规则:优先按「维度」取色(同一维度的标签同色,便于肉眼分组),
 * 风险等级(红 / 橙 / 黄 / 绿四档,评审确认)用语义色标定,其余维度走 `DIMENSION_TONE` 里的品牌色板。
 * 颜色全部来自 `src/styles.css` 的语义 token,不写死 hex。
 */
const DIMENSION_TONE: Record<string, string> = {
	场所风险等级: "bg-danger-soft text-danger-fg",
	企业标签: "bg-primary/10 text-primary",
	场所标签: "bg-success-soft text-success-fg",
	重点案件标签: "bg-warn-soft text-warn-fg",
	走访标签: "bg-primary/10 text-primary",
	立项情况: "bg-primary/10 text-primary",
	生产许可情况: "bg-warn-soft text-warn-fg",
	竣工备案情况: "bg-success-soft text-success-fg",
	招牌样式: "bg-secondary text-secondary-foreground",
	备案完成时间: "bg-warn-soft text-warn-fg",
	重点关注人员: "bg-danger-soft text-danger-fg",
	重点场所: "bg-primary/10 text-primary",
	案件数据: "bg-warn-soft text-warn-fg",
	处罚类型: "bg-danger-soft text-danger-fg",
	违法行为领域: "bg-warn-soft text-warn-fg",
	处罚状态: "bg-secondary text-secondary-foreground",
	信用影响: "bg-danger-soft text-danger-fg",
};

/** 单标签上色:风险等级走 RISK_TONE,其余按维度取色 */
export function tagTone(tag: string): string {
	const risk = RISK_TONE[tag];
	if (risk) return risk;
	const dimension = TAG_DIMENSION_OF[tag];
	return (dimension ? DIMENSION_TONE[dimension] : undefined) ?? "bg-secondary text-secondary-foreground";
}

/** 单枚标签徽章(含义挂在 title 上,鼠标悬停可见) */
export function TagBadge({ tag, className }: { tag: string; className?: string }) {
	const meaning = TAG_MEANINGS[tag];
	return (
		<Badge
			variant="secondary"
			title={meaning ? `${tag}:${meaning}` : tag}
			className={cn("border-transparent font-normal", tagTone(tag), className)}
		>
			{tag}
		</Badge>
	);
}

/** 把 "A、B、C" / "A,B" / "A,B,C" 这类单元格文本拆成标签 */
export function splitTags(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	const text = String(value).trim();
	if (!text) return [];
	return text
		.split(/[、,，;；|]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

/** 标签列表(表格单元格 / 详情页共用) */
export function TagBadges({ tags, className }: { tags: readonly string[]; className?: string }) {
	if (tags.length === 0) return <span className="text-muted-foreground">{PLACEHOLDER_EMPTY}</span>;
	return (
		<div className={cn("flex flex-wrap items-center gap-1", className)}>
			{tags.map((tag) => (
				<TagBadge key={tag} tag={tag} />
			))}
		</div>
	);
}

/** 单元格直出:把字段值拆成标签渲染 */
export function TagCell({ value }: { value: unknown }) {
	return <TagBadges tags={splitTags(value)} />;
}

/**
 * 标签编辑控件 —— TagInput + 候选标签快选。
 *
 * 标签体系给出的候选标签是权威清单(见 `src/mocks/tags.ts`),
 * 这里把候选做成可点选的快捷按钮,同时保留自由输入(现场标签常超出枚举)。
 */
export function TagFieldInput({
	value,
	onChange,
	options,
	placeholder,
	max = 12,
}: {
	value: TagEntry[];
	onChange: (next: TagEntry[]) => void;
	options?: readonly string[];
	placeholder?: string;
	max?: number;
}) {
	const chosen = new Set(value.map((entry) => entry.value));
	return (
		<div className="space-y-2">
			<TagInput value={value} onChange={onChange} max={max} placeholder={placeholder ?? "输入后回车添加标签"} />
			{options && options.length > 0 ? (
				<div className="space-y-1">
					<div className="text-[12px] text-muted-foreground">候选标签(来自标签体系)</div>
					<div className="flex flex-wrap gap-1">
						{options.map((option) => (
							<button
								key={option}
								type="button"
								disabled={chosen.has(option)}
								onClick={() => onChange([...value, { value: option }])}
								className={cn(
									"cursor-pointer rounded-full border border-border px-2 py-0.5 text-[12px] transition-colors",
									chosen.has(option) ? "cursor-not-allowed opacity-40" : "hover:border-ring/60 hover:bg-secondary",
								)}
							>
								{option}
							</button>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
