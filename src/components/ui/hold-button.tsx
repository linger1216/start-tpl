import type { VariantProps } from "class-variance-authority";
import { useCallback, useEffect, useRef, useState } from "react";

import { buttonVariants } from "#/components/ui/button";
import { cn } from "#/lib/utils";

/**
 * 长按执行按钮 —— **按住不放**到进度走满才触发,中途松手 / 移出 / 按 Esc 即取消。
 *
 * 用在哪:不可逆、又不想弹二次确认框的动作(清空数据、重置配置、强制下线…)。
 * 相比 `ConfirmDialog` 的好处是不打断操作流;相比单击按钮的好处是**防误触** ——
 * 手滑点到不会执行。
 *
 * 交互纪律:
 *  - 鼠标 / 触摸:`pointerdown` 开始,`pointerup` / `pointerleave` / `pointercancel` 取消;
 *  - 键盘:`Enter` / `Space` **按住**同样走满进度(不牺牲可访问性),`keyup` 取消;
 *  - 进度写进 DOM(不通过 state),900ms 内不产生重渲染;结束时**只触发一次**;
 *  - `duration` 默认 900ms:短于 700ms 防不住误触,长于 1.5s 用户会以为卡住。
 *
 * 用法:
 * ```tsx
 * <HoldButton variant="destructive" onHold={clearAll} holdingLabel="松手取消…">
 *   <Trash2 /> 清空全部
 * </HoldButton>
 * ```
 */
const FILL_BG: Record<string, string> = {
	default: "bg-primary-foreground/25",
	destructive: "bg-destructive/20",
	outline: "bg-hue-blue-soft",
	secondary: "bg-primary/10",
	ghost: "bg-primary/10",
	link: "bg-primary/10",
};

export function HoldButton({
	onHold,
	duration = 900,
	holdingLabel,
	children,
	className,
	variant = "outline",
	size = "sm",
	disabled,
	...props
}: Omit<React.ComponentProps<"button">, "onClick"> &
	VariantProps<typeof buttonVariants> & {
		/** 进度走满时执行 —— 只调一次 */
		onHold: () => void;
		/** 按住多久算数(ms) */
		duration?: number;
		/** 按住期间替换的文案(如「松手取消…」);不传则保持原文案 */
		holdingLabel?: string;
	}) {
	const fillRef = useRef<HTMLSpanElement>(null);
	const rafRef = useRef<number | null>(null);
	const startedAtRef = useRef(0);
	const [holding, setHolding] = useState(false);

	const stop = useCallback((resetFill: boolean) => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		if (resetFill && fillRef.current) fillRef.current.style.width = "0%";
		setHolding(false);
	}, []);

	const start = useCallback(() => {
		if (disabled || rafRef.current !== null) return;
		startedAtRef.current = performance.now();
		setHolding(true);

		const tick = (now: number) => {
			const ratio = Math.min(1, (now - startedAtRef.current) / duration);
			if (fillRef.current) fillRef.current.style.width = `${ratio * 100}%`;
			if (ratio >= 1) {
				// 先落定视觉再回调:回调里可能卸载本组件或打开弹窗
				rafRef.current = null;
				setHolding(false);
				if (fillRef.current) fillRef.current.style.width = "0%";
				onHold();
				return;
			}
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);
	}, [disabled, duration, onHold]);

	// 卸载时收掉未走完的 rAF(此时元素已不在,不再碰 DOM)
	useEffect(() => () => stop(false), [stop]);

	/** 键盘按住:忽略系统自动重复(keydown 会连发),只认第一次 */
	const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		if (!event.repeat) start();
	};
	const onKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "Enter" || event.key === " ") stop(true);
	};

	return (
		<button
			type="button"
			data-slot="hold-button"
			data-holding={holding ? "" : undefined}
			disabled={disabled}
			className={cn(
				// 内容压住进度条;overflow-hidden 让进度条被圆角裁住(不改按钮本身外观)
				buttonVariants({ variant, size, className }),
				"relative overflow-hidden",
			)}
			onPointerDown={start}
			onPointerUp={() => stop(true)}
			onPointerLeave={() => stop(true)}
			onPointerCancel={() => stop(true)}
			onKeyDown={onKeyDown}
			onKeyUp={onKeyUp}
			// 松开鼠标会补一个 click;长按类按钮不该在 click 上做任何事 —— 这里显式吞掉,
			// 免得将来有人在调用点顺手加 onClick(violates 长按语义)
			onClick={(event) => event.preventDefault()}
			{...props}
		>
			{/* 进度条:宽度由 rAF 直接写 DOM(不经 state),90fps 也不带动 React 重渲染 */}
			<span
				ref={fillRef}
				aria-hidden
				className={cn("pointer-events-none absolute inset-y-0 left-0 w-0", FILL_BG[variant ?? "outline"])}
			/>
			<span className="relative z-10 inline-flex items-center gap-1.5">
				{holding && holdingLabel ? holdingLabel : children}
			</span>
			{/* 屏幕阅读器提示:视觉上不要,但要让读屏用户知道这是长按 */}
			<span className="sr-only">(需按住 {Math.round(duration / 100) / 10} 秒执行)</span>
		</button>
	);
}
