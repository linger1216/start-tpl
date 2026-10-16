import { useId } from "react";

import { cn } from "#/lib/utils";

/**
 * **印章**(DESIGN.md「公文·印鉴」§4.4)—— 状态最终态的视觉签名。
 *
 * 形态两枚:**圆章**(通过 / 完成 / 已关闭,墨绿)与**方章**(驳回 / 待审批,印泥红);
 * 尺寸三档:**列表档**(14px 方 chip,状态列)、**详情档**(44px,记录头右侧,圆周排文字)、
 * **脊档**(10px 方点,流程脊已完成节点)。
 *
 * - 不透明度 92%,详情档默认 -6° 微旋("盖上去"的感觉);
 * - `stamped` = 状态**最终落定**的那一次才传 → 播 `seal-stamp` 盖章动效;
 *   进行中(pending)只画章形,不播。
 * - 颜色语义:墨绿 = 通过系,印泥红 = 驳回 / 待批系,墨 = 关单 / 归档,灰 = 作废。
 *   它们是**图形**,与纯色的 danger / success 文字语义并存但形态不同。
 */

export type SealTone = "green" | "red" | "ink" | "gray";
export type SealSize = "list" | "detail" | "spine";

const TONE_CLASSES: Record<SealTone, { border: string; text: string; bg: string }> = {
	green: { border: "border-success/55", text: "text-success-fg", bg: "bg-success-soft/60" },
	red: { border: "border-seal/65", text: "text-seal-fg", bg: "bg-seal/5" },
	ink: { border: "border-ink/45", text: "text-foreground", bg: "bg-ink/5" },
	gray: { border: "border-muted-foreground/35", text: "text-muted-foreground", bg: "bg-muted" },
};

export function Seal({
	shape = "circle",
	size = "list",
	tone = "ink",
	label,
	ring,
	date,
	stamped = false,
	className,
}: {
	shape?: "circle" | "rect";
	size?: "list" | "detail" | "spine";
	tone?: SealTone;
	/** 中心状态词 */
	label: string;
	/** 圆周文字(仅详情档圆章,如「任务闭环 · 2026-10-15」) */
	ring?: string;
	/** 日期(详情档,中心词下) */
	date?: string;
	/** 状态落定 → 播盖章动效 */
	stamped?: boolean;
	className?: string;
}) {
	const toneCls = TONE_CLASSES[tone];
	const id = useId();

	/* 列表档:14px 方 chip(单字)+ 无环 —— 状态列的"迷你章" */
	if (size === "list") {
		return (
			<span
				aria-hidden
				className={cn(
					"inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border text-[9px] leading-none font-bold",
					toneCls.border,
					toneCls.text,
					toneCls.bg,
					className,
				)}
			>
				{label.slice(0, 1)}
			</span>
		);
	}

	/* 脊档:10px 方点 —— 流程脊已完成节点 */
	if (size === "spine") {
		return (
			<span
				aria-hidden
				className={cn(
					"inline-block size-2.5 shrink-0 rounded-[2px] border-[1.5px]",
					toneCls.border,
					toneCls.bg,
					className,
				)}
			/>
		);
	}

	/* 详情档:44px,圆章(SVG textPath 圆周文字)或方章 */
	const isCircle = shape === "circle";
	return (
		<span
			aria-hidden
			className={cn(
				"relative inline-grid size-11 shrink-0 select-none place-items-center",
				isCircle ? "rounded-full" : "rounded-[4px]",
				stamped ? "seal-stamp" : isCircle ? "-rotate-6" : "-rotate-3",
				toneCls.border,
				toneCls.text,
				toneCls.bg,
				"opacity-92",
				className,
			)}
			style={{ borderWidth: isCircle ? 2 : 1.5 }}
		>
			{isCircle && ring ? (
				<svg viewBox="0 0 44 44" className="absolute inset-0 size-full">
					<defs>
						<path id={id} d="M22,22 m-16.5,0 a16.5,16.5 0 1,1 33,0 a16.5,16.5 0 1,1 -33,0" fill="none" />
					</defs>
					<text fontSize="5.5" letterSpacing="1.2" fill="currentColor" className="font-semibold">
						<textPath href={`#${id}`}>{ring}</textPath>
					</text>
				</svg>
			) : null}
			<span className={cn("grid place-items-center", isCircle && "pt-0.5")}>
				<span className={cn("font-heading text-[11px] leading-none font-bold", isCircle && "text-[10px]")}>
					{label}
				</span>
				{date ? <span className="mt-0.5 text-[6.5px] leading-none tabular-nums">{date}</span> : null}
			</span>
		</span>
	);
}
