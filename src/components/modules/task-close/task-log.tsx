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
	Upload,
	UserMinus,
	UserPlus,
} from "lucide-react";
import { AsyncState } from "#/components/modules/task-close/async-state";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import {
	describeLog,
	logCategoryOf,
	type TaskLogCategory,
	type TaskLogEvent,
	type TaskLogItem,
} from "#/lib/task/close-log";
import { statusLabelOf, type WorkflowStatus } from "#/lib/task/close-spec";
import { bagOf } from "#/lib/task/json";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/**
 * 事件 → 图标。**与 `lib/task/close-log.ts` 的事件码一一对应** —— 这里用 `Record<TaskLogEvent, …>`,
 * 那边加一个事件码而这边忘了补,`pnpm typecheck` 直接报错(之前写的是 `Record<string, …>`,漏了也不响)。
 */
const TASK_LOG_ICON: Record<TaskLogEvent, LucideIcon> = {
	"task.create": FilePlus2,
	"task.update": Pencil,
	"task.remove": Trash2,
	"task.transit": ArrowRightLeft,
	"action.create": Send,
	"action.respond": CheckCheck,
	"action.reply": MessageSquareReply,
	"action.withdraw": MessageSquareX,
	"comment.create": MessageSquare,
	"comment.remove": MessageSquareX,
	"member.add": UserPlus,
	"member.remove": UserMinus,
	"member.transfer": ArrowRightLeft,
	"report.submit": Upload,
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
	report: "bg-hue-amber-soft text-hue-amber-fg",
};

/** 负向事件(驳回 / 删除)单独压一层红 —— 语义色走 `destructive`,不拿点缀色顶替 */
const NEGATIVE_TONE = "bg-destructive/10 text-destructive";

function toneOf(item: TaskLogItem): string {
	if (item.event === "task.remove" || item.event === "comment.remove") return NEGATIVE_TONE;
	if (item.event === "action.respond" && bagOf(item.detail).approved === false) return NEGATIVE_TONE;
	const category = logCategoryOf(item.event);
	return category ? CATEGORY_TONE[category] : "bg-secondary text-muted-foreground";
}

/**
 * 任务**动态** —— 详情页右栏「流程动态」下半段(状态流之上)的事件时间轴。
 *
 * 拆成两块对外:
 *  - `TaskLogList` —— 纯列表(无 Card 标题,便于内嵌到任意 block);样式是「贯穿竖线 + 节点」时间轴
 *
 * 数据由详情页统一取(`logList`),同一批 `items` 还给右栏上方的「状态流」用 —— 一处查询供两处。
 * 认不出的 `event` 有占位(见 `describeLog` 的 default 分支),不崩、不错位。
 */

/** 纯列表,无 Card 标题。详情页右栏内嵌使用。 */
export function TaskLogList({
	items,
	statuses,
	loading,
	error,
	onRetry,
}: {
	items: TaskLogItem[];
	statuses: WorkflowStatus[];
	/** 首次取数中 —— 别把「还没到」说成「没有」:空态与加载态是两回事 */
	loading?: boolean;
	/** 取数失败 —— 同理,别把「取不到」说成「没有」 */
	error?: unknown;
	onRetry?: () => void;
}) {
	if (error) {
		return <AsyncState inline pending={false} error={error} onRetry={onRetry} />;
	}
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
				// 库里可能有界面还不认识的事件码(旧数据 / 回滚过):统一走兜底图标,不白屏
				const Icon = TASK_LOG_ICON[item.event as TaskLogEvent] ?? FileQuestion;
				const { title, note } = describeLog(item, {
					statusLabel: (value) => statusLabelOf(statuses, value),
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
									{item.createdAt ? formatLocalMinute(item.createdAt) : PLACEHOLDER_EMPTY}
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
