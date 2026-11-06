import type * as React from "react";
import { cn } from "#/lib/utils";

/**
 * Switch 开关(无第三方依赖,纯 Tailwind)。
 * 用法:<Switch checked={on} onCheckedChange={setOn} />
 */
export function Switch({
	checked,
	onCheckedChange,
	disabled,
	className,
	label,
	...props
}: Omit<React.ComponentProps<"button">, "onChange" | "onClick" | "role" | "type"> & {
	checked: boolean;
	onCheckedChange: (v: boolean) => void;
	disabled?: boolean;
	className?: string;
	/** 可选:开关右侧文字(与开关同排) */
	label?: string;
}) {
	return (
		<button
			{...props}
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onCheckedChange(!checked)}
			className={cn(
				"group inline-flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40",
				className,
			)}
		>
			<span
				data-slot="switch-track"
				className={cn(
					"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors duration-150 outline-none",
					checked ? "bg-primary" : "border-border-strong bg-muted",
				)}
			>
				<span
					data-slot="switch-thumb"
					className={cn(
						"pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-md transition-transform duration-150",
						checked ? "translate-x-4.5" : "translate-x-0.5",
					)}
				/>
			</span>
			{label && <span className="text-xs text-foreground">{label}</span>}
		</button>
	);
}
