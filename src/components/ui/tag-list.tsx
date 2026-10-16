import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Tag } from "#/components/ui/tag";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { cn } from "#/lib/utils";

/**
 * 通用徽章列表 —— 展示层共享组件,供表格「多值单元格」与可编辑标签输入(TagInput)复用。
 *
 * 渲染规则:
 *  - values 为空   → 显示 emptyPlaceholder(默认 PLACEHOLDER_EMPTY)
 *  - layout=stack  → 纵向堆叠、整体居中(原 AddressCell 多行形态)
 *  - layout=wrap   → 横向自动换行、按 justify 对齐(原 AliasCell / 所属区划 / TagInput 形态)
 *  - 传 onRemove   → 每个 Tag 末尾加 × 删除按钮(可编辑场景)
 *
 * color:
 *  - "none"            → 不上色(只用 Tag 自带的描边)
 *  - "brand"(默认)     → 规范内的中性/品牌色板,默认就符合 DESIGN.md
 *  - "stable"          → 由 values 稳定哈希选**一套**彩色主题:同一份数据永远是同一套颜色(列表内按 i % len 轮转)
 *  - "random"          → **每一项**按其取值稳定哈希从 6 色相里取色:同一值永远同一色(看起来随机)
 *                        注:实现是按值哈希而不是 Math.random() —— 后者会 SSR 水合不一致 + 重渲染跳色
 *  - 预制彩色主题(规范外,与 chart-1..5 同属分类色板;DESIGN.md §2 只定义 7 个品牌色):
 *      "rainbow" / "ocean" / "forest" / "sunset" / "lavender" / "stone"
 *  - string[]          → 自定义色板,按 i % len 取色,每项 Tailwind 类(如 "bg-primary/10 text-primary")
 */

/**
 * 主题色板:每项 = 底色 + 文字色。
 *
 * 配色口径(2026-09 重调):
 *  之前这几个主题直接用了 Tailwind 的 `*-100 / *-700`(如 `bg-violet-100 text-violet-700`),
 *  那些是**高饱和**的默认调色板(约 25%–40% 彩度),铺一屏标签会显得"亮、吵"。
 *  现在全部改走 `styles.css` 的「点缀色谱」—— 6 个低饱和色相(9%–13% 彩度),
 *  每个色相的软底/文字态由 token 保证浅底深字可读性。
 *
 *  这套替换是**全局生效**的:表格标签列、可编辑标签输入与之后的 filter-chips 展示件
 *  都读这张表,所以改这里 = 全站分类色一次性统一。
 *
 *  各主题的区别在**色相轮转顺序**(每页从不同的色相起手),而不是"用不同的色板" ——
 *  色相就那 6 个,靠顺序 + 起手色制造区分度,同时保证同一屏里不会出现撞色。
 */
export const TAG_THEMES = {
	/** 默认:全部取自语义 token,天然符合 DESIGN.md 的配色规范 */
	brand: [
		"bg-primary/10 text-primary",
		"bg-success-soft text-success-fg",
		"bg-foreground/10 text-foreground",
		"bg-secondary text-secondary-foreground",
	],
	rainbow: [
		"bg-hue-violet-soft text-hue-violet-fg",
		"bg-hue-amber-soft text-hue-amber-fg",
		"bg-hue-emerald-soft text-hue-emerald-fg",
		"bg-hue-blue-soft text-hue-blue-fg",
		"bg-hue-rose-soft text-hue-rose-fg",
		"bg-hue-teal-soft text-hue-teal-fg",
	],
	ocean: [
		"bg-hue-blue-soft text-hue-blue-fg",
		"bg-hue-teal-soft text-hue-teal-fg",
		"bg-hue-emerald-soft text-hue-emerald-fg",
		"bg-hue-violet-soft text-hue-violet-fg",
		"bg-hue-rose-soft text-hue-rose-fg",
		"bg-hue-amber-soft text-hue-amber-fg",
	],
	forest: [
		"bg-hue-emerald-soft text-hue-emerald-fg",
		"bg-hue-teal-soft text-hue-teal-fg",
		"bg-hue-amber-soft text-hue-amber-fg",
		"bg-hue-blue-soft text-hue-blue-fg",
		"bg-hue-violet-soft text-hue-violet-fg",
		"bg-hue-rose-soft text-hue-rose-fg",
	],
	sunset: [
		"bg-hue-amber-soft text-hue-amber-fg",
		"bg-hue-rose-soft text-hue-rose-fg",
		"bg-hue-violet-soft text-hue-violet-fg",
		"bg-hue-rose-soft text-hue-rose-fg",
		"bg-hue-teal-soft text-hue-teal-fg",
		"bg-hue-emerald-soft text-hue-emerald-fg",
	],
	lavender: [
		"bg-hue-violet-soft text-hue-violet-fg",
		"bg-hue-blue-soft text-hue-blue-fg",
		"bg-hue-rose-soft text-hue-rose-fg",
		"bg-hue-teal-soft text-hue-teal-fg",
		"bg-hue-amber-soft text-hue-amber-fg",
		"bg-hue-emerald-soft text-hue-emerald-fg",
	],
	stone: [
		"bg-secondary text-secondary-foreground",
		"bg-muted text-muted-foreground",
		"bg-foreground/10 text-foreground",
		"bg-foreground/5 text-muted-foreground",
	],
} as const satisfies Record<string, readonly string[]>;

