import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, Clock, Pencil, Trash2, User, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import {
	type ActionRow,
	TaskCloseActions,
	type WorkflowEdge,
} from "#/components/modules/task-close/task-close-actions";
import { TaskAttachmentPreview } from "#/components/modules/task-close/task-close-attachment-preview";
import { TaskCloseComments } from "#/components/modules/task-close/task-close-comments";
import {
	TaskCloseForm,
	type TaskFormEditing,
	type TaskFormPayload,
} from "#/components/modules/task-close/task-close-form";
import { TaskCloseLog } from "#/components/modules/task-close/task-close-log";
import { StatusBadge } from "#/components/modules/task-close/task-close-status";
import { TaskStatusTimeline } from "#/components/modules/task-close/task-close-status-timeline";
import { TaskAttachmentList } from "#/components/modules/task-close/task-content-attachments";
import { TaskContentBlocks } from "#/components/modules/task-close/task-content-blocks";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { SearchSelect } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { statusLabelOf, type WorkflowStatus } from "#/lib/task-close-spec";
import type { TaskAttachment } from "#/lib/task-content";
import { formatLocalMinute } from "#/lib/time";

type MemberRow = { userId: string; name: string | null; role: string; isPrimary: boolean };

/**
 * 任务详情 —— 闭环页。
 *
 * 分工:左边「干什么」(状态流转 + 动作 + 评论),右边「是什么」(信息 + 成员)。
 * **能做什么全听服务端的 `permissions`**:前端不解释 `who` / `edges`,按钮只是它的投影。
 */
