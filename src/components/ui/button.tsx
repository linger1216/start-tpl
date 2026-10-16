import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#/lib/utils";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-150 ease-brand outline-none select-none active:shadow-none focus-visible:border-primary/45 focus-visible:ring-1 focus-visible:ring-primary/25 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				/* 主操作:黛蓝主题色实底(DESIGN.md §4.1)+ hover 压深一档 */
				default: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85",
				/* 幽灵：极轻底 */
				ghost: "hover:bg-muted aria-expanded:bg-muted text-foreground",
				/* 次级:surface 面板(DESIGN.md §4.1 Secondary) */
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary",
				/* 描边:纸白细边框,hover 边框加深一档 */
				outline:
					"border-border bg-background hover:border-border-strong hover:bg-muted text-foreground aria-expanded:bg-muted",
				/* 危险：红字淡底 */
				destructive:
					"bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
				/* 文字链接 */
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				/* xs: 28px 高 —— 极紧凑场景;表格行内操作请优先用 ActionButton */
				xs: "h-7 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
				/* sm: 32px 高(表格工具条密度) */
				sm: "h-8 gap-1.5 rounded-md px-3.5 text-sm [&_svg:not([class*='size-'])]:size-3.5",
				/* default: 36px 高(后台默认密度) */
				default: "h-9 gap-2 px-4 [&_svg:not([class*='size-'])]:size-4",
				/* lg: DESIGN.md §4.1 的 Primary 按钮 */
				lg: "h-10 gap-2 px-6 text-base [&_svg:not([class*='size-'])]:size-4",
				/* icon: 32px 方 */
				"icon-sm": "size-8 rounded-md",
				/* icon default: 36px 方 */
				icon: "size-9 rounded-md",
				/* icon lg: 44px 方 */
				"icon-lg": "size-11 rounded-md",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
