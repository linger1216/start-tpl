/**
 * 详情字段行:标签 + 值(左固定宽标签,右自动换行内容)。
 * 各 *-detail 弹窗通用,统一从这里 import,避免 6 处重复定义。
 */
import type * as React from "react";

import { Label } from "#/components/ui/label";

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[100px_1fr] items-start gap-3 py-2">
			<Label className="text-[12px] font-normal text-muted-foreground">{label}</Label>
			<div className="min-w-0 wrap-break-words text-[13px] text-foreground">{children}</div>
		</div>
	);
}
