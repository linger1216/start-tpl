import { cn } from "#/lib/utils";

/**
 * 首字圆牌(墨底反白)—— 参与人 / 卡面执行人 / 评论头像共用。
 * 尺寸与字号由调用方 `className` 给(`size-5.5 text-xs` 等);名字只取首字。
 */
export function InitialsCircle({ name, className }: { name: string; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex shrink-0 items-center justify-center rounded-full bg-primary/85 font-heading font-bold leading-none text-paper",
				className,
			)}
		>
			{name.slice(0, 1)}
		</span>
	);
}
