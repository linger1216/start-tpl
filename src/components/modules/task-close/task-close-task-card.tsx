import { Link } from "@tanstack/react-router";
import { CalendarClock, ClipboardList, Network, User } from "lucide-react";
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
	/** 子任务数 —— >0 时点进去是「子任务卡片页」而不是详情页 */
	childCount: number;
};

/**
 * 任务卡片 —— 「我的任务」列表与「子任务卡片页」**同一张卡**(同类页面必须同形)。
 *
 * 点击目标由调用方决定(有子任务 → 卡片页,叶子 → 详情页),本组件只管长相。
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
			{/* 顶行:图标块(左) + 状态徽章(右) —— 与「流程模板」卡片同形 */}
			<div className="mb-4 flex items-start justify-between gap-2">
				<div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-primary">
					{task.childCount > 0 ? <Network className="size-4.5" /> : <ClipboardList className="size-4.5" />}
				</div>
				{/* 徽章顺序:优先级(分流)的最高频扫读 → 状态。优先级缺省时让出空间,不留空徽章 */}
				<div className="flex flex-wrap items-center justify-end gap-1.5">
					<Tag variant="secondary">{priorityLabelOf(task.priority)}</Tag>
					<Tag variant="outline">{statusLabel(task.status)}</Tag>
				</div>
			</div>
			<h3 className="mb-1 line-clamp-1 text-base font-semibold text-foreground">{task.name}</h3>
			<p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
				{task.description?.trim() || "（无描述）"}
			</p>
			<div className="mt-auto flex flex-wrap items-center gap-1.5">
				{task.childCount > 0 ? (
					<span className="inline-flex items-center gap-1 rounded-sm bg-brand-soft px-2 py-0.5 text-xs text-primary">
						<Network className="size-3" />
						{task.childCount} 个子任务
					</span>
				) : null}
				<span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
					<User className="size-3" />
					{task.creatorName ?? PLACEHOLDER_EMPTY}
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
 * 任务卡片的点击去向 —— **有子任务进子任务卡片页,只有叶子才进详情页**。
 *
 * 规则只写这一处:「我的任务」列表、子任务卡片页、详情页的「子任务」区都走它,免得各处判断漂移。
 */
export function TaskCardLink({
	task,
	className,
	children,
}: {
	task: { id: string; childCount: number };
	className?: string;
	children: ReactNode;
}) {
	const cls = cn("rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-ring/25", className);
	return task.childCount > 0 ? (
		<Link to="/task-close/$taskId/children" params={{ taskId: task.id }} className={cls}>
			{children}
		</Link>
	) : (
		<Link to="/task-close/$taskId" params={{ taskId: task.id }} className={cls}>
			{children}
		</Link>
	);
}
