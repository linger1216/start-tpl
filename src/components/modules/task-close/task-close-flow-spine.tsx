import { ArrowRight, Check, Lock, TriangleAlert } from "lucide-react";

import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import type { WorkflowStatus } from "#/lib/task-close-spec";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/**
 * 流程脊 —— 这一页的**状态骨架**:把模板里的状态链横着铺开,标出「走过的 / 当前 / 未到」,
 * 走过的节点带首次到达时刻,当前节点在锁定期画成带锁的 `warn` 节点。
 *
 * ⚠️ **这里不放动作**。状态类按钮(发起审批 / 改状态)按用户要求留在**记录头右上角**的动作组里
 * (见 `task-close-detail-page.tsx` 与 `doc/task-close.md` 的「按钮去向」)—— 脊只回答「走到哪了」。
 * 同一个入口别在两处各握一半,否则人会来回找。
 */
export function TaskFlowSpine({
	statuses,
	current,
	visited,
	reachedAt,
	locked,
}: {
	statuses: WorkflowStatus[];
	current: string;
	/** 走过的状态(**不含**当前态) */
	visited: Set<string>;
	/** 状态 value → 首次到达时刻(ISO);给走过的节点当注脚 */
	reachedAt: Map<string, string>;
	/** 任务被未完成的审批动作锁住 —— 当前节点画成带锁的警示节点 */
	locked: boolean;
}) {
	return (
		<ol className="flex flex-wrap items-start gap-x-2 gap-y-3">
			{statuses.map((status, index) => {
				const isCurrent = status.value === current;
				const isVisited = !isCurrent && visited.has(status.value);
				const at = reachedAt.get(status.value);
				return (
					<li key={status.value} className="flex items-start gap-x-2">
						<span
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]",
								isCurrent
									? locked
										? "border-warn/40 bg-warn-soft font-semibold text-warn-fg"
										: "border-primary/40 bg-primary/5 font-semibold text-primary"
									: isVisited
										? "border-border text-muted-foreground"
										: "border-dashed border-border text-muted-foreground",
							)}
						>
							{isCurrent && locked ? (
								<Lock className="size-3 shrink-0" aria-hidden />
							) : isVisited ? (
								<Check className="size-3 shrink-0" aria-hidden />
							) : (
								<span
									aria-hidden
									className={cn("size-1.5 shrink-0 rounded-full", isCurrent ? "bg-current" : "bg-border")}
								/>
							)}
							{status.label}
							{at ? (
								<span className="text-[11px] tabular-nums text-muted-foreground">{formatLocalMinute(at)}</span>
							) : null}
						</span>
						{index < statuses.length - 1 ? (
							<ArrowRight className="mt-2 size-3.5 shrink-0 text-border" aria-hidden />
						) : null}
					</li>
				);
			})}
		</ol>
	);
}

/** 动作条里的一条待办 —— 文案由页面拼(页面才有状态 label) */
export type TodoItem = {
	id: string;
	/** 一句话,如「甲 发起 进行中 → 待核验」 */
	title: string;
	/** 「待答复」/「已发起」 */
	stateLabel: string;
	/** 只有「待答复」的能通过 / 驳回 */
	actionable: boolean;
};

/**
 * 「轮到你了」动作条 —— 横向一条,**逐条内联「通过 / 驳回」**。
 *
 * 这是闭环里最容易断的一环:发起审批会把任务锁住,必须有一个明确的、就在眼前的答复入口;
 * 原来那张卡片右下角只有一个不接任何事情的「去处理」,点下去等于没有。
 */
export function TaskTodoStrip({
	items,
	busy,
	onApprove,
	onReject,
}: {
	items: TodoItem[];
	busy: boolean;
	onApprove: (id: string) => void;
	onReject: (id: string) => void;
}) {
	if (items.length === 0) return null;
	return (
		<section className="grid gap-2 rounded-[10px] border border-warn/30 bg-warn-soft px-3.5 py-3">
			<div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold tracking-wide text-warn-fg">
				<TriangleAlert className="size-3.5 shrink-0" aria-hidden />
				轮到你了 · {items.length} 项
			</div>
			<ul className="grid gap-2">
				{items.map((item) => (
					<li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
						<span className="inline-flex items-center gap-1.5">
							<span
								className={cn(
									"inline-flex h-[18px] items-center rounded px-1.5 text-[11px] font-semibold",
									item.actionable ? "bg-warn-fg/10 text-warn-fg" : "bg-foreground/5 text-muted-foreground",
								)}
							>
								{item.stateLabel}
							</span>
							<span className="text-foreground">{item.title}</span>
						</span>
						{item.actionable ? (
							<span className="inline-flex items-center gap-2">
								<Button size="sm" disabled={busy} onClick={() => onApprove(item.id)}>
									通过
								</Button>
								<ActionButton tone="danger" disabled={busy} onClick={() => onReject(item.id)}>
									驳回
								</ActionButton>
							</span>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}
