/**
 * 字段行:标签 + 值(左固定宽标签,右自动换行内容)。
 *
 * **详情弹窗与编辑表单的字段都用它** —— 别自己写 `<div className="space-y-1"><Label/>…</div>`:
 * 那种写法每处都在重复"标签宽度 / 对齐 / 最小宽度 / 换行",而 `min-w-0` 一漏,超长内容就会把弹窗撑宽
 * (见 AGENTS「已知难题 ▸ 弹窗被超长内容撑宽」)。
 *
 * - `label` 收 `ReactNode`:标签里带一句灰色提示(「标识 · 全库唯一」)也走它,不用另起一行;
 * - `htmlFor` 给**表单**用 —— 详情是只读的,给了也没坏处,不给就是纯展示标签;
 * - `hint` = 控件下的**说明行**(12px 灰) —— 过去 40 处手抄 `<p className="text-xs text-muted-foreground">`
 *   的统一落点;错误态不走它(错误是 `role="alert"` 的红字,不是说明)。
 */
import type * as React from "react";

import { Label } from "#/components/ui/label";

export function DetailRow({
	label,
	htmlFor,
	hint,
	children,
	align = "start",
}: {
	label: React.ReactNode;
	/** 表单里指到控件 id,点标签能聚焦(详情弹窗不用给) */
	htmlFor?: string;
	/** 控件下的说明行(灰 12px);错误提示别走它 */
	hint?: React.ReactNode;
	children: React.ReactNode;
	/** 标签与内容的竖直对齐:详情多行内容用 `start`(默认);单行控件(表单)用 `center` 更齐 */
	align?: "start" | "center";
}) {
	return (
		<div className={`flex gap-3 py-2 ${align === "center" ? "items-center" : "items-start"}`}>
			<Label htmlFor={htmlFor} className="w-25 shrink-0 text-xs font-normal leading-5 text-muted-foreground">
				{label}
			</Label>
			<div className="min-w-0 flex-1 text-sm leading-5 wrap-break-word text-foreground">
				{children}
				{hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
			</div>
		</div>
	);
}
