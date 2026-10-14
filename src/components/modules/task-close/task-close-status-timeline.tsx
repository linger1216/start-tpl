import { ArrowRight } from "lucide-react";
import { useMemo } from "react";

import { logMovedStatus, logStatusLabel, type TaskLogItem } from "#/lib/task-close-log";
import type { WorkflowStatus } from "#/lib/task-close-spec";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

type Step = { key: string; value: string; at: string | null };

/**
 * 本任务的**状态时间线**(竖向版,右栏「流程动态」用) —— 走到过哪些状态、分别是什么时候。
 *
 * 数据源是 `tc_log` 里 `to_status` 非空的行:创建任务的初始态 + 每次**直接改状态** + 每次审批的
 * 发起(任务被锁成 `pending`)与结算(通过 → 目标态 / 驳回 → 退回原态)。
 *
 * 视觉与新详情页原型 `flow` 时间轴对齐:left 一根贯穿竖线 + 每个 step 一个圆点 + 右侧文字。
 * 当前态走实心蓝点;走过的走绿勾;起点走空心。
 */
export function TaskStatusTimeline({
	logs,
	statuses,
	current,
	className,
}: {
	/** 活动日志(接口给的是时间倒序,这里自己翻正序) */
	logs: TaskLogItem[];
	statuses: WorkflowStatus[];
	/** 任务的当前状态 —— 日志被截断 / 缺行时兜底补最后一段 */
	current: string;
	className?: string;
}) {
	const steps = useMemo<Step[]>(() => {
		const out: Step[] = [];
		for (const item of [...logs].reverse()) {
			if (!logMovedStatus(item) || !item.toStatus) continue;
			// 连续落在同一个状态只留一跳(驳回后又发起的场景会出现 pending→open→pending)
			if (out[out.length - 1]?.value === item.toStatus) continue;
			out.push({ key: item.id, value: item.toStatus, at: item.createdAt });
		}
		if (out[out.length - 1]?.value !== current) out.push({ key: "current", value: current, at: null });
		// 兜底:值取不到 label 也至少显示 value 本身(否则会出现一个空白节点);真空值才丢掉
		return out.filter((step) => logStatusLabel(statuses, step.value).trim().length > 0);
	}, [logs, statuses, current]);

	if (steps.length === 0) return null;

	return (
		<ol className={cn("relative ms-2.5 space-y-2", className)}>
			{/* 贯穿竖线:首项 12px 起,末项前 12px 止,留出节点空间 */}
			<span aria-hidden className="pointer-events-none absolute start-[7px] top-3 bottom-3 w-px bg-border" />
			{steps.map((step, index) => {
				const isCurrent = index === steps.length - 1;
				const isStart = index === 0 && !isCurrent && !step.at;
				return (
					<li key={step.key} className="relative flex items-start gap-2.5 ps-7">
						{/* 节点:当前=蓝实心 / 走过的=绿勾 / 起点=空心 */}
						<span
							className={cn(
								"absolute start-0 mt-0.5 flex size-5 items-center justify-center rounded-full text-[11px] font-bold ring-4 ring-card shadow-[0_0_0_1.5px_var(--color-background)]",
								isCurrent
									? "bg-primary text-primary-foreground shadow-[0_0_0_5px_rgba(27,97,201,0.18)]"
									: isStart
										? "border border-muted-foreground/50 bg-card text-muted-foreground"
										: "bg-success text-success-foreground",
							)}
							aria-hidden
						>
							{!isCurrent && !isStart ? "✓" : null}
						</span>
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline justify-between gap-2 text-sm">
								<span className={cn("font-medium", isCurrent ? "text-foreground" : "text-foreground")}>
									{logStatusLabel(statuses, step.value)}
								</span>
								{step.at ? (
									<span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
										{formatLocalMinute(step.at)}
									</span>
								) : (
									<span className="shrink-0 text-[11.5px] text-muted-foreground">现在</span>
								)}
							</div>
							{step.key === "current" ? (
								<div className="mt-0.5 text-[11.5px] text-muted-foreground">
									{steps[steps.length - 2] ? "→ 当前状态" : ""}
								</div>
							) : null}
						</div>
					</li>
				);
			})}
		</ol>
	);
}

/** 顶部"→"装饰:右栏 block head 右侧偶尔需要的导流 */
export function _StepArrow({ className }: { className?: string }) {
	return <ArrowRight className={cn("size-3.5", className)} />;
}
