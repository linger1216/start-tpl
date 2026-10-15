import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";
import { cn } from "#/lib/utils";

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
	return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
	return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
	align = "start",
	alignOffset = 0,
	side = "bottom",
	sideOffset = 4,
	className,
	...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				className="isolate z-50 outline-none"
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
			>
				<MenuPrimitive.Popup
					data-slot="dropdown-menu-content"
					className={cn(
						"z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

/**
 * 分组。Base UI 的 `Menu.GroupLabel` **必须在 Group / RadioGroup 内部**才有 context
 * (否则运行时抛 "MenuGroupContext is missing")。所以:
 *  - 想给分组加标题 → 传 `label`(本组件负责把它放进 GroupLabel);
 *  - 只是想插一行小标题 → 用 `DropdownMenuLabel`(下面那个,普通 div,不依赖分组)。
 */
function DropdownMenuGroup({
	className,
	label,
	children,
	...props
}: MenuPrimitive.Group.Props & { label?: React.ReactNode }) {
	return (
		<MenuPrimitive.Group data-slot="dropdown-menu-group" className={className} {...props}>
			{label ? (
				<MenuPrimitive.GroupLabel
					data-slot="dropdown-menu-group-label"
					className="px-1.5 py-1 text-xs font-medium text-muted-foreground"
				>
					{label}
				</MenuPrimitive.GroupLabel>
			) : null}
			{children}
		</MenuPrimitive.Group>
	);
}

/**
 * 菜单里的一行小标题(如「操作」「危险区」)。
 *
 * **刻意不是 `Menu.GroupLabel`**:Base UI 的 GroupLabel 依赖 `Menu.Group` 的 context,
 * 单独放在 Content 里会直接报错(实测:`MenuGroupContext is missing ...`)。
 * 但 shadcn 的 API 形态就是「Label 直接放进 Content」,所以这里退化成普通 div ——
 * 视觉一致,且放哪里都不炸。需要真正的 ARIA 分组标题时,改用 `<DropdownMenuGroup label="…">`。
 */
function DropdownMenuLabel({
	className,
	inset,
	...props
}: React.ComponentProps<"div"> & {
	inset?: boolean;
}) {
	return (
		<div
			data-slot="dropdown-menu-label"
			data-inset={inset ? "" : undefined}
			className={cn("px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7", className)}
			{...props}
		/>
	);
}

function DropdownMenuItem({
	className,
	inset,
	variant = "default",
	...props
}: MenuPrimitive.Item.Props & {
	inset?: boolean;
	variant?: "default" | "destructive";
}) {
	return (
		<MenuPrimitive.Item
			data-slot="dropdown-menu-item"
			data-inset={inset}
			data-variant={variant}
			className={cn(
				"relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-muted/50 focus:text-foreground not-data-[variant=destructive]:focus:**text-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
	return (
		<MenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn("-mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="dropdown-menu-shortcut"
			className={cn(
				"ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
};
