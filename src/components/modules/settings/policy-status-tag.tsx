/**
 * 规则状态徽章 —— `data-scope-table` / `data-scope-detail` 共用。
 *
 * 颜色 + 文案 + hint 走 `lib/data-scope-spec.ts` 的 `policyStatusMeta()`(单点定义),
 * 这里只负责把它装进 `<Tag>`,认不出的脏值原样显示(不把 500 抛到界面上)。
 */
import { Tag } from "#/components/ui/tag";
import { policyStatusMeta } from "#/lib/data-scope-spec";

export function PolicyStatusTag({ status }: { status: number }) {
	const meta = policyStatusMeta(status);
	return (
		<Tag className={`text-xs ${meta.tone}`} title={meta.hint}>
			{meta.label}
		</Tag>
	);
}
