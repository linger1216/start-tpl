import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "#/lib/utils";

/**
 * 气泡浮层 —— 与 `dropdown-menu.tsx` **同一套 Base UI 原语**(Portal + Positioner + Popup)、
 * 同一套入场动画(`tw-animate-css` 的 `data-open:animate-in` 那组)。
 *
 * 为什么改用 Base UI:整个 `ui/` 目录只有它和 `tabs.tsx` 是 Radix,其余 16 个文件都是 Base UI ——
 * 两套原语库意味着两套 prop 口径(要不要 `render`、`onClick` 还是 `onSelect`)、两棵依赖树。
 * 收敛到一套之后,`ui/` 里只剩一种心智模型。
 *
 * 只导出真正用得到的三件:`Popover` / `PopoverTrigger` / `PopoverContent`
 * (原来的 Anchor / Header / Title / Description 全仓库 0 处使用)。
 */
function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
	className,
	align = "center",
	alignOffset = 0,
	side = "bottom",
	sideOffset = 4,
	...props
}: PopoverPrimitive.Popup.Props &
	Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner
				className="isolate z-50 outline-none"
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
			>
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					className={cn(
						"z-50 max-h-(--available-height) w-72 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-4 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

export { Popover, PopoverContent, PopoverTrigger };
