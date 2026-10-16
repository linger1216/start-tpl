import { Seal } from "#/components/ui/seal";
import { Tag } from "#/components/ui/tag";
import { priorityLabelOf, type TaskPriority } from "#/lib/task-close-spec";
import { cn } from "#/lib/utils";

/**
 * `tc_task` 的**展示徽章**合流:
 *  - **状态** = 列表档**迷你章**(DESIGN.md「公文·印鉴」§5.6):状态是流程结果,视觉上就是盖章;
 *    单字取展示 label 的首字,识别不靠颜色,状态词永远在章旁边。
 *  - **优先级** = 描边胶囊 + 圆点(不是流程结果,不盖章);P0 玫 / P1 琥 / P2 翠,「未设置」中性。
 *  - `label` 由调用方从**模板定义**(`statuses[]` / `priorityLabelOf()`)取,本文件不维护中文映射表。
 */

/** 状态 → 迷你章的色系与单字(最终态才像"盖了章";进行中走墨) */
function statusSeal(status: string): { tone: "green" | "red" | "ink" | "gray"; char: string } {
	if (status === "done") return { tone: "green", char: "结" };
	if (status === "closed") return { tone: "green", char: "闭" };
	if (status === "pending") return { tone: "red", char: "审" };
	if (status === "archived") return { tone: "gray", char: "档" };
	return { tone: "ink", char: "启" };
}

/** `tc_task.status` 徽章 —— 状态词不传就退化成 `status` 原值 */
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
	const text = label ?? status;
	const { tone, char } = statusSeal(status);
	return (
		<span className={cn("inline-flex items-center gap-1.5", className)}>
			<Seal size="list" tone={tone} label={char} />
			<span className="text-xs text-muted-foreground">{text}</span>
		</span>
	);
}

const PRIORITY_DOT: Record<TaskPriority, string> = {
	0: "bg-hue-rose",
	1: "bg-hue-amber",
	2: "bg-hue-emerald",
};

/** 描边胶囊 + 圆点(优先级沿用) */
function DotBadge({ dot, label, className }: { dot: string; label: string; className?: string }) {
	return (
		<Tag variant="outline" className={cn("gap-1.5 text-muted-foreground", className)}>
			<span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot)} />
			{label}
		</Tag>
	);
}

/**
 * **姓名签** —— 「公文·印鉴」世界里"人"的视觉身份:墨底方章 + 反白首字 + 宋体 + -3° 微旋。
 *
 * 评论流(`size="md"`,36px)与成员列表(`size="sm"`,22px)两处原本各写了一份同构 span ——
 * 合到这里之后,**同一个人在每一处都是同一枚章**(taste:实体视觉身份跨屏一致);
 * 底色 `var(--ink)` / 文字 `var(--paper-raised)` 跟随主题翻转,深色模式下墨=暖纸、字=夜墨。
 */
export function NameSeal({ name, size = "md", className }: { name: string; size?: "sm" | "md"; className?: string }) {
	const initials = (name || "?").slice(0, 1);
	return (
		<span
			className={cn(
				"flex shrink-0 -rotate-3 items-center justify-center rounded-[3px] bg-ink font-heading font-bold text-paper outline-1 outline-offset-2 outline-border",
				size === "md" ? "size-9 text-sm" : "size-5.5 text-xs",
				className,
			)}
		>
			{initials}
		</span>
	);
}

/** `tc_task.priority` 徽章 —— `priority` 为 null / 未知数字 → 「未设置」,不抛错 */
export function PriorityBadge({
	priority,
	label,
	className,
}: {
	priority: number | null | undefined;
	label?: string;
	className?: string;
}) {
	const isKnown = priority === 0 || priority === 1 || priority === 2 ? (priority as TaskPriority) : null;
	return (
		<DotBadge
			dot={isKnown !== null ? PRIORITY_DOT[isKnown] : "bg-muted-foreground/40"}
			label={label ?? (isKnown !== null ? priorityLabelOf(priority) : "未设置")}
			className={className}
		/>
	);
}
