import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "#/lib/utils";

/**
 * 单选组 —— 少数互斥选项(二选一 / 三选一)用;选项多于三四个换 `Select`。
 *
 * 用法:`<RadioGroup value onValueChange><Radio value="a">选项A</Radio>…</RadioGroup>`,
 * 选项文字直接写在 `Radio` 的 children 里(整个都是可点的)。
 * 与 `ui/checkbox` 同一套样式口径:size-4 圆形、`data-checked` 主题色、可见焦点环。
 */
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
	return (
		<RadioGroupPrimitive
			data-slot="radio-group"
			className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}
			{...props}
		/>
	);
}

function Radio({ className, children, ...props }: RadioPrimitive.Root.Props) {
	return (
		<RadioPrimitive.Root
			data-slot="radio"
			className={cn(
				"flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:text-foreground",
				className,
			)}
			{...props}
		>
			{/*
			 * keepMounted 常驻:圆圈无论选中与否都占着同一个格子 —— Indicator 按需挂载会让
			 * 文字在选中瞬间左右跳动(ux 规则「Content Jumping」);选中态用指示器自己的
			 * `data-checked` 表达(描边与内点换主题色,尺寸不变,零位移)。
			 */}
			<RadioPrimitive.Indicator
				keepMounted
				data-slot="radio-indicator"
				className={cn(
					"flex size-4 shrink-0 items-center justify-center rounded-full border bg-background transition-colors outline-none",
					"border-border hover:border-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
					"data-checked:border-primary data-checked:bg-primary",
				)}
			>
				<span
					className={cn(
						"size-1.5 rounded-full bg-primary-foreground transition-transform",
						"data-checked:scale-100 scale-0",
					)}
				/>
			</RadioPrimitive.Indicator>
			{children}
		</RadioPrimitive.Root>
	);
}

export { RadioGroup, Radio };
