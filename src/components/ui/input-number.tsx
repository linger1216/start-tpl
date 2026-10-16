import { Input } from "#/components/ui/input";
/**
 * 数字输入控件 —— 业务无关通用组件。
 * 受控;空串回退到 min;输入自动 clamp 到 [min, max]。
 */
import { cn } from "#/lib/utils";

export function InputNumber({
	value,
	onChange,
	min,
	max,
	className,
	disabled = false,
}: {
	value: number;
	onChange: (v: number) => void;
	min: number;
	max: number;
	className?: string;
	disabled?: boolean;
}) {
	return (
		<Input
			type="number"
			value={Number.isFinite(value) ? value : ""}
			onChange={(e) => {
				if (disabled) return;
				const raw = e.target.value;
				if (raw === "") {
					onChange(min);
					return;
				}
				const n = Number(raw);
				if (Number.isNaN(n)) return;
				onChange(Math.max(min, Math.min(max, Math.round(n))));
			}}
			min={min}
			max={max}
			disabled={disabled}
			className={cn("h-7 w-16 px-2 text-xs tabular-nums", className)}
		/>
	);
}
