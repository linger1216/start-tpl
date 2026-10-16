import { useId } from "react";

import { cn } from "#/lib/utils";

/**
 * **印章**(DESIGN.md「公文·印鉴」§4.4)—— 状态最终态的视觉签名。**只有圆形一种形态**。
 *
 * 两档尺寸(一个 `size` 属性说完):
 *  - `small`:14px 圆 chip —— 列表行内状态列(单字,无圆周文字);
 *  - `default`:72px 大圈 —— 详情页记录头右侧,圆周排文字,落定播盖章动效。
 *    (方章与 10px 脊档已删:邮戳感的方角/微旋只属于状态词本身,流程脊走过的节点
 *    直接用小圆点 span 表达 —— 2026-10 用户定稿。)
 *
 * - 不透明度 92%,`default` 档 -6° 微旋("盖上去"的感觉);
 * - `stamped` = 状态**最终落定**的那一次才传 → 播 `seal-stamp` 盖章动效;
 *   进行中(pending)只画章形,不播。
 * - 颜色语义:墨绿 = 通过系,印泥红 = 驳回 / 待批系,墨 = 关单 / 归档,灰 = 作废。
 *   它们是**图形**,与纯色的 danger / success 文字语义并存但形态不同。
 */

export type SealTone = "green" | "red" | "ink" | "gray";
export type SealSize = "small" | "default";

const TONE_CLASSES: Record<SealTone, { border: string; text: string; bg: string }> = {
	green: { border: "border-success/55", text: "text-success-fg", bg: "bg-success-soft/60" },
	red: { border: "border-seal/65", text: "text-seal-fg", bg: "bg-seal/5" },
	ink: { border: "border-ink/45", text: "text-foreground", bg: "bg-ink/5" },
	gray: { border: "border-muted-foreground/35", text: "text-muted-foreground", bg: "bg-muted" },
};

export function Seal({
	size = "small",
	tone = "ink",
	label,
	ring,
	date,
	stamped = false,
	className,
}: {
	size?: SealSize;
	tone?: SealTone;
	/** 中心状态词 */
	label: string;
	/** 圆周文字(仅 `size="default"`,如「任务闭环 · 2026-10-15」) */
	ring?: string;
	/** 日期(`size="default"`,中心词下) */
	date?: string;
	/** 状态落定 → 播盖章动效 */
	stamped?: boolean;
	className?: string;
}) {
	const toneCls = TONE_CLASSES[tone];
	const id = useId();

	/* small:14px 圆 chip(单字)+ 无环 —— 状态列的"迷你章" */
	if (size === "small") {
		return (
			<span
				aria-hidden
				className={cn(
					"inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none font-bold",
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

	/* default:72px 大圈(SVG textPath 圆周文字) */
	return (
		<span
			aria-hidden
			className={cn(
				"relative inline-grid size-18 shrink-0 select-none place-items-center rounded-full",
				stamped ? "seal-stamp" : "-rotate-6",
				toneCls.border,
				toneCls.text,
				toneCls.bg,
				"opacity-92",
				className,
			)}
			style={{ borderWidth: 2 }}
		>
			{ring ? (
				<svg viewBox="0 0 44 44" className="absolute inset-0 size-full">
					<defs>
						<path id={id} d="M22,22 m-16.5,0 a16.5,16.5 0 1,1 33,0 a16.5,16.5 0 1,1 -33,0" fill="none" />
					</defs>
					<text fontSize="5.5" letterSpacing="1.2" fill="currentColor" className="font-semibold">
						<textPath href={`#${id}`}>{ring}</textPath>
					</text>
				</svg>
			) : null}
			<span className="grid place-items-center pt-0.5">
				<span className="font-heading text-[11px] leading-none font-bold">{label}</span>
				{date ? <span className="mt-0.5 text-[6.5px] leading-none tabular-nums">{date}</span> : null}
			</span>
		</span>
	);
}
