import type { LucideIcon } from "lucide-react";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";

/**
 * 站内通知的**级别词表(唯一真源,客户端可引)**。
 *
 * 为什么单独一个文件:发送侧 `lib/notice.ts` 引了 server-only 的数据库模块(`db`),
 * 客户端组件一旦从它引级别词表,就会把 drizzle 拖进浏览器包 —— 于是以前
 * 铃铛 / 发通知表单 / 通知台账各自重声明了一份级别,一改就得改三处。
 * 这里**不 import 任何 server-only 模块**(只引 `lucide-react` 的图标,那是纯客户端展示件),
 * 所以谁都能引;级别要加要改,只改这一个数组。
 *
 * ⚠️ 两套标签是**两个不同的串**,不要合并:
 *  · `label`      —— 表单下拉里的长标签(带一句解释);
 *  · `shortLabel` —— 台账表格里的短标签。
 */

/** 级别清单 —— **顺序即展示顺序**(表单下拉按这个顺序渲染) */
export const NOTICE_LEVELS = [
	{
		value: "info",
		/** 表单下拉用的长标签 */
		label: "通知 —— 中性提示",
		/** 表格用的短标签 */
		shortLabel: "通知",
		Icon: Info,
		tone: "text-muted-foreground",
	},
	{
		value: "success",
		label: "成功 —— 完成了什么",
		shortLabel: "成功",
		Icon: CircleCheck,
		tone: "text-success",
	},
	{
		value: "warn",
		label: "提醒 —— 需要留意",
		shortLabel: "提醒",
		Icon: TriangleAlert,
		tone: "text-warn",
	},
	{
		value: "danger",
		label: "告警 —— 出问题了",
		shortLabel: "告警",
		Icon: CircleX,
		tone: "text-danger",
	},
] as const satisfies readonly { value: string; label: string; shortLabel: string; Icon: LucideIcon; tone: string }[];

export type NoticeLevel = (typeof NOTICE_LEVELS)[number]["value"];

/** 级别 → 表格短标签。`Record<string, string>` 是有意的:认不出的级别由调用方回落到原始值 */
export const NOTICE_LEVEL_SHORT_LABEL: Record<string, string> = Object.fromEntries(
	NOTICE_LEVELS.map((level) => [level.value, level.shortLabel]),
);

/** 级别 → 图标 / 颜色(铃铛用)。认不出的级别(含 `null`)回落到 `info` */
export function noticeLevelStyle(level?: string | null): { Icon: LucideIcon; tone: string } {
	return NOTICE_LEVELS.find((item) => item.value === level) ?? NOTICE_LEVELS[0];
}
