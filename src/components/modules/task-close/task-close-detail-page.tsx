import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, CalendarClock, Flag, Paperclip, Pencil, Send, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageFrame } from "#/components/layout/page-frame";
import { TaskAttachmentPreview } from "#/components/modules/task-close/task-close-attachment-preview";
import { TaskCloseComments } from "#/components/modules/task-close/task-close-comments";
import {
	TaskCloseForm,
	type TaskFormEditing,
	type TaskFormPayload,
} from "#/components/modules/task-close/task-close-form";
import { TaskCloseLogList } from "#/components/modules/task-close/task-close-log";
import { PriorityBadge } from "#/components/modules/task-close/task-close-priority";
import { StatusBadge } from "#/components/modules/task-close/task-close-status";
import { TaskStatusTimeline } from "#/components/modules/task-close/task-close-status-timeline";
import { TaskAttachmentList, TaskAttachmentPicker } from "#/components/modules/task-close/task-content-attachments";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { SearchSelect } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { priorityLabelOf, statusLabelOf, type WorkflowStatus } from "#/lib/task-close-spec";
import type { TaskAttachment } from "#/lib/task-content";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/**
 * 任务详情 —— 闭环页(按 `assets/ui/任务详情.html` 原型重画)。
 *
 * 结构:
 *   ┌─ topbar (外层 shell,这里不画) ───────────────────────┐
 *   ├─ 头部:面包屑 + 标题(带状态 / 优先级徽章) + 描述 +   ┤
 *   │         右上 4 个动作按钮 + meta-line 一行             ┤
 *   └─ main(layout): 左 main + 右 side(粘性 72px)          ┘
 *     - 左 main:
 *         · todo 横幅(轮到我,有 myActionIds 才出现)
 *         · 附件 block
 *         · 评论与回复 block(TaskCloseComments 接管输入+嵌套 thread)
 *     - 右 side:
 *         · 参与人员 block
 *         · 流程动态 block(状态流 TaskStatusTimeline + 事件 TaskCloseLogList)
 *
 * 头部动作按钮(`@assets/ui/任务详情.html` 原型 + 用户约定的角色矩阵,见下方 `myRole` / `can`):
 *   · 发起审批 —— 即原型里的「标记完成」,接 `taskTransit`,只显示可直跳的「完成类」目标(closed / done)
 *   · 转交 / 发起征询 —— **原型占位**,点击暂未接线,后续接 `actionCreate` 与转交 endpoint(目前没有);
 *     画出来是按用户「全部动作上提」的指示做,**不要**误以为已经接好。
 */
