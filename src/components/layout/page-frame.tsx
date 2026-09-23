import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

/**
 * 页面根容器 —— **把主区剩下的高度占满**,让"主体"(表格 / 树)在里面滚,
 * 而不是整页越滚越长。列表页的高矮因此一致:3 行数据也是满屏,300 行也是满屏。
 *
 * 为什么高度要一路传下来:CSS 里"占满剩下的高度"只能靠 flex 链,中间断一环就退回内容高度。
 * 完整链条(改布局前先读这一条):
 *
 * ```
 * sidebar-provider 的 <main>   h-screen 内 `flex min-h-0 flex-1 flex-col overflow-hidden`
 *   └ PageTransition           `flex min-h-0 flex-1 flex-col overflow-y-auto` ← 只给非列表页兜底
 *       └ PageFrame(本组件)     `flex min-h-0 flex-1 flex-col` ← **必须 min-h-0**(见下)
 *           └ 主体卡片 Card      `flex flex-1 flex-col overflow-visible`  ← 吃掉剩余高度
 *               └ CardContent    `flex flex-1 flex-col`                  ← 再往下传
 *                   └ 滚动区      `flex-1` + **一个下限**(TableLoadingShell `fill` / SortableTree)
 *
 * ⚠️ **`PageFrame` 与栅格必须有 `min-h-0`**:没有它,flex 项的"自动最小高度"会一路等于内容高度,
 * 于是页面根自己涨到内容那么高(实测:标签页 4926px),里面的滚动区永远等不到滚动条。
 * 而**卡片**反过来不能 `min-h-0`(要 `overflow-visible`),这样它的下限才是内容高度。
 *
 * ⚠️ 另一条反直觉的,下限也不要靠 `min-h-0` 的对面猜:`Card` 自带 `overflow-hidden`,
 * 而"`overflow` 不是 visible 的 flex 项,自动最小高度就是 0"—— 所以卡片会被一路压扁、
 * 里面的表格被裁掉且滚不到(实测踩过:380px 视口下卡片只剩 42px,表格 383px 全在框外)。
 * 正确做法是给**滚动区一个明确下限**(表格 240px、树 10rem),下限之上由 flex 撑满、
 * 装不下就退化成整页滚动 —— 这也是为什么卡片要 `overflow-visible`(去掉后它的最小高度回到内容高度)。
 * ```
 *
 * 页头 / 统计卡是自然高度,不要给它们 `flex-1`;对话框与确认框不受影响(它们是 portal)。
 */
export function PageFrame({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("flex min-h-0 flex-1 flex-col gap-4", className)}>{children}</div>;
}
