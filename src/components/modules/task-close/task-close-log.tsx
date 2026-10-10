import type { LucideIcon } from "lucide-react";
import {
	ArrowRightLeft,
	CheckCheck,
	FilePlus2,
	FileQuestion,
	MessageSquare,
	MessageSquareX,
	Pencil,
	Send,
	Trash2,
	UserMinus,
	UserPlus,
} from "lucide-react";

import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import {
	describeLog,
	logCategoryOf,
	logStatusLabel,
	type TaskLogCategory,
	type TaskLogItem,
} from "#/lib/task-close-log";
import type { WorkflowStatus } from "#/lib/task-close-spec";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/**
 * 事件 → 图标。**与 `lib/task-close-log.ts` 的事件码一一对应** ——
 * 加事件要同时改:那边的事件联合 + `detail` 类型,这里一条,`doc/task-close.md` 那张表。
 */
const TASK_LOG_ICON: Record<string, LucideIcon> = {
	"task.create": FilePlus2,
	"task.update": Pencil,
	"task.remove": Trash2,
	"task.transit": ArrowRightLeft,
	"action.create": Send,
	"action.respond": CheckCheck,
	"comment.create": MessageSquare,
	"comment.remove": MessageSquareX,
	"member.add": UserPlus,
	"member.remove": UserMinus,
};

/**
 * 事件类别 → 图标底色(点缀色:任务=蓝 / 动作=紫 / 评论=中性 / 成员=青)。
 * 这几个色相在同一屏里不超过 4 个,且**颜色只做辅助** —— 每行都有文字标签,不靠颜色表意。
 */
const CATEGORY_TONE: Record<TaskLogCategory, string> = {
	task: "bg-hue-blue-soft text-hue-blue-fg",
	action: "bg-hue-violet-soft text-hue-violet-fg",
	comment: "bg-secondary text-muted-foreground",
	member: "bg-hue-teal-soft text-hue-teal-fg",
};

/** 负向事件(驳回 / 删除)单独压一层红 —— 语义色走 `destructive`,不拿点缀色顶替 */
const NEGATIVE_TONE = "bg-destructive/10 text-destructive";

function detailBag(detail: unknown): Record<string, unknown> {
	return detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {};
}

function toneOf(item: TaskLogItem): string {
	if (item.event === "task.remove" || item.event === "comment.remove") return NEGATIVE_TONE;
	if (item.event === "action.respond" && detailBag(item.detail).approved === false) return NEGATIVE_TONE;
	const category = logCategoryOf(item.event);
	return category ? CATEGORY_TONE[category] : "bg-secondary text-muted-foreground";
}

/**
 * 任务**动态** —— `tc_log` 的只读流:谁、什么时候、把什么从 A 改成 B。
 *
 * 数据由详情页统一取(`logList`),同一批 `items` 还给顶部的「流程条」用 —— 一处查询供两处。
 * 认不出的 `event` 有占位(见 `describeLog` 的 default 分支),不崩、不错位。
 */
export function TaskCloseLog({
	items,
	total,
	loading,
	onLoadMore,
	statuses,
	roleLabel,
}: {
	items: TaskLogItem[];
	total: number;
	/** 「加载更多」在飞 */
	loading: boolean;
	onLoadMore: () => void;
	/** 任务的模板状态清单(把 `value` 翻成展示名) */
	statuses: WorkflowStatus[];
	/** 成员角色 → 展示名(复用调用点既有的 `roleText`) */
	roleLabel: (role: string) => string;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">动态</CardTitle>
			</CardHeader>
			<CardContent className="pt-0">
				{items.length === 0 ? (
					<p className="py-3 text-sm text-muted-foreground">还没有动态。状态、动作、评论、成员的变动都会记在这里。</p>
				) : (
					<ul className="divide-y divide-border">
						{items.map((item) => {
							const Icon = TASK_LOG_ICON[item.event] ?? FileQuestion;
							const { title, note } = describeLog(item, {
								statusLabel: (value) => logStatusLabel(statuses, value),
								roleLabel,
							});
							return (
								<li key={item.id} className="flex items-start gap-3 py-2.5">
									<span
										className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", toneOf(item))}
									>
										<Icon className="size-3.5" />
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-sm text-foreground">
											<span className="font-medium">{item.actorName ?? item.actorId}</span>
											<span className="ml-1.5">{title}</span>
										</p>
										{note ? <p className="mt-0.5 wrap-break-word text-xs text-muted-foreground">{note}</p> : null}
									</div>
									<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
										{item.createdAt ? formatLocalMinute(item.createdAt) : "—"}
									</span>
								</li>
							);
						})}
					</ul>
				)}
				{items.length < total ? (
					<div className="pt-3">
						<Button variant="outline" size="sm" disabled={loading} onClick={onLoadMore}>
							{loading ? "加载中…" : "加载更多"}
						</Button>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
