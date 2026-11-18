import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cva, type VariantProps } from "class-variance-authority";

import { RANDOM_PALETTE, stableIndex } from "#/lib/tag-color";
import { cn } from "#/lib/utils";

/**
 * 头像 —— 全站**唯一**的人像形态。
 *
 * 三件事都在这一份里定死,调用点不许再各写一套:
 * ① **尺寸**:只走 `size` 档 —— 圆的大小与首字的字号由**同一档**决定(圆大了字不跟着大就不成比例)。
 *    调用点不要再用 `className` 改大小,否则大小与字号就脱钩了。
 * ② **颜色**:名字 hash 落桶到色板 —— **同一个人在任何地方都是同一个颜色**
 *    (卡片 / 评论 / 成员 / 责任范围 / 顶栏 / 用户台账),色板与 Tag 同一份(`lib/tag-color.ts`)。
 * ③ **字形**:首字 + 无衬线字族(DESIGN.md §4.4 的「人」的视觉身份)。
 *
 * 有头像地址就走真照片;没有(或照片挂了)就落到首字圆牌。
 */

/** 尺寸档 —— 圆的大小 */
const avatarVariants = cva(
	"relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:border after:border-foreground/10",
	{
		variants: {
			size: {
				xs: "size-5",
				sm: "size-6",
				md: "size-7",
				default: "size-8",
				lg: "size-9",
				"2xl": "size-26",
			},
		},
		defaultVariants: { size: "default" },
	},
);

/** 首字字号 —— **跟着圆一起长**(与尺寸档一一对应,别再单独调) */
const avatarTextVariants = cva(
	"flex size-full items-center justify-center rounded-full font-sans font-semibold leading-none",
	{
		variants: {
			size: {
				xs: "text-[10px]",
				sm: "text-[11px]",
				md: "text-xs",
				default: "text-sm",
				lg: "text-[15px]",
				"2xl": "text-4xl",
			},
		},
		defaultVariants: { size: "default" },
	},
);

export type AvatarSize = NonNullable<VariantProps<typeof avatarVariants>["size"]>;

/** 名字 → 固定色:hash 落桶,同名同色(与 Tag 的取色同源) */
function toneOf(name: string): string {
	return RANDOM_PALETTE[stableIndex(name || "?", RANDOM_PALETTE.length)];
}

export function Avatar({
	name,
	size = "default",
	src,
	alt,
	className,
	...props
}: Omit<AvatarPrimitive.Root.Props, "children"> &
	VariantProps<typeof avatarVariants> & {
		/** 人名 —— 首字与颜色都由它决定 */
		name: string;
		/** 头像地址;没有(或加载失败)就落到首字圆牌 */
		src?: string | null;
		alt?: string;
	}) {
	return (
		<AvatarPrimitive.Root data-size={size} className={cn(avatarVariants({ size }), className)} {...props}>
			{src ? (
				<AvatarPrimitive.Image src={src} alt={alt ?? name} className="size-full rounded-full object-cover" />
			) : null}
			<AvatarPrimitive.Fallback className={cn(avatarTextVariants({ size }), toneOf(name))}>
				{Array.from(name.trim())[0]?.toUpperCase() || "?"}
			</AvatarPrimitive.Fallback>
		</AvatarPrimitive.Root>
	);
}
