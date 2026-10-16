import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type * as React from "react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-overlay"
			className={cn(
				"fixed inset-0 isolate z-50 bg-black/20 duration-100 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
				className,
			)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	showCloseButton = true,
	...props
}: DialogPrimitive.Popup.Props & {
	showCloseButton?: boolean;
}) {
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Popup
				data-slot="dialog-content"
				className={cn(
					"fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-lg bg-popover p-6 text-popover-foreground shadow-(--shadow-card) duration-100 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close
						data-slot="dialog-close"
						render={<Button variant="ghost" className="absolute top-3.5 right-3.5 size-8" size="icon" />}
					>
						<XIcon className="size-4" />
						<span className="sr-only">关闭</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</DialogPortal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="dialog-header" className={cn("flex flex-col gap-1 pr-8", className)} {...props} />;
}

/**
 * 对话框**内容区** —— 详情 / 编辑弹窗高度策略的统一落点。
 *
 * 规矩(见 `doc/界面约定.md`):**宽度不动,高度随内容长、封顶于一个最大值**;
 * 弹窗本体**永不出滚动条**,要滚只滚这一层(header / footer 钉住不动)。
 * 配套用法:`DialogContent` 用 `flex max-h-[85vh] flex-col overflow-hidden`,`DialogBody` 管 `flex-1 overflow-y-auto`。
 */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="dialog-body" className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props} />;
}

/**
 * 上面那条"高度随内容长、封顶 85vh"规矩的**预设三件套** ——
 * 详情 / 编辑弹窗的 `DialogContent` 统一 `className={\`${DIALOG_FIT} sm:max-w-2xl\`}` 的写法,
 * 不要再逐字手抄这组 class(改高度策略只动这里)。
 */
export const DIALOG_FIT = "flex max-h-[85vh] flex-col overflow-hidden";

function DialogFooter({ className, children, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				"-mx-6 -mb-6 mt-0 flex flex-col-reverse gap-2 rounded-b-lg border-t border-border bg-secondary/40 px-6 py-4 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("font-heading text-lg leading-tight font-semibold text-foreground tracking-[-0.01em]", className)}
			{...props}
		/>
	);
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("text-sm leading-relaxed text-muted-foreground", className)}
			{...props}
		/>
	);
}

/**
 * 导出。`DialogPortal` 同时是 `sheet.tsx` 共用的转发层
 * (Sheet 就是同一个 @base-ui Dialog 原语的侧滑形态,见 sheet.tsx)。
 */
export {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