export function TaskCloseDetailPage({ taskId }: { taskId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const [editOpen, setEditOpen] = useState(false);
	const [removeOpen, setRemoveOpen] = useState(false);
	const [memberOpen, setMemberOpen] = useState(false);
	/** 附件弹窗:创建人给任务加 / 删附件(随 `task.payload.attachments` 走) */
	const [attachOpen, setAttachOpen] = useState(false);
	const [draftAttachments, setDraftAttachments] = useState<TaskAttachment[]>([]);
	const [newMemberId, setNewMemberId] = useState("");
	const [newMemberRole, setNewMemberRole] = useState("participant");
	/** 正在预览的附件(开弹窗看 / 下载) */
	const [previewAttachment, setPreviewAttachment] = useState<TaskAttachment | null>(null);
	/** 动态度:一次取多少条(「加载更多」每次 +20) */
	const [logPageSize, setLogPageSize] = useState(20);

	const detailQuery = useQuery(trpc.taskClose.taskGet.queryOptions({ id: taskId }));
	// 我的待办:一次拿全,用来判断 todo 横幅有几条、流程事件是否高亮
	const mineQuery = useQuery(trpc.taskClose.actionMine.queryOptions({ pageSize: 100 }));
	const usersQuery = useQuery(trpc.user.list.queryOptions());
	// 活动日志(`tc_log`):同一批 items 既画右栏「流程动态」里的「事件」段落,流程状态也由它派生
	const logQuery = useQuery(trpc.taskClose.logList.queryOptions({ taskId, pageSize: logPageSize }));

	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());

	const transitMutation = useMutation(
		trpc.taskClose.taskTransit.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("状态已更新");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const updateMutation = useMutation(
		trpc.taskClose.taskUpdate.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setEditOpen(false);
				toast.success("已保存");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	/** 附件弹窗专用保存 —— 只改 `payload.attachments`;名称 / 描述 / 截止 / 优先级原样带回,别被清空 */
	const attachMutation = useMutation(
		trpc.taskClose.taskUpdate.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setAttachOpen(false);
				toast.success("附件已更新");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const removeMutation = useMutation(
		trpc.taskClose.taskRemove.mutationOptions({
			onSuccess: () => {
				setRemoveOpen(false);
				toast.success("任务已删除");
				void queryClient.invalidateQueries({ ...trpc.taskClose.pathFilter(), refetchType: "none" });
				void navigate({ to: "/task-close", replace: true });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const memberAddMutation = useMutation(
		trpc.taskClose.memberAdd.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setMemberOpen(false);
				setNewMemberId("");
				setNewMemberRole("executor");
				toast.success("已加入成员");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const memberRemoveMutation = useMutation(
		trpc.taskClose.memberRemove.mutationOptions({
			onSuccess: () => invalidate(),
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const myActionIds = useMemo(() => new Set((mineQuery.data?.items ?? []).map((item) => item.id)), [mineQuery.data]);

	const userOptions = useMemo(
		() => (usersQuery.data ?? []).map((row) => ({ value: row.id, label: row.name })),
		[usersQuery.data],
	);

	/**
	 * 「我的待办」中属于本任务的、当前还活着的 —— hooks **必须在 early-return 之前调用**,
	 * 否则 React 报 hooks 顺序错。data 尚未就绪时取 `[]` 兜底,`useEffect` 后的 early-return
	 * 会挡住下面的渲染,所以返回值仅在 data 已就绪路径里有意义。
	 */
	const myPendingActions = useMemo(
		() => (detailQuery.data?.actions ?? []).filter((row) => myActionIds.has(row.id)),
		[detailQuery.data, myActionIds],
	);

	/** 「标记完成」按钮可去的状态 —— 原型只画这一个直跳按钮。`transitions` 里命中 `closed` / `done`。 */
	const closeTargets = useMemo(
		() => (detailQuery.data?.permissions?.transitions ?? []).filter((to) => to === "closed" || to === "done"),
		[detailQuery.data],
	);
	const markDoneTarget = closeTargets[0] ?? null;

	/**
	 * 我在任务里的角色(admin / creator / executor / participant / null) —— 头部右上按钮矩阵的判据。
	 *
	 * 矩阵取自任务约定(用户给定):
	 *   · 管理员(admin)           → 什么都可以(转交 / 发起征询 / 发起审批 / 编辑 / 删除 / 刷新)
	 *   · 创建者(creator)         → 编辑, 删除, 刷新, 发起征询
	 *   · 执行者(executor)        → 转交, 发起征询, 发起审批, 刷新
	 *   · 参与者(participant)    → 发起征询, 刷新
	 *   · 旁观者(null)            → 只读
	 *
	 * `admin` 由服务端 `permissions.isAdmin`(「系统管理员」角色)下发 —— 与写接口的旁路同一判据。
	 */
	const myRole = useMemo<"admin" | "creator" | "executor" | "participant" | null>(() => {
		const data = detailQuery.data;
		if (!data) return null;
		if (data.permissions.isAdmin) return "admin";
		if (data.task.creatorId === data.meId) return "creator";
		const m = data.members.find((row) => row.userId === data.meId);
		if (m?.role === "executor" || m?.role === "participant") return m.role;
		return null;
	}, [detailQuery.data]);

	const can = useMemo(() => {
		const isAdmin = myRole === "admin";
		return {
			transfer: isAdmin || myRole === "executor",
			consult: myRole !== null,
			approve: isAdmin || myRole === "executor",
			edit: isAdmin || myRole === "creator",
			remove: isAdmin || myRole === "creator",
			refresh: myRole !== null,
			addMember: myRole !== null,
			manageMembers: isAdmin || myRole === "creator",
		};
	}, [myRole]);

	/** 这条 id 在库里已经不存在了(被删 / 别人删了 / 手输错了) */
	const taskMissing = detailQuery.isError && isTaskMissing(detailQuery.error);
	const bouncedRef = useRef(false);

	// 不存在的任务不留错误页:提示一声就回「我的任务」(replace —— 这条 URL 不该再进历史)
	useEffect(() => {
		if (!taskMissing || bouncedRef.current) return;
		bouncedRef.current = true;
		toast.error("任务不存在或已删除,已回到我的任务");
		void navigate({ to: "/task-close", replace: true });
	}, [taskMissing, navigate]);

	if (detailQuery.isPending) {
		return (
			<PageFrame>
				<div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>
			</PageFrame>
		);
	}

	if (detailQuery.isError || !detailQuery.data) {
		if (taskMissing) {
			return (
				<PageFrame>
					<div className="py-12 text-center text-sm text-muted-foreground">任务不存在,正在返回我的任务…</div>
				</PageFrame>
			);
		}
		return (
			<PageFrame>
				<div className="space-y-3 py-12 text-center text-sm text-muted-foreground">
					<p>{toApiError(detailQuery.error).message}</p>
					<Link to="/task-close" className="text-primary underline-offset-4 hover:underline">
						返回我的任务
					</Link>
				</div>
			</PageFrame>
		);
	}

	const { task, content, attachments, members, meId } = detailQuery.data;
	// 状态图快照:状态清单(value+label)从这里取(展示一律用 label)
	const workflow = task.workflow as { statuses?: WorkflowStatus[]; initial?: string } | null;
	const statuses = workflow?.statuses ?? [];

	const editing: TaskFormEditing = {
		id: task.id,
		name: task.name,
		description: task.description,
		dueAt: task.dueAt,
		priority: task.priority,
		content,
		attachments,
	};

	return (
		<PageFrame className="mx-auto w-full">
			{/* ─── 头部(hd) ─────────────────────────────────────────────── */}
			<header className="border-b border-border bg-background">
				<div className="px-8 py-4">
					{/* 顶部左上:返回按钮(用户要求「顶部左上角」) */}
					<div className="mb-2.5">
						<Link to="/task-close">
							<Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground">
								<ArrowLeft className="size-3.5" />
								返回我的任务
							</Button>
						</Link>
					</div>

					<div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
						{/* 主信息:标题(带徽章) + 描述 */}
						<div className="min-w-0">
							<h1 className="mb-1.5 flex flex-wrap items-center gap-2 text-2xl font-bold leading-tight tracking-[-0.01em] text-foreground">
								<span>{task.name}</span>
								<StatusBadge status={task.status} label={statusLabelOf(statuses, task.status)} />
								{task.priority ? (
									<PriorityBadge priority={task.priority} label={priorityLabelOf(task.priority)} />
								) : null}
							</h1>
							{task.description ? (
								<p className="max-w-190 text-[13.5px] leading-relaxed text-muted-foreground wrap-break-word">
									{task.description}
								</p>
							) : null}
						</div>

						{/* 右上动作组 —— 按 `can` 角色矩阵显示(详见上文的「我在任务里的角色」块) */}
						<div className="flex flex-wrap items-center justify-start gap-1 lg:justify-end">
							{can.transfer ? (
								<Button
									variant="outline"
									size="sm"
									title="转交功能尚未接线"
									onClick={() => toast.info("转交功能尚未实现,需要新接口后再接上")}
								>
									转交
								</Button>
							) : null}
							{can.consult ? (
								<Button
									variant="outline"
									size="sm"
									title="发起征询尚未接线"
									onClick={() => toast.info("发起征询尚未实现,需要新 dialog 后再接上")}
								>
									发起征询
								</Button>
							) : null}
							{/* 「发起审批」= 原型里的「标记完成」,执行者 / 管理员可见 */}
							{can.approve ? (
								<Button
									variant="outline"
									size="sm"
									title={
										markDoneTarget
											? `直接跳到「${statusLabelOf(statuses, markDoneTarget)}」`
											: "当前态没有可直跳的完成状态"
									}
									disabled={transitMutation.isPending || !markDoneTarget}
									onClick={() => {
										if (markDoneTarget) transitMutation.mutate({ id: task.id, to: markDoneTarget });
									}}
								>
									发起审批
								</Button>
							) : null}
							{can.edit ? (
								<Button variant="outline" size="icon-sm" aria-label="编辑" onClick={() => setEditOpen(true)}>
									<Pencil className="size-3.5" />
								</Button>
							) : null}
							{can.remove ? (
								<Button variant="outline" size="icon-sm" aria-label="删除" onClick={() => setRemoveOpen(true)}>
									<Trash2 className="size-3.5" />
								</Button>
							) : null}
							{can.refresh ? (
								<RefreshButton busy={detailQuery.isFetching} onClick={() => detailQuery.refetch()} />
							) : null}
						</div>
					</div>

					{/* meta-line 一行:截止 + 优先级(原型 metadata,只上已有的,不堆废字段) */}
					<ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-dashed border-border pt-2.5 text-[12.5px] text-muted-foreground">
						<li className="inline-flex items-center gap-1.5">
							<CalendarClock className="size-3.5 shrink-0" />
							<span>截止</span>
							<strong className="font-semibold text-foreground">
								{task.dueAt ? formatLocalMinute(task.dueAt) : "未设置"}
							</strong>
						</li>
						<li className="inline-flex items-center gap-1.5">
							<Flag className="size-3.5 shrink-0" />
							<span>优先级</span>
							<strong className="font-semibold text-foreground">
								{task.priority ? priorityLabelOf(task.priority) : "未设置"}
							</strong>
						</li>
						<li className="inline-flex items-center gap-1.5">
							<span>创建于</span>
							<strong className="font-semibold text-foreground">
								{task.createdAt ? formatLocalMinute(task.createdAt) : "—"}
							</strong>
						</li>
					</ul>
				</div>
			</header>

			{/* ─── main layout ─────────────────────────────────────────── */}
			<main className="grid gap-6 px-8 py-5 lg:grid-cols-[minmax(0,1fr)_260px]">
				{/* 左 main */}
				<section className="grid gap-6 min-w-0">
					{/* 轮到我横幅 —— `myActionIds ∩ 本任务未结动作` 非空才出现 */}
					{myPendingActions.length > 0 ? (
						<aside
							role="alert"
							className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3.5 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3.5 dark:border-amber-800 dark:bg-amber-950/40"
						>
							<div className="mt-0.5 flex size-7 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
								<AlertCircle className="size-4" />
							</div>
							<div className="grid gap-1.5">
								<div className="text-sm text-foreground">
									<strong className="font-semibold">需你处理</strong> · {myPendingActions.length} 项待办
								</div>
								<ul className="grid gap-1">
									{myPendingActions.slice(0, 3).map((row) => {
										const arrow =
											row.fromStatus && row.toStatus && row.fromStatus !== row.toStatus
												? `${statusLabelOf(statuses, row.fromStatus)} → ${statusLabelOf(statuses, row.toStatus)}`
												: "动作待办";
										return (
											<li key={row.id} className="inline-flex items-center gap-2 text-[12.5px]">
												<span
													className={cn(
														"inline-flex h-[18px] items-center rounded px-1.5 text-[10.5px] font-bold",
														row.status === "active"
															? "bg-primary/10 text-primary"
															: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
													)}
												>
													{row.status === "active" ? "待答复" : "已发起"}
												</span>
												<span className="text-foreground">{arrow}</span>
											</li>
										);
									})}
								</ul>
							</div>
							<div className="flex items-center gap-2 self-center">
								<Button size="sm">去处理</Button>
							</div>
						</aside>
					) : null}

					{/* 附件 block */}
					<section className="grid gap-3">
						<header className="flex items-center justify-between border-b border-border pb-1">
							<h2 className="inline-flex items-baseline gap-1.5 text-[13px] font-bold tracking-tight text-foreground">
								附件 <span className="text-xs font-medium text-muted-foreground">{attachments.length}</span>
							</h2>
							{/* 新增附件:只有任务**创建人**能看到并使用(执行者 / 参与者 / 旁观者不显示) */}
							{task.creatorId === meId ? (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setDraftAttachments(attachments);
										setAttachOpen(true);
									}}
								>
									<FileButtonIcon />
									新增附件
								</Button>
							) : null}
						</header>
						<TaskAttachmentList attachments={attachments} onOpen={setPreviewAttachment} />
					</section>

					{/* 评论与回复 block —— TaskCloseComments 自带输入 + 嵌套 thread */}
					<section className="grid gap-3">
						<header className="flex items-center justify-between border-b border-border pb-1">
							<h2 className="inline-flex items-baseline gap-1.5 text-[13px] font-bold tracking-tight text-foreground">
								评论与回复
							</h2>
						</header>
						{/* 删评论:只有作者本人;`canRemoveAny` 只给管理员(创建者也不能删别人的) */}
						<TaskCloseComments taskId={task.id} meId={meId} canRemoveAny={myRole === "admin"} />
					</section>
				</section>

				{/* 右 side(sticky) */}
				<aside className="sticky top-[72px] grid gap-6 self-start">
					{/* 参与人员 block */}
					<section className="grid gap-3">
						<header className="flex items-center justify-between border-b border-border pb-1">
							<h2 className="inline-flex items-baseline gap-1.5 text-[13px] font-bold tracking-tight text-foreground">
								参与人员 <span className="text-xs font-medium text-muted-foreground">{members.length + 1}</span>
							</h2>
							{can.addMember ? (
								<Button size="icon-sm" variant="outline" aria-label="加成员" onClick={() => setMemberOpen(true)}>
									<UserPlus className="size-3.5" />
								</Button>
							) : null}
						</header>
						<ul className="grid">
							<PeopleRow roleLabel="创建人" name={task.creatorName ?? "—"} main={false} />
							{members.map((m) => (
								<PeopleRow
									key={`${m.userId}-${m.role}`}
									roleLabel={roleText(m.role)}
									name={m.name ?? m.userId}
									main={m.isPrimary}
									onRemove={
										can.manageMembers
											? () =>
													memberRemoveMutation.mutate({
														taskId: task.id,
														userId: m.userId,
														role: m.role as "participant" | "executor",
													})
											: undefined
									}
									removing={memberRemoveMutation.isPending}
								/>
							))}
							{members.length === 0 ? (
								<li className="py-3 text-[12.5px] text-muted-foreground">
									还没有其他人。加人后他们能答复动作、参与讨论。
								</li>
							) : null}
						</ul>
					</section>

					{/* 流程动态 block —— 状态流(上) + 事件流(下) */}
					<section className="grid gap-3">
						<header className="flex items-center justify-between border-b border-border pb-1">
							<h2 className="inline-flex items-baseline gap-1.5 text-[13px] font-bold tracking-tight text-foreground">
								流程动态
							</h2>
							<Badge variant="secondary" className="text-[10px]">
								<Send className="mr-1 size-3" />
								实时
							</Badge>
						</header>
						<TaskStatusTimeline logs={logQuery.data?.items ?? []} statuses={statuses} current={task.status} />
						<div className="mt-2 border-t border-dashed border-border pt-2">
							<h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">事件</h3>
							<TaskCloseLogList items={logQuery.data?.items ?? []} statuses={statuses} roleLabel={roleText} />
							{(logQuery.data?.items?.length ?? 0) < (logQuery.data?.total ?? 0) ? (
								<div className="pt-1.5 ps-7">
									<Button
										variant="ghost"
										size="sm"
										disabled={logQuery.isFetching}
										onClick={() => setLogPageSize((size) => size + 20)}
									>
										{logQuery.isFetching ? "加载中…" : "加载更多"}
									</Button>
								</div>
							) : null}
						</div>
					</section>
				</aside>
			</main>

			<TaskCloseForm
				open={editOpen}
				onOpenChange={setEditOpen}
				pending={updateMutation.isPending}
				editing={editing}
				workflowOptions={[]}
				userOptions={userOptions}
				onSubmit={(payload: TaskFormPayload) =>
					updateMutation.mutate({
						id: task.id,
						name: payload.name,
						description: payload.description,
						dueAt: payload.dueAt,
						priority: payload.priority,
						payload: { content: payload.content, attachments: payload.attachments },
					})
				}
			/>

			<ConfirmDialog
				open={removeOpen}
				onOpenChange={setRemoveOpen}
				title="删除任务"
				description={`「${task.name}」会被软删,动作与评论一并不可见。`}
				isPending={removeMutation.isPending}
				confirmText="删除"
				onConfirm={() => removeMutation.mutate({ id: task.id })}
			/>

			<Dialog open={memberOpen} onOpenChange={setMemberOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>加入成员</DialogTitle>
					</DialogHeader>
					<div className="space-y-1 py-1">
						<DetailRow label="人员" align="center">
							<SearchSelect
								value={newMemberId}
								onValueChange={setNewMemberId}
								options={userOptions}
								placeholder="选一个人"
							/>
						</DetailRow>
						<DetailRow label="角色" align="center">
							<Select
								items={ROLE_OPTIONS}
								value={newMemberRole}
								onValueChange={(next) => setNewMemberRole(next ? String(next) : "participant")}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ROLE_OPTIONS.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</DetailRow>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setMemberOpen(false)} disabled={memberAddMutation.isPending}>
							取消
						</Button>
						<Button
							disabled={memberAddMutation.isPending || !newMemberId}
							onClick={() =>
								memberAddMutation.mutate({
									taskId: task.id,
									userId: newMemberId,
									role: newMemberRole as "participant" | "executor",
									isPrimary: newMemberRole === "executor",
								})
							}
						>
							{memberAddMutation.isPending ? "加入中…" : "加入"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* 新增附件 —— 创建人专用:选完即传,保存只改 `payload.attachments`(复用任务编辑的附件 picker) */}
			<Dialog open={attachOpen} onOpenChange={setAttachOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>附件</DialogTitle>
						<DialogDescription>选完即传;保存后随任务一起可见。</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<TaskAttachmentPicker
							value={draftAttachments}
							onChange={setDraftAttachments}
							disabled={attachMutation.isPending}
						/>
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" onClick={() => setAttachOpen(false)} disabled={attachMutation.isPending}>
							取消
						</Button>
						<Button
							disabled={attachMutation.isPending}
							onClick={() =>
								attachMutation.mutate({
									id: task.id,
									name: task.name,
									description: task.description,
									dueAt: task.dueAt,
									priority: task.priority,
									payload: { content, attachments: draftAttachments.map((file) => file.id) },
								})
							}
						>
							{attachMutation.isPending ? "保存中…" : "保存"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<TaskAttachmentPreview
				taskId={task.id}
				attachment={previewAttachment}
				open={previewAttachment !== null}
				onOpenChange={(next) => {
					if (!next) setPreviewAttachment(null);
				}}
			/>
		</PageFrame>
	);
}

/** 「文件」icon —— 块头右上的「新增附件」按钮的点缀。lucide 没用 emoji,直接用 lucide-react */
function FileButtonIcon() {
	return <Paperclip className="size-3.5" aria-hidden />;
}

const ROLE_OPTIONS = [
	{ value: "executor", label: "执行者" },
	{ value: "participant", label: "参与者" },
];

function roleText(role: string): string {
	return ({ creator: "创建者", participant: "参与者", executor: "执行者" } as Record<string, string>)[role] ?? role;
}

/**
 * 参与人员块里的一行 —— 左侧角色标签 + 右侧人名(主执行人用紫色高亮:头像 `bg-hue-violet`、名字 `text-hue-violet-fg`);
 * `onRemove` 非空时显式给「移出」按钮(原型的视觉占位)。
 *
 * 头像底走品牌蓝 `bg-primary` / 紫色 `bg-hue-violet`,配 `text-*-foreground` / `text-hue-violet-on`
 * 这对**语义 token**(深色模式自动翻转);**不要写 `bg-accent`** —— 它在本项目是浅灰面 `#f8fafc`,
 * 白字压上去直接看不见(原型里的 `--color-accent` 是品牌蓝,与本项目的 `--accent` 同名不同物)。
 *
 * `roleLabel` 不是 HTML `role` 属性 —— prop 名刻意避开 ARIA 关键字,免得 biome 把
 * 「创建人/主执行」之类的中文字面误判成 ARIA role。
 */
function PeopleRow({
	roleLabel,
	name,
	main,
	onRemove,
	removing,
}: {
	roleLabel: string;
	name: string;
	main: boolean;
	onRemove?: () => void;
	removing?: boolean;
}) {
	const initials = (name || "?").slice(0, 1);
	return (
		<li className="flex items-center gap-2 border-b border-dashed border-border py-1.5 text-[13px] last:border-b-0">
			<span className="w-14 text-[11.5px] text-muted-foreground">{roleLabel}</span>
			<div className="flex min-w-0 flex-1 items-center gap-1.5">
				<span
					className={cn(
						"flex size-5.5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
						"shadow-[0_0_0_1.5px_var(--color-background),0_0_0_2.5px_var(--color-border)]",
						main
							? "bg-hue-violet text-hue-violet-on ring-2 ring-hue-violet-line"
							: "bg-primary text-primary-foreground",
					)}
				>
					{initials}
				</span>
				<span className={cn("truncate text-[13px] font-medium", main ? "text-hue-violet-fg" : "text-foreground")}>
					{name}
				</span>
			</div>
			{onRemove ? (
				<Button variant="ghost" size="icon-sm" aria-label="移出成员" disabled={removing} onClick={onRemove}>
					<Trash2 className="size-3.5" />
				</Button>
			) : null}
		</li>
	);
}

/**
 * 「这条任务不存在」的识别 —— 服务端 `taskGet` 查不到活着的记录时抛 tRPC `NOT_FOUND`(`task-close.ts` 的 `getTaskRow`)。
 *
 * 客户端拿到的是 `TRPCClientError`(实测 `@trpc/client` 的构造:`data = shape.data`,两者都挂在错误上),
 * 三种判据都认一遍:`data.code` 是字符串键 `"NOT_FOUND"`、`shape.code` 是数字码 `-32004`、`data.httpStatus` 是 404。
 * 都认不出来就当普通报错走错误页 —— 网络抖动之类不该把人踢回列表。
 */
function isTaskMissing(error: unknown): boolean {
	const err = error as {
		data?: { code?: unknown; httpStatus?: unknown };
		shape?: { code?: unknown; data?: { code?: unknown; httpStatus?: unknown } };
	} | null;
	const code = err?.data?.code ?? err?.shape?.data?.code;
	return code === "NOT_FOUND" || err?.shape?.code === -32004 || err?.data?.httpStatus === 404;
}
