import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "#/lib/utils";

function Slider({ className, defaultValue, value, min = 0, max = 100, ...props }: SliderPrimitive.Root.Props) {
	const _values = Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max];

	return (
		<SliderPrimitive.Root
			className={cn("data-horizontal:w-full data-vertical:h-full", className)}
			data-slot="slider"
			defaultValue={defaultValue}
			value={value}
			min={min}
			max={max}
			thumbAlignment="edge"
			{...props}
		>
			<SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
				<SliderPrimitive.Track
					data-slot="slider-track"
					className="relative grow overflow-hidden rounded-full border border-border bg-muted-foreground/50 select-none data-horizontal:h-1.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-1.5"
				>
					<SliderPrimitive.Indicator
						data-slot="slider-range"
						className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
					/>
				</SliderPrimitive.Track>
				{_values.map((value, idx) => (
					<SliderPrimitive.Thumb
						data-slot="slider-thumb"
						key={`thumb-${idx}-${value}`}
						className="relative block size-4 shrink-0 rounded-full border-2 border-sky-500 bg-background shadow-sm
            ring-sky-500/40 transition-[color,box-shadow] select-none after:absolute after:-inset-2
            hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden active:ring-4 disabled:pointer-events-none
            disabled:opacity-50"
					/>
				))}
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	);
}

/** 把 base-ui Slider 回调值归一成 number(兼容 number | number[]) */
function sliderNumber(v: unknown): number {
	if (Array.isArray(v)) return Number(v[0] ?? 0);
	return Number(v ?? 0);
}

function RateSlider({
	value,
	onChange,
	label,
	className,
	disabled = false,
}: {
	value: number;
	onChange?: (v: number) => void;
	label: string;
	className?: string;
	disabled?: boolean;
}) {
	return (
		<div className={cn("flex items-center gap-2", disabled && "opacity-60", className)}>
			<span className="shrink-0 text-[11.5px] text-muted-foreground">{label}</span>
			<div className="w-28">
				<Slider
					value={value}
					min={0}
					max={100}
					step={5}
					disabled={disabled}
					onValueChange={(v) => {
						if (disabled) return;
						onChange?.(sliderNumber(v));
					}}
				/>
			</div>
			<span className="w-9 shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground">{value}%</span>
		</div>
	);
}

export { RateSlider, Slider, sliderNumber };
