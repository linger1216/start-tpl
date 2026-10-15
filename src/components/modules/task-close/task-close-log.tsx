import type { LucideIcon } from "lucide-react";
import {
	ArrowRightLeft,
	CheckCheck,
	FilePlus2,
	FileQuestion,
	MessageSquare,
	MessageSquareReply,
	MessageSquareX,
	Pencil,
	Send,
	Trash2,
	UserMinus,
	UserPlus,
} from "lucide-react";

import { Button } from "#/components/ui/button";
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
	"action.reply": MessageSquareReply,
	"comment.create": MessageSquare,
	"comment.remove": MessageSquareX,
	"member.add": UserPlus,
	"member.remove": UserMinus,
	"member.transfer": ArrowRightLeft,
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
 * 任务**动态** —— 详情页右栏「流程动态」下半段(状态流之上)的事件时间轴。
 *
 * 拆成两块对外:
 *  - `TaskCloseLogList` —— 纯列表(无 Card 标题,便于内嵌到任意 block);样式是「贯穿竖线 + 节点」时间轴
 *  - `LoadMore` —— 「加载更多」按钮(详情页与未来入口共用)
 *
 * 数据由详情页统一取(`logList`),同一批 `items` 还给右栏上方的「状态流」用 —— 一处查询供两处。
 * 认不出的 `event` 有占位(见 `describeLog` 的 default 分支),不崩、不错位。
 */

/** 纯列表,无 Card 标题。详情页右栏内嵌使用。 */
export function TaskCloseLogList({
	items,
	statuses,
	roleLabel,
	loading,
}: {
	items: TaskLogItem[];
	statuses: WorkflowStatus[];
	roleLabel: (role: string) => string;
	/** 首次取数中 —— 别把「还没到」说成「没有」:空态与加载态是两回事 */
	loading?: boolean;
}) {
	if (items.length === 0) {
		return (
			<p className="py-2 text-sm text-muted-foreground">
				{loading ? "加载中…" : "还没有事件。状态、动作、评论、成员的变动都会记在这里。"}
			</p>
		);
	}
	return (
		<ul className="relative ms-2.5 space-y-1">
			{/* 贯穿竖线:left 7px 从第一项顶部留出 12px 起到最后一项底部 12px 止 */}
			<span aria-hidden className="pointer-events-none absolute start-[7px] top-3 bottom-3 w-px bg-border" />
			{items.map((item) => {
				const Icon = TASK_LOG_ICON[item.event] ?? FileQuestion;
				const { title, note } = describeLog(item, {
					statusLabel: (value) => logStatusLabel(statuses, value),
					roleLabel,
				});
				return (
					<li key={item.id} className="relative flex items-start gap-2 py-1.5 ps-7">
						{/* 节点:色调走 CATEGORY_TONE / 负向色,与原版同形,但缩到 size-5 适配右栏窄列 */}
						<span
							className={cn(
								"absolute start-0 mt-0.5 flex size-5 items-center justify-center rounded-full ring-2 ring-card",
								toneOf(item),
							)}
						>
							<Icon className="size-3" />
						</span>
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline justify-between gap-2 text-sm leading-snug">
								<span className="text-foreground">
									<span className="font-medium">{item.actorName ?? item.actorId}</span>
									<span className="ms-1">{title}</span>
								</span>
								<span className="shrink-0 tabular-nums text-xs text-muted-foreground">
									{item.createdAt ? formatLocalMinute(item.createdAt) : "—"}
								</span>
							</div>
							{note ? <p className="mt-0.5 wrap-break-word text-xs text-muted-foreground">{note}</p> : null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

/** 「加载更多」按钮 —— `loaded >= total` 时不渲染(空态由父级自己处理) */
export function LoadMore({
	loading,
	total,
	loaded,
	onLoadMore,
}: {
	loading: boolean;
	total: number;
	loaded: number;
	onLoadMore: () => void;
}) {
	if (loaded >= total) return null;
	return (
		<div className="pt-1.5 ps-7">
			<Button variant="ghost" size="sm" disabled={loading} onClick={onLoadMore}>
				{loading ? "加载中…" : "加载更多"}
			</Button>
		</div>
	);
}
