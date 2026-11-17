import { Tag } from "#/components/ui/tag";
import { priorityLabelOf, priorityToneOf } from "#/lib/task/close-spec";

/**
 * 优先级徽章 —— 卡片与详情头**同一颗**(随机色按档位稳定:同一档永远同色)。
 *
 * 颜色口径在 `priorityToneOf` 里 —— 筛选胶囊也用它,同一个 P0 在徽章与胶囊上是同一个颜色。
 */
export function PriorityTag({ priority }: { priority: number | null | undefined }) {
	return (
		<Tag variant="outline" className={`border-transparent ${priorityToneOf(priority)}`}>
			{priorityLabelOf(priority)}
		</Tag>
	);
}