export function TaskCloseDetailPage({ taskId }: { taskId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const [editOpen, setEditOpen] = useState(false);
	const [removeOpen, setRemoveOpen] = useState(false);
	const [memberOpen, setMemberOpen] = useState(false);
	const [newMemberId, setNewMemberId] = useState("");
	const [newMemberRole, setNewMemberRole] = useState("participant");
	/** 正在预览的附件(开弹窗看 / 下载) */
	const [previewAttachment, setPreviewAttachment] = useState<TaskAttachment | null>(null);
	/** 动态度:一次取多少条(「加载更多」每次 +20) */
	const [logPageSize, setLogPageSize] = useState(20);

	const detailQuery = useQuery(trpc.taskClose.taskGet.queryOptions({ id: taskId }));
	// 我的待办:一次拿全,用来判断时间线上哪几条轮到我答复
	const mineQuery = useQuery(trpc.taskClose.actionMine.queryOptions({ pageSize: 100 }));
	const usersQuery = useQuery(trpc.user.list.queryOptions());
	// 活动日志(`tc_log`):同一批 items 既画顶部「流程条」,也给「动态」卡 —— 一处查询供两处
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

	const removeMutation = useMutation(
		trpc.taskClose.taskRemove.mutationOptions({
			onSuccess: () => {
				setRemoveOpen(false);
				toast.success("任务已删除");
				// 删的就是这条 URL 指向的任务:`replace` 回列表(「后退」不会又回到一篇不存在的详情)。
				// 失效**不重取**(`refetchType: "none"`):这条 `taskGet` 已经查不到了,重取只会先报一次「任务不存在」;
				// 列表页挂载时自己会取(staleTime 默认 0),这里把缓存标记过期就够了。
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
				<Card>
					<CardContent className="py-12 text-center text-sm text-muted-foreground">加载中…</CardContent>
				</Card>
			</PageFrame>
		);
	}

	if (detailQuery.isError || !detailQuery.data) {
		// 不存在:等上面那个 effect 把路由换掉,这里只垫一屏,别闪一下错误页
		if (taskMissing) {
			return (
				<PageFrame>
					<Card>
						<CardContent className="py-12 text-center text-sm text-muted-foreground">
							任务不存在,正在返回我的任务…
						</CardContent>
					</Card>
				</PageFrame>
			);
		}
		return (
			<PageFrame>
				<Card>
					<CardContent className="space-y-3 py-12 text-center text-sm text-muted-foreground">
						<p>{toApiError(detailQuery.error).message}</p>
						<Link to="/task-close" className="text-primary underline-offset-4 hover:underline">
							返回我的任务
						</Link>
					</CardContent>
				</Card>
			</PageFrame>
		);
	}

	const { task, content, attachments, members, actions, permissions, meId } = detailQuery.data;
	// 状态图快照:状态清单(value+label)与边都从这里取(展示一律用 label)
	const workflow = task.workflow as { statuses?: WorkflowStatus[]; initial?: string; edges?: WorkflowEdge[] } | null;
	const statuses = workflow?.statuses ?? [];
	const edges = workflow?.edges ?? [];

	/**
	 * 答复人候选 = 创建者 + 全部成员(去重)。
	 * 指名指人靠 `tc_action.handle_id`,所以这里必须给出**具体的人**,不能给角色。
	 */
	const handleOptions = [
		...new Map<string, { value: string; label: string }>(
			[
				{ value: task.creatorId, label: task.creatorName ?? "创建者" },
				...members.map((row) => ({ value: row.userId, label: row.name ?? row.userId })),
			].map((option) => [option.value, option]),
		).values(),
	];

	const editing: TaskFormEditing = {
		id: task.id,
		name: task.name,
		description: task.description,
		dueAt: task.dueAt,
		content,
		attachments,
	};

	return (
		<PageFrame>
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						{task.name}
						<StatusBadge status={task.status} label={statusLabelOf(statuses, task.status)} />
					</span>
				}
				description="状态按流程模板流转;要改状态得走「发起动作 → 答复」。"
				actions={
					<>
						<Link to="/task-close">
							<Button variant="outline" size="sm">
								<ArrowLeft className="size-3.5" />
								返回
							</Button>
						</Link>
						<RefreshButton busy={detailQuery.isFetching} onClick={() => detailQuery.refetch()} />
						{permissions.canUpdate ? (
							<Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
								<Pencil className="size-3.5" />
								编辑
							</Button>
						) : null}
						{permissions.canRemove ? (
							<Button variant="outline" size="sm" onClick={() => setRemoveOpen(true)}>
								<Trash2 className="size-3.5" />
								删除
							</Button>
						) : null}
					</>
				}
			/>

			{/* 任务头 —— 全宽一块,阅读顺序 = 「我是谁 → 下一步 → 走到哪了 → 是什么」,本页的焦点。
			    ⚠️ `shrink-0`:本页是多张卡的纵向 flex 布局,`PageFrame` 是 `flex-1 min-h-0`;而 `Card` 自带
			    `overflow-hidden`(自动最小高度 = 0)⇒ 不加它,这张卡会被压扁到 0 高、内容与按钮全被裁掉。 */}
			<Card className="shrink-0">
				{/* 动作条:左「我的身份」,右「下一步」。状态徽章只在页头出现一次,这里不重复 */}
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3">
					<span className="text-sm text-muted-foreground">
						我的身份
						<span className="ml-1.5 text-foreground">
							{permissions.myRoles.length > 0 ? permissions.myRoles.map(roleText).join(" / ") : "旁观"}
						</span>
					</span>
					<div className="ml-auto flex flex-wrap items-center gap-2">
						{permissions.transitions.length > 0 ? (
							<>
								<span className="text-xs text-muted-foreground">下一步</span>
								{permissions.transitions.map((to) => (
									<Button
										key={to}
										size="sm"
										variant="outline"
										disabled={transitMutation.isPending}
										onClick={() => transitMutation.mutate({ id: task.id, to })}
									>
										{statusLabelOf(statuses, to)}
									</Button>
								))}
							</>
						) : (
							<span className="text-xs text-muted-foreground">
								{task.status === "pending" ? "待审批中,答复后才会解锁" : "这个状态只能靠「发起动作」推进"}
							</span>
						)}
					</div>
				</div>

				{/* 流程条:创建 → 各次改状态 / 审批 → 当前(读 tc_log,直接改状态也留痕) */}
				<div className="px-5 pt-4">
					<TaskStatusTimeline logs={logQuery.data?.items ?? []} statuses={statuses} current={task.status} />
				</div>

				<div className="space-y-4 px-5 pt-4 pb-5">
					{/* 元信息:标签在上、值在下 —— 记录头写法,比一行灰字好扫 */}
					<dl className="flex flex-wrap gap-x-10 gap-y-3">
						{[
							{ key: "creator", icon: User, label: "创建者", value: task.creatorName ?? "—" },
							{
								key: "due",
								icon: CalendarClock,
								label: "截止时间",
								value: task.dueAt ? formatLocalMinute(task.dueAt) : "未设置",
							},
							{
								key: "created",
								icon: Clock,
								label: "创建于",
								value: task.createdAt ? formatLocalMinute(task.createdAt) : "—",
							},
						].map((item) => (
							<div key={item.key} className="space-y-0.5">
								<dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<item.icon className="size-3.5 shrink-0" />
									{item.label}
								</dt>
								<dd className="text-sm text-foreground">{item.value}</dd>
							</div>
						))}
					</dl>
					{task.description ? (
						<p className="max-w-[70ch] border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground wrap-break-word">
							{task.description}
						</p>
					) : null}
				</div>
			</Card>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
				<div className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">任务内容</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4 pt-0">
							{/* 内容块按注册表渲染;未知块降级成占位,不崩(见 task-content-blocks) */}
							<TaskContentBlocks content={content} />
							<div className="space-y-2 border-t border-border pt-3">
								<span className="text-sm font-medium">附件</span>
								<TaskAttachmentList attachments={attachments} onOpen={setPreviewAttachment} />
							</div>
						</CardContent>
					</Card>
					<TaskCloseLog
						items={logQuery.data?.items ?? []}
						total={logQuery.data?.total ?? 0}
						loading={logQuery.isFetching}
						onLoadMore={() => setLogPageSize((size) => size + 20)}
						statuses={statuses}
						roleLabel={roleText}
					/>
					<TaskCloseActions
						taskId={task.id}
						currentStatus={task.status}
						statuses={statuses}
						edges={edges}
						actions={actions as ActionRow[]}
						canInitiateStatusAction={permissions.canInitiateStatusAction}
						canInitiateConsult={permissions.canInitiateConsult}
						myActionIds={myActionIds}
						handleOptions={handleOptions}
						onDone={invalidate}
					/>
					<TaskCloseComments taskId={task.id} meId={meId} canRemoveAny={permissions.isCreator} />
				</div>

				{/* 右栏只剩「成员」,拉长占满 */}
				<div className="flex flex-col">
					<Card className="flex flex-1 flex-col">
						<CardHeader className="flex-row items-center justify-between">
							<CardTitle className="text-base">成员</CardTitle>
							{permissions.canAddMember ? (
								<Button size="sm" variant="outline" onClick={() => setMemberOpen(true)}>
									<UserPlus className="size-3.5" />
									加人
								</Button>
							) : null}
						</CardHeader>
						<CardContent className="flex-1 pt-0">
							<ul className="divide-y divide-border text-sm">
								<li className="flex items-center gap-2.5 py-2">
									<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-hue-blue-soft text-[11px] font-medium text-hue-blue-fg">
										{(task.creatorName ?? "?").slice(0, 1)}
									</span>
									<span className="min-w-0 flex-1 truncate text-foreground">{task.creatorName ?? "—"}</span>
									<Badge variant="outline">创建者</Badge>
								</li>
								{members.map((member: MemberRow) => (
									<li key={`${member.userId}-${member.role}`} className="flex items-center gap-2.5 py-2">
										<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-hue-blue-soft text-[11px] font-medium text-hue-blue-fg">
											{(member.name ?? member.userId).slice(0, 1)}
										</span>
										<span className="min-w-0 flex-1 truncate text-foreground">
											{member.name ?? member.userId}
											{member.isPrimary ? <span className="ml-1 text-xs text-muted-foreground">主</span> : null}
										</span>
										<span className="flex shrink-0 items-center gap-1.5">
											<Badge variant="secondary">{roleText(member.role)}</Badge>
											{permissions.canManageMembers ? (
												<Button
													size="icon-sm"
													variant="ghost"
													aria-label="移出成员"
													disabled={memberRemoveMutation.isPending}
													onClick={() =>
														memberRemoveMutation.mutate({
															taskId: task.id,
															userId: member.userId,
															role: member.role as "participant" | "executor",
														})
													}
												>
													<Trash2 className="size-3.5" />
												</Button>
											) : null}
										</span>
									</li>
								))}
								{members.length === 0 ? (
									<li className="py-3 text-sm text-muted-foreground">还没有其他人。加人后他们能答复动作、参与讨论。</li>
								) : null}
							</ul>
						</CardContent>
					</Card>
				</div>
			</div>

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
								{/* 跟上面「人员」同高(h-8,不传 sm)同宽(w-full),两个字段才对齐 */}
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
									// 主执行人只有 executor 允许,在这里顺手带上
									isPrimary: newMemberRole === "executor",
								})
							}
						>
							{memberAddMutation.isPending ? "加入中…" : "加入"}
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

const ROLE_OPTIONS = [
	{ value: "executor", label: "执行者" },
	{ value: "participant", label: "参与者" },
];

function roleText(role: string): string {
	return ({ creator: "创建者", participant: "参与者", executor: "执行者" } as Record<string, string>)[role] ?? role;
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
