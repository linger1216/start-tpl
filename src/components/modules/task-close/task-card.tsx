import { Link } from "@tanstack/react-router";
import { BellRing, CalendarClock, ClipboardList, Network, User } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Card } from "#/components/ui/card";
import { Tag } from "#/components/ui/tag.tsx";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { priorityLabelOf, taskDeadlineState } from "#/lib/task/close-spec";
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
	/** 发给谁(执行人)—— fan-out 的子任务一人一条,没这个就看不出是谁的活 */
	executorId?: string | null;
	executorName?: string | null;
};

/**
 * 任务卡片 —— 「我的任务」列表与详情页「子任务」区**同一张卡**(同类页面必须同形)。
 *
 * 内部布局按"扫读顺序"排:
 *   ① 标题(为主)+ 右上角执行人(发给谁)  ② 状态 / 优先级 / 待你处理(到什么程度)
 *   ③ 描述(两行封顶)  ④ 底部一条细脚注:子任务数 / 创建人 / 截止或建于
 *
 * fan-out 的父任务是「分派容器」,没有唯一收件人 → 右上角退回类型图标块。
 * 点击去向由调用方(`TaskCardLink`)决定,本组件只管长相。
 */
export function TaskCard({ task, statusLabel }: { task: TaskCardItem; statusLabel: (value: string) => string }) {
	// 首次渲染保持服务端和客户端一致，挂载后再按本机时钟计算并定期刷新。
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		if (!task.dueAt) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, [task.dueAt]);
	const deadline = now === null ? null : taskDeadlineState(task.dueAt, now);
	return (
		<Card className="group flex h-full cursor-pointer flex-col gap-0 bg-card p-4 transition-[border-color] hover:border-primary/50">
			{/* 第一行:**标题为主**(最多两行)+ 右侧执行人(圆牌 + 姓名,放不下就截断) */}
			<div className="flex items-start justify-between gap-3">
				<h3 className="min-w-0 flex-1 line-clamp-2 text-lg leading-snug font-semibold text-foreground">{task.name}</h3>
				{task.executorName ? (
					<span className="flex shrink-0 items-center gap-1.5" title={`执行人:${task.executorName}`}>
						{/* 「人」的视觉身份 = 墨底正圆 + 反白首字 + 宋体(见 DESIGN.md §4.4);比标题小一号,不抢主 */}
						<span
							aria-hidden
							className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/85 font-heading text-[11px] font-bold leading-none text-paper"
						>
							{task.executorName.slice(0, 1)}
						</span>
						<span className="max-w-20 truncate text-xs text-muted-foreground">{task.executorName}</span>
					</span>
				) : (
					/* 没有执行人 = 待分派 / 分派容器:只出类型图标,不占文字位 */
					<span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-soft text-primary">
						{task.childCount > 0 ? <Network className="size-3.5" /> : <ClipboardList className="size-3.5" />}
					</span>
				)}
			</div>

			{/* 第二行:状态成组 —— 状态(主扫读)+ 优先级(分流)+「待你处理」告警 */}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Tag variant="outline">{statusLabel(task.status)}</Tag>
				<Tag variant="random" hashKey={`p${task.priority ?? "x"}`}>
					{priorityLabelOf(task.priority)}
				</Tag>
				{deadline ? (
					<Tag
						variant="outline"
						className={
							deadline === "overdue"
								? "border-transparent bg-danger-soft text-danger-fg"
								: "border-transparent bg-warn-soft text-warn-fg"
						}
					>
						{deadline === "overdue" ? "超期" : "临期"}
					</Tag>
				) : null}
				{task.hasMyAction ? (
					<span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
						<BellRing className="size-3" />
						待你处理
					</span>
				) : null}
			</div>

			{/* 第三行:描述(两行封顶,弱化成辅助信息) */}
			<p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
				{task.description?.trim() || "（无描述）"}
			</p>

			{/* 底行:元信息压成一条细脚注 —— 子任务数 / 创建人 / 截止(或建于) */}
			<div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
				{task.childCount > 0 ? (
					<span className="inline-flex items-center gap-1 text-primary">
						<Network className="size-3" />
						{task.childCount} 个子任务
					</span>
				) : null}
				<span className="inline-flex min-w-0 items-center gap-1">
					<User className="size-3 shrink-0" />
					<span className="truncate">{task.creatorName ?? PLACEHOLDER_EMPTY}</span>
				</span>
				<span className="inline-flex items-center gap-1">
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
