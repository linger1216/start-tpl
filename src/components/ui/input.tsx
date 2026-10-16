import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "#/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"h-9 w-full min-w-0 rounded-md border border-input bg-card px-3.5 py-1.5 text-sm text-foreground transition-colors outline-none hover:border-border-strong " +
					"file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground " +
					"placeholder:text-muted-foreground " +
					// 悬停:边框加深一档;焦点:1px 主题色细环(无阴影堆叠,DESIGN.md §4.3)
					"focus:border-primary/60 focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-primary/20 " +
					"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 " +
					"aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
