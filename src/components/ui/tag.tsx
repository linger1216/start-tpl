import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { useId } from "react";

import { cn } from "#/lib/utils";

/**
 * 「随机」色板 —— 与 `ui/tag-list.tsx` 的 `TAG_THEMES.rainbow` 同一套 6 个**低饱和**色相
 * (soft 底 + fg 字)。同目录互相 import 会成环,这里本地声明一份,两种口径保持一致。
 */
const RANDOM_PALLETTE = [
	"bg-hue-violet-soft text-hue-violet-fg",
	"bg-hue-amber-soft text-hue-amber-fg",
	"bg-hue-emerald-soft text-hue-emerald-fg",
	"bg-hue-blue-soft text-hue-blue-fg",
	"bg-hue-rose-soft text-hue-rose-fg",
	"bg-hue-teal-soft text-hue-teal-fg",
] as const;

/** 按值稳定哈希(31 进制,与 TagList 的 `stablePick` 同口径) —— 取色不用 `Math.random()`,那是 SSR 水合不一致的老坑 */
function stableIndex(key: string, length: number): number {
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
	return Math.abs(h) % length;
}

const tagVariants = cva(
	"inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-normal whitespace-nowrap transition-[color,background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/25 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
	{
		variants: {
			variant: {
				/* 默认：天空蓝胶囊 */
				default: "bg-primary text-primary-foreground",
				/* 次级：淡蓝底 */
				secondary: "bg-secondary text-secondary-foreground",
				/* 危险：红字淡底 */
				destructive: "bg-destructive/10 text-destructive",
				/* 描边：细边框 */
				outline: "border-border text-foreground",
				/* 幽灵 */
				ghost: "hover:bg-muted text-muted-foreground",
				/* 链接 */
				link: "text-primary underline-offset-4 hover:underline",
				/* 随机：每个实例随机取一色(色板在 Tag 里按 useId 哈希追加,SSR 安全) */
				random: "border-transparent",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Tag({
	className,
	variant = "default",
	render,
	...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof tagVariants>) {
	// 随机色源:useId 对服务端/客户端一致(不会水合不一致),且只对**这一个实例**稳定 ——
	// 同一批 Tag 里每个实例各自随机,单个 Tag 在它的生命周期里不跳色。
	const reactId = useId();
	const randomClassName =
		variant === "random" ? RANDOM_PALLETTE[stableIndex(reactId, RANDOM_PALLETTE.length)] : undefined;
	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{
				className: cn(tagVariants({ variant }), randomClassName, className),
			},
			props,
		),
		render,
		state: {
			slot: "badge",
			variant,
		},
	});
}

export { Tag, tagVariants };
