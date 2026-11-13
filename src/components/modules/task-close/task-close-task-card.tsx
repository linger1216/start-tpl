import { Link } from "@tanstack/react-router";
import { BellRing, CalendarClock, ClipboardList, Network } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "#/components/ui/card";
import { Tag } from "#/components/ui/tag.tsx";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { priorityLabelOf } from "#/lib/task-close-spec";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/** 卡片要用的任务字段 —— `taskList` 的行与 `taskGet.children` 的行同形 */
export type TaskCardItem = {
	id: string;
	name: string;
	description: string | null;
	status: string;
	priority: number | null;
	creatorName: string | null;
	dueAt: string | null;
	createdAt: string | null;
	/** 子任务数 —— >0 时卡片上标「N 个子任务」(子任务在详情页里看) */
	childCount: number;
	/** 有审批 / 征询正轮到我处理 —— 列表卡右上角出「待你处理」 */
	hasMyAction?: boolean;
	/** 发给谁(执行人姓名)—— fan-out 的子任务一人一条,没这个就看不出是谁的活 */
	executorName?: string | null;
};

/**
 * 任务卡片 —— 「我的任务」列表与「子任务卡片页」**同一张卡**(同类页面必须同形)。
 *
 * 点击目标由调用方决定(有子任务 → 卡片页,叶子 → 详情页),本组件只管长相。
 *
 * 卡顶左格是**发件抬头**:这张卡是发给谁的 —— 执行人(圆牌 + 姓名,公文的收件抬头)。
 * fan-out 的父任务是一个「分派容器」,没有唯一收件人 → 退回原来的类型图标块。
 */
export function TaskCloseTaskCard({
	task,
	statusLabel,
}: {
	task: TaskCardItem;
	statusLabel: (value: string) => string;
}) {
	return (
		<Card className="group flex h-full cursor-pointer flex-col gap-0 bg-card p-5 transition-[border-color] hover:border-primary/50">
			{/* 顶行:抬头(左)+ 状态徽章(右) —— 与「流程模板」卡片同形 */}
			<div className="mb-4 flex items-start justify-between gap-2">
				{task.executorName ? (
					<span className="flex min-w-0 items-center gap-2">
						{/* 「人」的视觉身份 = 墨底正圆 + 反白首字 + 宋体(见 DESIGN.md §4.4) */}
						<span
							aria-hidden
							className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/85 text-[13px] font-heading font-bold leading-none text-paper"
						>
							{task.executorName.slice(0, 1)}
						</span>
						<span className="shrink-0 text-xs text-muted-foreground">执行人</span>
						<span className="min-w-0 truncate text-sm font-medium text-foreground">{task.executorName}</span>
					</span>
				) : (
					/* 没有执行人 = 一条待分派 / 分派容器的活 —— 只出类型图标块 */
					<div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-primary">
						{task.childCount > 0 ? <Network className="size-4.5" /> : <ClipboardList className="size-4.5" />}
					</div>
				)}
				{/* 徽章顺序:优先级(分流)的最高频扫读 → 状态。优先级缺省时让出空间,不留空徽章 */}
				<div className="flex flex-wrap items-center justify-end gap-1.5">
					{/* 优先级章按值取色(DESIGN.md §5.6:卡片 / 台账行走 random 值哈希)—— 与详情页同色 */}
					<Tag variant="random" hashKey={`p${task.priority ?? "x"}`}>
						{priorityLabelOf(task.priority)}
					</Tag>
					<Tag variant="outline">{statusLabel(task.status)}</Tag>
				</div>
			</div>
			<h3 className="mb-1 line-clamp-1 text-base font-semibold text-foreground">{task.name}</h3>
			<p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
				{task.description?.trim() || "（无描述）"}
			</p>
			<div className="mt-auto flex flex-wrap items-center gap-1.5">
				{task.hasMyAction ? (
					<span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
						<BellRing className="size-3" />
						待你处理
					</span>
				) : null}
				{task.childCount > 0 ? (
					<span className="inline-flex items-center gap-1 rounded-sm bg-brand-soft px-2 py-0.5 text-xs text-primary">
						<Network className="size-3" />
						{task.childCount} 个子任务
					</span>
				) : null}
				{/* 创建人 —— 顶行已有「执行人」,这里必须带字,否则两个名字看不出谁是谁 */}
				<span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
					创建 {task.creatorName ?? PLACEHOLDER_EMPTY}
				</span>
				<span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
					<CalendarClock className="size-3" />
					{task.dueAt ? `截止 ${formatLocalMinute(task.dueAt)}` : `建于 ${formatLocalMinute(task.createdAt)}`}
				</span>
			</div>
		</Card>
	);
}

/**
 * 任务卡片的点击去向 —— **一律进详情页**(子任务就在详情页的「子任务」区里,不再单开一层卡片页)。
 *
 * 规则只写这一处:「我的任务」列表与详情页的「子任务」区都走它,免得各处判断漂移。
 */
export function TaskCardLink({
	task,
	className,
	children,
}: {
	task: { id: string };
	className?: string;
	children: ReactNode;
}) {
	return (
		<Link
			to="/task-close/$taskId"
			params={{ taskId: task.id }}
			className={cn("rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40", className)}
		>
			{children}
		</Link>
	);
}
