import { ArrowRight, CircleCheck, CircleDot } from "lucide-react";
import { Fragment, useMemo } from "react";

import { logMovedStatus, logStatusLabel, type TaskLogItem } from "#/lib/task-close-log";
import type { WorkflowStatus } from "#/lib/task-close-spec";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

type Step = { key: string; value: string; at: string | null };

/**
 * 本任务的**状态时间线** —— 走到过哪些状态、分别是什么时候。
 *
 * 数据源是 `tc_log` 里 `to_status` 非空的行:创建任务的初始态 + 每次**直接改状态** + 每次审批的
 * 发起(任务被锁成 `pending`)与结算(通过 → 目标态 / 驳回 → 退回原态)。
 *
 * 这里以前是"拿 `tc_action` 反推"的近似做法:直接改状态(`via:"direct"`)**不留痕**,时间线上看不见。
 * 有了 `tc_log` 之后每一跳都有自己的行 —— 精确历史,不是近似。
 */
export function TaskStatusTimeline({
	logs,
	statuses,
	current,
}: {
	/** 活动日志(接口给的是时间倒序,这里自己翻正序) */
	logs: TaskLogItem[];
	statuses: WorkflowStatus[];
	/** 任务的当前状态 —— 日志被截断 / 缺行时兜底补最后一段 */
	current: string;
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

	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-2">
			{steps.map((step, index) => {
				const isCurrent = index === steps.length - 1;
				return (
					<Fragment key={step.key}>
						{/* 连接线 + 箭头头:`————▶` */}
						{index > 0 ? (
							<span aria-hidden className="flex items-center text-muted-foreground">
								<span className="h-px w-6 bg-border" />
								<ArrowRight className="-ml-1.5 size-3.5" />
							</span>
						) : null}
						<span className="inline-flex items-center gap-1.5">
							{isCurrent ? (
								<CircleDot className="size-4 shrink-0 text-primary" />
							) : (
								<CircleCheck className="size-4 shrink-0 text-hue-emerald-fg" />
							)}
							<span className={cn("text-sm", isCurrent ? "font-medium text-foreground" : "text-muted-foreground")}>
								{logStatusLabel(statuses, step.value)}
							</span>
							{step.at ? (
								<span className="text-xs tabular-nums text-muted-foreground/80">{formatLocalMinute(step.at)}</span>
							) : null}
						</span>
					</Fragment>
				);
			})}
		</div>
	);
}
