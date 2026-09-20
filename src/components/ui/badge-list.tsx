import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "#/components/ui/badge";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { cn } from "#/lib/utils";

/**
 * 通用徽章列表 —— 展示层共享组件,供表格单元格(JsonCell)与可编辑标签输入(TagInput)复用。
 *
 * 渲染规则:
 *  - values 为空   → 显示 emptyPlaceholder(默认 PLACEHOLDER_EMPTY)
 *  - layout=stack  → 纵向堆叠、整体居中(原 AddressCell 多行形态)
 *  - layout=wrap   → 横向自动换行、按 justify 对齐(原 AliasCell / 所属区划 / TagInput 形态)
 *  - 传 onRemove   → 每个 Badge 末尾加 × 删除按钮(可编辑场景)
 *
 * color:
 *  - "none"            → 不上色(只用 Badge 自带的描边)
 *  - "brand"(默认)     → 规范内的中性/品牌色板,默认就符合 DESIGN.md
 *  - "stable"          → 由 values 稳定哈希选一套下列彩色主题:同一份数据永远是同一套颜色
 *                        注:名字保留历史值 "random",但实现是稳定哈希 —— 不再每次渲染随机
 *  - 预制彩色主题(规范外,与 chart-1..5 同属分类色板;DESIGN.md §2 只定义 7 个品牌色):
 *      "rainbow" / "ocean" / "forest" / "sunset" / "lavender" / "stone"
 *  - string[]          → 自定义色板,按 i % len 取色,每项 Tailwind 类(如 "bg-primary/10 text-primary")
 */

/** 主题色板:每项 = 底色 + 文字色 */
export const BADGE_THEMES = {
	/** 默认:全部取自语义 token,天然符合 DESIGN.md 的 7 色规范 */
	brand: [
		"bg-primary/10 text-primary",
		"bg-success-soft text-success-fg",
		"bg-foreground/8 text-foreground",
		"bg-secondary text-secondary-foreground",
	],
	rainbow: [
		"bg-violet-100 text-violet-700",
		"bg-amber-100 text-amber-700",
		"bg-emerald-100 text-emerald-700",
		"bg-sky-100 text-sky-700",
		"bg-indigo-100 text-indigo-700",
		"bg-pink-100 text-pink-700",
	],
	ocean: [
		"bg-sky-100 text-sky-700",
		"bg-cyan-100 text-cyan-700",
		"bg-teal-100 text-teal-700",
		"bg-blue-100 text-blue-700",
		"bg-indigo-100 text-indigo-700",
	],
	forest: [
		"bg-emerald-100 text-emerald-700",
		"bg-lime-100 text-lime-700",
		"bg-teal-100 text-teal-700",
		"bg-green-100 text-green-700",
		"bg-amber-100 text-amber-700",
	],
	sunset: [
		"bg-orange-100 text-orange-700",
		"bg-amber-100 text-amber-700",
		"bg-yellow-100 text-yellow-700",
		"bg-pink-100 text-pink-700",
		"bg-fuchsia-100 text-fuchsia-700",
	],
	lavender: [
		"bg-violet-100 text-violet-700",
		"bg-purple-100 text-purple-700",
		"bg-fuchsia-100 text-fuchsia-700",
		"bg-pink-100 text-pink-700",
		"bg-indigo-100 text-indigo-700",
	],
	stone: [
		"bg-slate-100 text-slate-700",
		"bg-gray-100 text-gray-700",
		"bg-zinc-100 text-zinc-700",
		"bg-neutral-100 text-neutral-700",
		"bg-stone-100 text-stone-700",
	],
} as const satisfies Record<string, readonly string[]>;

export type BadgeThemeName = keyof typeof BADGE_THEMES;

/** 彩色主题(规范外分类色板)—— "stable" 模式从这里选 */
const COLORFUL_THEMES = (Object.keys(BADGE_THEMES) as BadgeThemeName[]).filter((n) => n !== "brand");

/** "random" 是历史名,保留为 "stable" 的别名(行为已改为稳定哈希,不再随机) */
export type BadgeColor = "none" | BadgeThemeName | "stable" | "random" | readonly string[] | string[];

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

export function BadgeList({
	values,
	layout = "stack",
	justify = "start",
	onRemove,
	onBadgeClick,
	emptyPlaceholder,
	color = "brand",
}: {
	values: string[];
	layout?: "wrap" | "stack";
	justify?: "center" | "start";
	onRemove?: (index: number) => void;
	onBadgeClick?: (value: string, index: number) => void;
	emptyPlaceholder?: ReactNode;
	color?: BadgeColor;
}) {
	if (values.length === 0) {
		return <span className="text-muted-foreground">{emptyPlaceholder ?? PLACEHOLDER_EMPTY}</span>;
	}

	// "stable"(旧名 "random"):按 values 稳定哈希选一套彩色主题,色板内按 i % len 循环。
	// 同一份数据 → 同一套颜色;不再用 Math.random(),因此 SSR 水合一致、重渲染也不跳色。
	const stablePalette =
		color === "stable" || color === "random"
			? stablePick(
					COLORFUL_THEMES.map((n) => BADGE_THEMES[n]),
					values.join("\u0000"),
				)
			: undefined;

	const resolveColor = (i: number): string | undefined => {
		if (color === "none") return undefined;
		if (color === "stable" || color === "random") return stablePalette![i % stablePalette!.length];
		if (typeof color === "string" && color in BADGE_THEMES) {
			const palette = BADGE_THEMES[color as BadgeThemeName];
			return palette[i % palette.length];
		}
		const arr = color as readonly string[];
		return arr.length > 0 ? arr[i % arr.length] : undefined;
	};

	const badges = values.map((value, i) => (
		<Badge
			key={`${value}-${i}`}
			className={cn("p-2.5 gap-1", resolveColor(i), onBadgeClick && "cursor-pointer")}
			variant="outline"
			role={onBadgeClick ? "button" : undefined}
			tabIndex={onBadgeClick ? 0 : undefined}
			onClick={onBadgeClick ? () => onBadgeClick(value, i) : undefined}
			onKeyDown={
				onBadgeClick
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onBadgeClick(value, i);
							}
						}
					: undefined
			}
		>
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
		</Badge>
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
