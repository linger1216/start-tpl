import type * as React from "react";

import { cn } from "#/lib/utils";

/**
 * **行内警示 / 批注**(AntD 心智的 `Alert`,但形态走「公文·印鉴」§4.5 的批注语系):
 * 左侧 2px 竖线 + 版记小标(10px/0.05em) + 正文 —— **不是**填充色横幅。
 *
 * 语义与竖线色:
 *  - `info`    墨 —— 中性说明(默认)
 *  - `success` 墨绿 —— 通过类结论
 *  - `warn`    赭黄 —— 提醒(重复跳过、缓存未过期)
 *  - `danger`  印泥红 —— 驳回原因 / 不可逆后果预告
 *
 * 何时**不用**它:一次性的操作反馈(toast)、弹窗(ConfirmDialog/Dialog)、
 * 表单字段级错误(aria-invalid + 描述文字,不占一整个 Alert)。
 */

export type AlertVariant = "info" | "success" | "warn" | "danger";

const VARIANT: Record<AlertVariant, { line: string; title: string }> = {
	info: { line: "border-ink/45", title: "text-foreground" },
	success: { line: "border-success/55", title: "text-success-fg" },
	warn: { line: "border-warn/55", title: "text-warn-fg" },
	danger: { line: "border-seal/65", title: "text-seal-fg" },
};

export function Alert({
	variant = "info",
	title,
	children,
	className,
}: {
	variant?: AlertVariant;
	/** 版记小标(如「批注」「注意」);不传则只渲染正文 */
	title?: string;
	children: React.ReactNode;
	className?: string;
}) {
	const tone = VARIANT[variant];
	return (
		<div className={cn("border-l-2 pl-2.5", tone.line, className)}>
			{title ? (
				<span className={cn("block text-[10px] font-medium tracking-[0.05em]", tone.title)}>{title}</span>
			) : null}
			<div className={cn("text-sm leading-relaxed text-foreground", title && "mt-0.5")}>{children}</div>
		</div>
	);
}
