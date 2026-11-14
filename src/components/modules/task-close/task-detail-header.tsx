import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Info } from "lucide-react";

import { Button, buttonVariants } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Tag } from "#/components/ui/tag.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";
import { DocDot, MetaRow, PageTitle } from "#/components/ui/typography";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { priorityLabelOf } from "#/lib/task/close-spec";
import { formatLocalDate, formatLocalMinute } from "#/lib/time";

/**
 * 任务详情的**记录头** —— 标题 + 一行版记 + 右上角动作组。
 *
 * 拆出来是因为它有 20 个左右的 props(动作组的状态与回调),留在页面文件里会把编排层撑爆。
 * 这里只做「画」,不发请求、不改状态:能不能点、能点什么由页面传进来的 `permissions` 派生结果决定。
 */
export function TaskDetailHeader({
	task,
	roleLabel,
	roleWhy,
	tipLines,
	canApprove,
	canConsult,
	canSetStatus,
	statusOptions,
	hasMoreActions,
	canTransfer,
	canManage,
	canRemove,
	showRefresh,
	refreshing,
	onApprove,
	onSetStatus,
	onConsult,
	onTransfer,
	onEdit,
	onRemove,
	onRefresh,
}: {
	task: {
		name: string;
		description?: string | null;
		dueAt?: string | null;
		createdAt?: string | null;
		priority?: number | null;
	};
	roleLabel: string;
	roleWhy: string;
	tipLines: readonly string[];
	canApprove: boolean;
	canConsult: boolean;
	canSetStatus: boolean;
	statusOptions: readonly { value: string; label: string }[];
	hasMoreActions: boolean;
	canTransfer: boolean;
	canManage: boolean;
	/** 删除任务:只有创建者或管理员 */
	canRemove: boolean;
	showRefresh: boolean;
	refreshing: boolean;
	onApprove: () => void;
	onSetStatus: (value: string) => void;
	onConsult: () => void;
	onTransfer: () => void;
	onEdit: () => void;
	onRemove: () => void;
	onRefresh: () => void;
}) {
	return (
		<header className="border-b border-dashed border-border bg-card">
			<div className="px-8 pt-4 pb-5">
				{/* 顶部左上:返回按钮(用户要求「顶部左上角」)。真锚点 + 按钮样式 ——
				    `<a>` 里不能放 `<button>`,那样键盘焦点会重复 */}
				<div className="mb-1.5">
					<Link
						to="/task-close"
						className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 text-muted-foreground" })}
					>
						<ArrowLeft className="size-3.5" />
						返回我的任务
					</Link>
				</div>

				<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
					{/* 主信息:记录头 —— 宋体标题 + 一行中性元信息(章 + 日期) */}
					<div className="min-w-0 flex-1">
						<div className="flex justify-between gap-3">
							<PageTitle>{task.name}</PageTitle>
						</div>
						{/* 版记行(MetaRow,DESIGN.md §5.2):12px 黑体 0.05em,无图标 —— 元信息是版记,不是图标墙 */}
						<MetaRow className="mt-2">
							<span>
								截止
								<strong className="ml-1.5 font-medium tabular-nums text-foreground">
									{/* 日期字段按**天**显示 —— 选择器本来就只取到天,`00:00` 是假精度 */}
									{task.dueAt ? formatLocalDate(task.dueAt) : "未设置"}
								</strong>
							</span>
							<DocDot />
							<span>
								创建于
								<strong className="ml-1.5 font-medium tabular-nums text-foreground">
									{task.createdAt ? formatLocalMinute(task.createdAt) : PLACEHOLDER_EMPTY}
								</strong>
							</span>
							<Tag variant="random" hashKey={`p${task.priority ?? "x"}`}>
								{priorityLabelOf(task.priority)}
							</Tag>
						</MetaRow>
					</div>

					{/* 右上动作组(收敛到 4 组):ⓘ + 主动作(发起审批/改状态取一) + 发起征询 + 更多▾;刷新殿后 */}
					<div className="flex flex-wrap items-center justify-start gap-1 lg:justify-end">
						{/* 「为什么有这些按钮」—— 悬停 / 聚焦展开:当前身份 + 事项流程给这个身份的边,方便复核 */}
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger
									aria-label="为什么有这些按钮"
									className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
								>
									<Info className="size-3.5" />
								</TooltipTrigger>
								<TooltipContent side="bottom" align="end" className="block max-w-72">
									<div className="text-xs font-medium">当前身份:{roleLabel}</div>
									<p className="mt-1 text-xs leading-relaxed opacity-90">{roleWhy}</p>
									<ul className="mt-1.5 grid gap-0.5 text-xs leading-relaxed opacity-90">
										{tipLines.map((line) => (
											<li key={line}>{line}</li>
										))}
									</ul>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						{/* 主动作:发起审批优先;无审批边但有直改边时,改状态顶上 primary 位 */}
						{canApprove ? (
							<Button size="sm" title="发起审批;任务会锁定,等对方答复" onClick={onApprove}>
								发起审批
							</Button>
						) : canSetStatus ? (
							<Button
								size="sm"
								title="按事项流程直接更改状态"
								onClick={() => onSetStatus(statusOptions[0]?.value ?? "")}
							>
								更改状态
							</Button>
						) : null}
						{/* 「发起征询」是身份动作,不受锁限制 */}
						{canConsult ? (
							<Button variant="outline" size="sm" title="请某位成员给意见(不改状态、不锁任务)" onClick={onConsult}>
								发起征询
							</Button>
						) : null}
						{/* 更多▾:转交 / 改状态(发起审批在场时降级入菜单)/ 编辑 / 删除 */}
						{hasMoreActions ? (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button variant="outline" size="sm" aria-label="更多操作">
											更多
											<ChevronDown className="size-3.5" />
										</Button>
									}
								/>
								<DropdownMenuContent align="end">
									{canTransfer ? <DropdownMenuItem onClick={onTransfer}>转交执行人</DropdownMenuItem> : null}
									{canSetStatus && canApprove ? (
										<DropdownMenuItem onClick={() => onSetStatus(statusOptions[0]?.value ?? "")}>
											更改状态
										</DropdownMenuItem>
									) : null}
									{(canTransfer || (canSetStatus && canApprove)) && canManage ? <DropdownMenuSeparator /> : null}
									{canManage ? <DropdownMenuItem onClick={onEdit}>编辑</DropdownMenuItem> : null}
									{canRemove ? (
										<DropdownMenuItem variant="destructive" onClick={onRemove}>
											删除
										</DropdownMenuItem>
									) : null}
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
						{showRefresh ? <RefreshButton busy={refreshing} onClick={onRefresh} /> : null}
					</div>
				</div>

				{task.description ? (
					<p className="mt-3 p-4 min-w-0 flex-1 text-base leading-relaxed text-muted-foreground wrap-break-word">
						{task.description}
					</p>
				) : null}
			</div>
		</header>
	);
}
