import { Tag } from "#/components/ui/tag";
import { priorityLabelOf } from "#/lib/task/close-spec";

/**
 * 优先级徽章 —— 卡片与详情头**同一颗**(随机色按档位稳定:同一档永远同色)。
 * 之前两处各手写一遍 `<Tag variant="random" hashKey={`p${…}`}>`,改口径容易只改一处。
 */
export function PriorityTag({ priority }: { priority: number | null | undefined }) {
	return (
		<Tag variant="random" hashKey={`p${priority ?? "x"}`}>
			{priorityLabelOf(priority)}
		</Tag>
	);
}
