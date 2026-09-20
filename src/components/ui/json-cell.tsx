import { normalizeValue } from "#/lib/format";
import { type BadgeColor, BadgeList } from "./badge-list";

export { BADGE_THEMES, type BadgeThemeName } from "./badge-list";

/**
 * 通用单元格:把任意值经 normalize 归一为字符串数组,再渲染成居中 Badge。
 * 原 AddressCell / AliasCell / 所属区划 三种"值 → 徽章"场景统一到这里。
 *
 * 用法:
 *  - 默认(对象/数组列): `<JsonCell value={v} />`                              // normalizeValue + 多行
 *  - JSON 字符串列:       `<JsonCell value={v} normalize={parseMultiValue} layout="wrap" />`
 *  - 单值文本列:          `<JsonCell value={v} normalize={singleText} layout="wrap" />`
 *  - 上色:
 *      `<JsonCell value={v} />`                                              // 默认 brand(规范内配色)
 *      `<JsonCell value={v} color="ocean" />`                                // 预制主题名
 *      `<JsonCell value={v} color="stable" />`                               // 按值稳定哈希选一套彩色主题
 *      `<JsonCell value={v} color={["bg-... text-...", ...]} />`             // 自定义色板
 *
 * 主题名:brand(默认)/ rainbow / ocean / forest / sunset / lavender / stone —— 见 BADGE_THEMES。
 * brand 取自语义 token,天然符合 DESIGN.md;其余是规范外的分类色板(与 chart-1..5 同理)。
 * 调用方通常把 color 提到 page 层用 useState 管理,下拉切换主题后传入表格列。
 */
export function JsonCell({
	value,
	normalize = normalizeValue,
	layout = "stack",
	justify,
	color = "brand",
}: {
	value: unknown;
	/** 归一函数,默认 normalizeValue。JSON 字符串列传 parseMultiValue,单值字段传 singleText。 */
	normalize?: (v: unknown) => string[];
	layout?: "wrap" | "stack";
	justify?: "center" | "start";
	/**
	 * 配色:random=每次渲染从 6 主题随机选一套(默认)、预制主题名、none=无色、string[]=自定义。
	 * 推荐用法:在 page 层用 useState<BadgeColor>("random") 持有,下拉切换后注入列。
	 */
	color?: BadgeColor;
}) {
	return <BadgeList values={normalize(value)} layout={layout} justify={justify} color={color} />;
}

// ponytail: re-export so callers can `import { BADGE_THEMES, BadgeThemeName } from "@/components/ui/json-cell"`
// instead of digging into badge-list. Saves an import when wiring a theme picker.
