import { BadgeList } from "#/components/ui/badge-list";

/**
 * 标签的**渲染**工具 —— 领域无关:只负责"把一串标签画成一行徽章",不预设标签体系长什么样。
 *
 * 上色统一走 `ui/badge-list` 的 `color="stable"`(按标签值稳定哈希选主题色):
 * 同一份数据永远同一套颜色、SSR 与水合一致,而且全站分类色只有这一个实现。
 *
 * 这一版删掉了两组东西,它们都是"模板自带的演示业务"渗进通用组件:
 *  · 17 个写死的中文维度名 + 对应色号(`场所风险等级` / `重点案件标签` …)——
 *    那是某一版业务的标签分类,派生新项目后全是死映射;
 *  · 对 `src/mocks/tags` 的依赖(标签含义 / 维度归属 / 风险色),以及零调用方的
 *    `TagCell` / `TagFieldInput` / `TagBadge` / `tagTone` 四个导出。
 */

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

/**
 * 标签列表(表格单元格 / 详情页共用)。空值渲染 `PLACEHOLDER_EMPTY`,由 BadgeList 兜底。
 *
 * 不带 `className` / 主题等入参:目前没有任何调用方需要它们 —— 需要时再加,
 * 而不是先铺一个没人用的口子。
 */
export function TagBadges({ tags }: { tags: readonly string[] }) {
	return <BadgeList values={[...tags]} layout="wrap" color="stable" />;
}