type TagThemeName = keyof typeof TAG_THEMES;

/** 彩色主题(规范外分类色板)—— "stable" 模式从这里选 */
const COLORFUL_THEMES = (Object.keys(TAG_THEMES) as TagThemeName[]).filter((n) => n !== "brand");

/** 6 色相池 —— "random" 模式按值逐项取色用(即 rainbow 主题的色板) */
const RAINBOW_PALETTE = TAG_THEMES.rainbow;

export type TagColor = "none" | keyof typeof TAG_THEMES | "stable" | "random" | readonly string[] | string[];

/**
 * 稳定哈希选色。
 *
 * 之前这里用的是 `Math.random()`,有两个真实缺陷:
 *   1. SSR 时服务端与客户端各随机一次 → 水合不一致;
 *   2. 组件每次重渲染都会换色(状态一变,整行徽章颜色全跳)。
 * 改为按值哈希后,同一份数据永远得到同一套颜色。
 */
function stablePick<T>(items: readonly T[], key: string): T {
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
	return items[Math.abs(h) % items.length]!;
}

export function TagList({
	values,
	layout = "stack",
	justify = "start",
	onRemove,
	emptyPlaceholder,
	color = "brand",
}: {
	values: string[];
	layout?: "wrap" | "stack";
	justify?: "center" | "start";
	onRemove?: (index: number) => void;
	emptyPlaceholder?: ReactNode;
	color?: TagColor;
}) {
	if (values.length === 0) {
		return <span className="text-muted-foreground truncate text-xs">{emptyPlaceholder ?? PLACEHOLDER_EMPTY}</span>;
	}

	// "stable":按 values 稳定哈希选一套彩色主题,色板内按 i % len 循环。
	// 同一份数据 → 同一套颜色;不用 Math.random(),因此 SSR 水合一致、重渲染也不跳色。
	const stablePalette =
		color === "stable"
			? stablePick(
					COLORFUL_THEMES.map((n) => TAG_THEMES[n]),
					values.join("\u0000"),
				)
			: [];

	const resolveColor = (i: number, value: string): string | undefined => {
		if (color === "none") return undefined;
		// "random":每一项按**取值**哈希从 6 色相里取色 —— 同一值永远同一色,不同值看起来随机分布
		if (color === "random") return stablePick(RAINBOW_PALETTE, value);
		if (color === "stable") return stablePalette[i % stablePalette.length];
		if (typeof color === "string" && color in TAG_THEMES) {
			const palette = TAG_THEMES[color as TagThemeName];
			return palette[i % palette.length];
		}
		const arr = color as readonly string[];
		return arr.length > 0 ? arr[i % arr.length] : undefined;
	};

	const badges = values.map((value, i) => (
		<Tag key={`${value}-${i}`} className={cn("p-2.5 gap-1", resolveColor(i, value))} variant="outline">
			<span>{value}</span>
			{onRemove && (
				<button
					type="button"
					onClick={() => onRemove(i)}
					aria-label={`删除 ${value}`}
					title="删除"
					className="text-muted-foreground hover:text-danger"
				>
					<X className="size-3" />
				</button>
			)}
		</Tag>
	));

	if (layout === "stack") {
		return <div className="flex flex-col items-start gap-1 text-muted-foreground">{badges}</div>;
	}

	return (
		<div
			className={`flex flex-wrap gap-1 text-muted-foreground ${
				justify === "center" ? "justify-center" : "justify-start"
			}`}
		>
			{badges}
		</div>
	);
}
