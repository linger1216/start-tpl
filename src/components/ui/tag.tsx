import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { useId } from "react";

import { RANDOM_PALETTE, stableIndex } from "#/lib/tag-color";
import { cn } from "#/lib/utils";

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
				/* 随机：取一色 —— 给了 `hashKey` 按**值**稳定哈希(同一值永远同色,与 TagList 的
				   color="random" 同口径);没给就按 useId **实例**随机(同一批各不相同,生命周期内不跳色) */
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
	hashKey,
	render,
	...props
}: useRender.ComponentProps<"span"> &
	VariantProps<typeof tagVariants> & {
		/** `variant="random"` 的取色源:给了就按值哈希(P0/P1/P2 这类**语义字段**必须给,否则颜色失去含义);没给退 useId 实例随机 */
		hashKey?: string;
	}) {
	// 随机色源二选一:值哈希(hashKey,同值同色)> 实例哈希(useId,SSR/客户端一致、重渲染不跳色)。
	// 两路都绕开 Math.random() —— 那是 SSR 水合不一致的老坑。
	const reactId = useId();
	const randomClassName =
		variant === "random" ? RANDOM_PALETTE[stableIndex(hashKey || reactId, RANDOM_PALETTE.length)] : undefined;
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
