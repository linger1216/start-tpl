/**
 * 「点色」公共件:6 个低饱和色相(soft 底 + fg 字)+ 按值稳定哈希选色。
 *
 * 原本 `ui/tag.tsx` 与 `ui/tag-list.tsx` 各自带一份 `RANDOM_PALLETTE` + 哈希函数 —— 同色板
 * 改了不同步会立刻穿帮(整页同一种「随机色」看起来却不随机),哈希口径漂移会导致 SSR 水合
 * 不一致。这里集中一份,两个组件都从这拿。
 *
 * 不用 `Math.random()`:那条老路在 SSR 时服务端与客户端各跑一次,水合不一致;同一组数据
 * 重渲染还会跳色(用户最直观的吐槽:「我刷新一下颜色怎么变了」)。按值哈希后,同值 → 同色,
 * SSR 与重渲染都稳。
 */

/** 6 个低饱和色相 —— 与 DESIGN.md §2 的品牌色分得开,给"分类点色"用 */
export const RANDOM_PALETTE = [
	"bg-hue-violet-soft text-hue-violet-fg",
	"bg-hue-amber-soft text-hue-amber-fg",
	"bg-hue-emerald-soft text-hue-emerald-fg",
	"bg-hue-blue-soft text-hue-blue-fg",
	"bg-hue-rose-soft text-hue-rose-fg",
	"bg-hue-teal-soft text-hue-teal-fg",
] as const;

/** 按 key 稳定哈希(31 进制)取下标 —— SSR 水合一致 + 重渲染不跳色 */
export function stableIndex(key: string, length: number): number {
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
	return Math.abs(h) % length;
}
