import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Paperclip } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { BlockHeader } from "#/components/modules/task-close/block-header";
import { InspectorSection } from "#/components/modules/task-close/inspector-section";
import { TaskActionList } from "#/components/modules/task-close/task-action-list";
import { TaskCard, TaskCardLink } from "#/components/modules/task-close/task-card";
import { TaskComments } from "#/components/modules/task-close/task-comments";
import { TaskAttachmentList } from "#/components/modules/task-close/task-content-attachments";
import { TaskDetailHeader } from "#/components/modules/task-close/task-detail-header";
import {
	TaskAttachDialog,
	TaskInitiateDialog,
	TaskMemberDialog,
	TaskRespondDialog,
	TaskStatusDialog,
	TaskTransferDialog,
} from "#/components/modules/task-close/task-dialogs";
import { TaskFlowSpine, TaskTodoStrip } from "#/components/modules/task-close/task-flow-spine";
import { TaskForm, type TaskFormEditing } from "#/components/modules/task-close/task-form";
import { TaskLinkBlocks } from "#/components/modules/task-close/task-link-blocks";
import { TaskLogList } from "#/components/modules/task-close/task-log";
import { TaskMembers } from "#/components/modules/task-close/task-members";
import { TaskReminders } from "#/components/modules/task-close/task-reminders";
import { TaskReport } from "#/components/modules/task-close/task-report";
import { useAttachmentPreview } from "#/components/modules/task-close/use-attachment-preview";
import { useConfirm } from "#/components/modules/task-close/use-confirm";
import { Button, buttonVariants } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError, toastApiError } from "#/lib/api/error";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { ROLE_LABEL, ROLE_WHY, statusesOf, statusLabelOf } from "#/lib/task/close-spec";
import { isForbiddenError, isNotFoundError, orderHintOf, peopleOptionsOf, todoItemsOf } from "#/lib/task/close-view";
import type { TaskAttachment, TaskPayload } from "#/lib/task/payload";

/**
 * 任务详情 —— 闭环页(按 `assets/ui/任务详情.html` 原型重画)。
 *
 * 结构(以**事项流程**为骨架;状态类动作仍在记录头右上角):
 *   ┌─ topbar (外层 shell,这里不画) ───────────────────────┐
 *   ├─ 记录头:返回 + 标题(20px)+ 一行**中性**元信息(徽章 + 日期)  ┤
 *   │         + 描述 + 右上动作组(ⓘ 转交 征询 审批 改状态 编辑 删除 刷新)┤
 *   ├─ 流程脊(全宽):模板状态链,标出走过的 / 当前 / 未到 + 到达时刻   ┤
 *   ├─ 轮到你(有我的待办才出现):审批就地 通过/驳回;征询就地 回复(意见落评论)┤
 *   └─ main: 左 画布(内容 / 附件 / 评论) + 右 检查器(人员 / 动态)┘
 *
 * 状态类按钮(发起审批 / 改状态)按用户要求**留在右上角**,但成不成、有几个候选仍由
 * `permissions` 派生:
 *   · 发起审批 —— `permissions.actionTargets`(模板里当前状态出发、我有权发起的 `via=action` 边);
 *     取**第一条**,在弹窗里确认目标状态并选「交给谁」,提交 `actionCreate`(带目标状态 → 任务锁定)。
 *   · 改状态 —— 所有用户只列服务端返回的 `permissions.transitions`。
 *     提交 `taskTransit`。
 *   · 锁定期(`permissions.locked`,由审批动作决定)两个按钮都不出现 —— 与服务端锁守卫同形。
 *
 * 与状态无关的动作同样在右上角:转交(选成员 → `taskTransfer`)、发起征询(选成员 →
 * `actionCreate({toStatus: null})`)、编辑 / 删除 / 刷新,外加一颗 ⓘ 解释器。
 *
 * 视觉:色相只留三处 —— `primary`(在跑的状态节点 / 人头像)、`warn`(等你答复 / 锁定)、
 * 优先级三色(只在徽章圆点上出现一次);其余一律中性。人员头像与评论头像**同色**(`bg-primary`)。
 * 虚线(`border-dashed`)只画在「标签与其内容之间」与记录头底部;脊的连线用实线 + 箭头。
 * 列表行用 hover 底色代替行分隔线;输入框描边、内容表格的框、附件 chip 的框保留(控件 / 容器边界)。
 */
export function TaskDetailPage({ taskId }: { taskId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	/** 当前打开的表单弹窗(编辑 / 删任务 / 加成员 / 附件)—— 一个开关,不再一个弹窗一个 boolean */
	const [dialog, setDialog] = useState<"edit" | "remove" | "member" | "attach" | null>(null);
	const editPayloadBaseline = useRef<TaskPayload | null>(null);
	const [reminderRecipient, setReminderRecipient] = useState<{ id: string; name: string } | null>(null);
	/** 附件弹窗里的待提交附件(随 `task.payload.attachments` 走) */
	const [draftAttachments, setDraftAttachments] = useState<TaskAttachment[]>([]);
	const attachmentBaseline = useRef<string[]>([]);
	/**
	 * 加入成员:**一律按参与者加**。执行人只在「建任务」时定,之后换人只走「转交执行人」。
	 * (fan-out 任务的父任务,执行人是创建人,见 `taskCreate`;这里不需要角色选择。)
	 */
	const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
	/** 待确认移出的成员 —— 存下 userId / 姓名,关掉弹窗后这些数据没有别的来源 */
	const removeMember = useConfirm<{ userId: string; name: string }>();
	/** 「发起审批 / 发起征询」共用弹窗:`mode` 非空即打开(目标状态由流程自动判定,不让人选) */
	const [actionMode, setActionMode] = useState<"approve" | "consult" | null>(null);
	/** 交给谁 —— 多选,**选择顺序就是处理顺序**(第一个人先办,后面依次) */
	const [actionAssignees, setActionAssignees] = useState<string[]>([]);
	const [consultMode, setConsultMode] = useState<"serial" | "parallel">("serial");
	/** 转交弹窗:转给谁(null = 未打开) */
	const [transferTo, setTransferTo] = useState<string | null>(null);
	/** 「改状态」弹窗:选择允许的直接转移(null = 未打开) */
	const [statusTo, setStatusTo] = useState<string | null>(null);
	/** 答复弹窗:通过 / 驳回共用一套(意见可选;驳回必须写原因,服务端也会拒空的) */
	const [respond, setRespond] = useState<{ approved: boolean; id: string; reason: string } | null>(null);
	/** 正在预览的附件(开弹窗看 / 下载) */
	const preview = useAttachmentPreview<TaskAttachment>(taskId);
	/** 动态一次取多少条(分页由 PaginationControl 管) */
	const [logPage, setLogPage] = useState(1);

	const detailQuery = useQuery(trpc.taskClose.taskGet.queryOptions({ id: taskId }));
	const usersQuery = useQuery(trpc.user.list.queryOptions());
	// 活动日志(`tc_log`):同一批 items 既画右栏「流程动态」里的「事件」段落,流程状态也由它派生
	const logQuery = useQuery(trpc.taskClose.logList.queryOptions({ taskId, page: logPage, pageSize: 20 }));

	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());

	/** 「发起审批 / 发起征询」—— 同一个接口:`toStatus` 有值 = 审批(锁任务),为空 = 征询 */
	const actionMutation = useMutation(
		trpc.taskClose.actionCreate.mutationOptions({
			onSuccess: async (_data, variables) => {
				await invalidate();
				setActionMode(null);
				setActionAssignees([]);
				toast.success(variables.toStatus ? "已发起审批" : "已发起征询");
			},
			onError: toastApiError,
		}),
	);

	/** 转交执行人 */
	const transferMutation = useMutation(
		trpc.taskClose.taskTransfer.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setTransferTo(null), message: () => "已转交" }),
			onError: toastApiError,
		}),
	);

	/** 「改状态」—— 沿模板直接转移边执行 */
	const transitMutation = useMutation(
		trpc.taskClose.taskTransit.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setStatusTo(null), message: () => "状态已更新" }),
			onError: toastApiError,
		}),
	);

	/** 答复动作(通过 / 驳回)—— 只有指派人本人能答;驳回要写原因(服务端也会拒空的) */
	const viewMutation = useMutation(trpc.taskClose.actionView.mutationOptions({ onError: toastApiError }));
	const respondMutation = useMutation(
		trpc.taskClose.actionRespond.mutationOptions({
			onSuccess: async (_data, variables) => {
				await invalidate();
				setRespond(null);
				toast.success(variables.approved ? "已通过" : "已驳回");
			},
			onError: toastApiError,
		}),
	);

	/** 回复征询 —— 意见(+附件)落成一条评论,征询动作即算处理完(不做"通过 / 驳回"判卷) */
	const replyMutation = useMutation(
		trpc.taskClose.actionReply.mutationOptions({
			onSuccess: writeSuccess(invalidate, { message: () => "意见已回复,进了评论区" }),
			onError: toastApiError,
		}),
	);

	const updateMutation = useMutation(
		trpc.taskClose.taskUpdate.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setDialog(null), message: () => "已保存" }),
			onError: toastApiError,
		}),
	);

	/** 附件弹窗专用保存 —— 只改 `payload.attachments`(任务相关方都能加;链接 / 说明服务端原样保留) */
	const attachMutation = useMutation(
		trpc.taskClose.taskAttach.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setDialog(null), message: () => "附件已更新" }),
			onError: toastApiError,
		}),
	);

	const removeMutation = useMutation(
		trpc.taskClose.taskRemove.mutationOptions({
			onSuccess: () => {
				setDialog(null);
				toast.success("任务已删除");
				void queryClient.invalidateQueries({ ...trpc.taskClose.pathFilter(), refetchType: "none" });
				void navigate({ to: "/task-close", replace: true });
			},
			onError: toastApiError,
		}),
	);

	const memberAddMutation = useMutation(
		trpc.taskClose.memberAdd.mutationOptions({
			onSuccess: writeSuccess(invalidate),
			onError: toastApiError,
		}),
	);

	const addMembers = async () => {
		const ids = [...newMemberIds];
		if (ids.length === 0 || memberAddMutation.isPending) return;
		try {
			await memberAddMutation.mutateAsync({ taskId: task.id, userIds: ids });
			setDialog(null);
			setNewMemberIds([]);
			toast.success(`已加入 ${ids.length} 位成员`);
		} catch {
			// onError 已提示，保留选择供修正后重试。
		}
	};

	const memberRemoveMutation = useMutation(
		trpc.taskClose.memberRemove.mutationOptions({
			onSuccess: writeSuccess(invalidate),
			onError: toastApiError,
		}),
	);

	const userOptions = useMemo(
		() => (usersQuery.data ?? []).map((row) => ({ value: row.id, label: row.name })),
		[usersQuery.data],
	);

	/** 这条 id 在库里已经不存在了(被删 / 别人删了 / 手输错了) */
	const taskMissing = detailQuery.isError && isNotFoundError(detailQuery.error);
	/** 不是任务相关方(直接访问别人的任务 URL 也走这条) */
	const taskForbidden = detailQuery.isError && isForbiddenError(detailQuery.error);
	const bouncedRef = useRef(false);

	// 不存在 / 没权限都不留错误页:提示一声就回「我的任务」(replace —— 这条 URL 不该再进历史)
	useEffect(() => {
		if (!(taskMissing || taskForbidden) || bouncedRef.current) return;
		bouncedRef.current = true;
		toast.error(taskForbidden ? "权限不足,已回到我的任务" : "任务不存在或已删除,已回到我的任务");
		void navigate({ to: "/task-close", replace: true });
	}, [taskMissing, taskForbidden, navigate]);

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
				<div className="grid justify-items-center gap-3 py-12 text-center text-sm text-muted-foreground">
					<p>{toApiError(detailQuery.error).message}</p>
					{/* 错误是恢复路径:先给「重试」(网络抖动不该逼人回列表),再给回列表 */}
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" disabled={detailQuery.isFetching} onClick={() => detailQuery.refetch()}>
							{detailQuery.isFetching ? "重试中…" : "重试"}
						</Button>
						<Link to="/task-close" className={buttonVariants({ variant: "ghost", size: "sm" })}>
							返回我的任务
						</Link>
					</div>
				</div>
			</PageFrame>
		);
	}

	const { task, links, attachments, own, children, members, permissions, meId } = detailQuery.data;
	const myPendingActions = detailQuery.data.actions.filter((row) => row.status === "active" && row.assigneeId === meId);
	const myRole = permissions.isAdmin
		? "admin"
		: task.creatorId === meId
			? "creator"
			: task.executorId === meId
				? "executor"
				: members.some((member) => member.userId === meId)
					? "participant"
					: null;
	/** `payload.type` 编辑界面不管它,但保存时**必须原样带回**(`taskUpdate` 整块替换 payload) */
	const payloadType = (task.payload as { type?: string } | null)?.type;
	// 状态图快照:状态清单(value+label)从这里取(展示一律用 label)
	const statuses = statusesOf(task.workflow);
	/** 本页所有「状态 value → 展示名」都走它,不再各写一遍闭包 */
	const statusLabel = (value: string) => statusLabelOf(statuses, value);

	/** 被驳回过的审批边(`from->to`)—— 流程脊在箭头上挂小红章,"这一步被批回过"一眼可见 */
	const rejectedEdges = new Set(
		detailQuery.data.actions
			.filter((row) => row.status === "rejected" && row.fromStatus && row.toStatus)
			.map((row) => `${row.fromStatus}->${row.toStatus}`),
	);

	/**
	 * 「发起审批」的目标状态 —— **由服务端算好**(`permissions.actionTargets`,只含模板里当前状态出发、
	 * 且我有权发起的 `via=action` 边)。前端不自己解释 `who` / `edges`;取第一条。
	 */
	const actionTargetOptions = permissions.actionTargets.map((value) => ({ value, label: statusLabel(value) }));

	/**
	 * 「改状态」的候选由 `permissions.transitions` 提供(模板里他能直改的那几条 `direct` 边)。
	 * 按钮先取第一条预填,弹窗里仍可改选。
	 */
	const statusOptions = permissions.transitions.map((value) => ({ value, label: statusLabel(value) }));

	/**
	 * 状态类按钮的候选 —— **全部由服务端 permissions 派生**,前端不自己解释 who / edges:
	 *   · `actionTargets` → 发起审批(会锁任务,还要选交给谁);
	 *   · `transitions` → 直接改。
	 * 锁定期(`permissions.locked`)两个按钮都不出现 —— 与服务端锁守卫同形。
	 *
	 * 位置:回到**记录头右上角**的动作组(用户要求)。流程脊只画状态,不放动作。
	 */
	const canApprove = !permissions.locked && actionTargetOptions.length > 0;
	const canSetStatus = !permissions.locked && statusOptions.length > 0;
	/** 更多▾ 里有没有内容(转交 / 发起审批在场时降级的改状态 / 编辑 / 删除) */
	const hasMoreActions = permissions.canTransfer || (canSetStatus && canApprove) || permissions.canManage;

	/**
	 * 走过的状态 + 首次到达时刻 —— 读活动日志里 `toStatus` 非空的行(与流程条同源)。
	 * 日志是倒序,翻正序后每个状态取**首次**那条;当前态也会命中,所以它自带"什么时候到的"。
	 */
	const reachedAt = new Map<string, string>();
	for (const item of detailQuery.data.reached) {
		if (item.status && item.at) reachedAt.set(item.status, item.at);
	}

	/** 「轮到你了」的待办 —— 指给我的、还没结的动作;`toStatus` 为空 = 征询(不摊通过 / 驳回) */
	const todoItems = todoItemsOf(myPendingActions, detailQuery.data.actions, statuses);

	/**
	 * 头部那颗 ⓘ 的文案 —— 把「当前身份 + 事项流程给这个身份的边」摊开,让用户自己核对按钮为什么是这几个。
	 * 只是解释规则,不代替服务端授权(真正的拦截在 resolver 里)。
	 */
	const roleLabel = ROLE_LABEL[myRole ?? ""] ?? "旁观";
	const roleWhy = ROLE_WHY[myRole ?? ""] ?? ROLE_WHY.viewer;
	const tipLines = [
		`状态:${statusLabel(task.status)}`,
		`发起审批:${actionTargetOptions.length > 0 ? `→ ${actionTargetOptions.map((option) => option.label).join(" / ")}` : "无"}`,
		`直接更改状态:${statusOptions.length > 0 ? `→ ${statusOptions.map((option) => option.label).join(" / ")}` : "无"}`,
		...(permissions.locked ? ["任务被审批动作锁住,状态类按钮暂不可用"] : []),
	];

	/**
	 * 答复人 / 转交候选人 = **任务内的人**:创建人 + 参与者 + 执行人(右侧标出角色)。
	 * 不能选自己 —— 管理员除外(管理员本来就什么都能做)。父任务要找人,先自己加参与者。
	 */
	const peopleOptions = peopleOptionsOf({
		creatorId: task.creatorId,
		creatorName: task.creatorName,
		executorId: task.executorId,
		executorName: task.executorName,
		members,
		meId,
		isAdmin: permissions.isAdmin,
	});
	/** 转交目标只能是**成员**(创建者不在 `tc_member` 里,服务端会拒) */
	const transferOptions = peopleOptions.filter((option) => option.value !== task.creatorId);

	/**
	 * 编辑态回填 —— **只取这条任务自己的内容**,不把父子并集克隆进表单(存回去会写坏别人的数据)。
	 */
	const editing: TaskFormEditing = {
		id: task.id,
		name: task.name,
		description: task.description,
		dueAt: task.dueAt,
		priority: task.priority,
		links: own.links,
		attachments: own.attachments,
		reminderConfig: task.reminderConfig,
	};

	/**
	 * 审批 / 征询的先后顺序说明 —— 审批挂在「目标状态」下面(先看清路径),征询挂在「交给谁」下面。
	 * 文案走人话:谁先谁后、最后落在哪。
	 */
	const order = orderHintOf(actionMode, actionAssignees, peopleOptions, actionTargetOptions[0]?.label);
	const orderHint =
		order.names.length === 0 ? (
			<p className="text-xs text-muted-foreground">{order.text}</p>
		) : (
			<div className="grid gap-1">
				<ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					{order.names.map((name, index) => (
						<li key={actionAssignees[index]} className="inline-flex items-center gap-1">
							<span className="inline-flex size-4 items-center justify-center rounded-full bg-muted font-medium text-foreground tabular-nums">
								{index + 1}
							</span>
							<span className="text-foreground">{name}</span>
							{index < order.names.length - 1 ? <span aria-hidden>→</span> : null}
						</li>
					))}
				</ol>
				<p className="text-xs text-muted-foreground">{order.text}</p>
			</div>
		);

	return (
		<div className="mx-auto flex w-full flex-col bg-card">
			{/* ─── 记录头(降级:不再是 24px 巨标题 + 彩色胶囊) ─────────────── */}
			<TaskDetailHeader
				task={task}
				roleLabel={roleLabel}
				roleWhy={roleWhy}
				tipLines={tipLines}
				canApprove={canApprove}
				canConsult={permissions.canInitiateConsult}
				canSetStatus={canSetStatus}
				statusOptions={statusOptions}
				hasMoreActions={hasMoreActions}
				canTransfer={permissions.canTransfer}
				canManage={permissions.canManage}
				showRefresh={myRole !== null}
				refreshing={detailQuery.isFetching}
				onApprove={() => {
					setActionAssignees([]);
					setActionMode("approve");
				}}
				onConsult={() => {
					setActionAssignees([]);
					setActionMode("consult");
				}}
				onSetStatus={(value) => setStatusTo(value)}
				onTransfer={() => setTransferTo("")}
				onEdit={() => {
					editPayloadBaseline.current = (task.payload as TaskPayload | null) ?? null;
					setDialog("edit");
				}}
				onRemove={() => setDialog("remove")}
				onRefresh={() => {
					void detailQuery.refetch();
				}}
			/>

			{/* ─── 流程脊 —— 只画状态(走到哪了);动作在右上角动作组 ─────────────── */}
			<section className="grid gap-3 px-8 pt-5">
				<h2 className="text-xs font-semibold tracking-wide text-muted-foreground">事项流程</h2>
				<TaskFlowSpine
					statuses={statuses}
					current={task.status}
					visited={new Set(reachedAt.keys())}
					reachedAt={reachedAt}
					rejectedEdges={rejectedEdges}
					locked={permissions.locked}
				/>
			</section>

			{/* ─── 轮到你了 —— 动作条:审批就地「通过 / 驳回」;征询就地「回复」(意见落成评论) ─── */}
			{myPendingActions.length > 0 ? (
				<section className="px-8 pt-3">
					<TaskTodoStrip
						items={todoItems}
						busy={respondMutation.isPending}
						replyBusy={replyMutation.isPending}
						// @选单候选 = 成员名册(创建者 + 成员,去掉自己);taskGet 同键缓存,零额外请求
						participants={[
							{ id: task.creatorId, name: task.creatorName ?? "" },
							...members.map((member) => ({ id: member.userId, name: member.name ?? "" })),
						].filter((person) => person.id !== meId && person.name)}
						onView={async (id) => {
							await viewMutation.mutateAsync({ id });
							await invalidate();
						}}
						onApprove={(id) => setRespond({ approved: true, id, reason: "" })}
						onReject={(id) => setRespond({ approved: false, id, reason: "" })}
						onReply={(id, content, attachments, mentionIds) =>
							replyMutation.mutate({ id, content, attachments, mentionIds })
						}
					/>
				</section>
			) : null}

			{/* ─── main:左 画布(链接 / 附件 / 评论)+ 右 检查器(人员 / 动态) ───────── */}
			<main className="grid gap-6 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
				{/* 左 main */}
				<section className="grid gap-6 min-w-0">
					{/* 子任务(fan-out 出来的):点卡片进那条子任务自己的详情 */}
					{children.length > 0 ? (
						<section className="grid gap-3">
							<BlockHeader title="子任务" count={children.length} />
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{children.map((child) => (
									<TaskCardLink key={child.id} task={child} className="block h-48">
										<TaskCard task={child} statusLabel={statusLabel} />
									</TaskCardLink>
								))}
							</div>
						</section>
					) : null}

					{/* 任务链接 */}
					<section className="grid gap-3">
						<BlockHeader title="任务链接" dashed />
						<TaskLinkBlocks links={links} />
					</section>

					{permissions.isParticipant && <TaskReport taskId={task.id} />}

					{/* 附件 block */}
					<section className="grid gap-3 pt-6">
						<BlockHeader
							title="附件"
							count={attachments.length}
							actions={
								myRole !== null ? (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											attachmentBaseline.current = own.attachmentIds;
											setDraftAttachments(own.attachments);
											setDialog("attach");
										}}
									>
										<Paperclip className="size-3.5" aria-hidden />
										新增附件
									</Button>
								) : null
							}
						/>
						<TaskAttachmentList attachments={attachments} onOpen={preview.preview} />
					</section>

					{/* 评论与回复 block —— TaskComments 自带输入 + 嵌套 thread */}
					<section className="grid gap-3 pt-6">
						<BlockHeader title="评论与回复" id="tc-comments-title" />
						{/* 删评论:只有作者本人;`canRemoveAny` 只给管理员(创建者也不能删别人的) */}
						<TaskComments
							taskId={task.id}
							meId={meId}
							participants={[
								{ id: task.creatorId, name: task.creatorName ?? "" },
								...members.map((member) => ({ id: member.userId, name: member.name ?? "" })),
							].filter((person) => person.id !== meId && person.name)}
							canRemoveAny={myRole === "admin"}
							labelledBy="tc-comments-title"
						/>
					</section>
				</section>

				{/* 右 检查器 —— 两块合成**一张面板**:内部用 inset 细线分组,不再每块各画一条虚线 */}
				<aside className="sticky top-18 self-start">
					<div className="overflow-hidden rounded-[10px] border border-border bg-card">
						{/* 参与人 —— 创建人 + 成员,所以不叫「成员」 */}
						<TaskMembers
							creatorId={task.creatorId}
							creatorName={task.creatorName ?? null}
							executorId={task.executorId}
							executorName={task.executorName ?? null}
							members={members}
							canAddMember={permissions.isParticipant}
							canManage={permissions.canManage}
							removing={memberRemoveMutation.isPending}
							onAdd={() => setDialog("member")}
							onRemove={removeMember.ask}
							onRemind={myRole !== null ? setReminderRecipient : undefined}
						/>

						{myRole !== null && (
							<TaskReminders
								taskId={task.id}
								recipient={reminderRecipient}
								onClose={() => setReminderRecipient(null)}
							/>
						)}

						{/* 动作记录:只列还活着、且我能撤回的 —— 判据与服务端 `isActionCreatorOrAdmin` 同口径 */}
						<TaskActionList
							actions={detailQuery.data.actions.filter(
								(action) => action.status === "active" && (permissions.canManage || meId === action.creatorId),
							)}
						/>

						{/* 动态 —— 事件流(状态史由上方流程脊承担,这里不重复) */}
						<InspectorSection>
							<BlockHeader title="动态" />
							<TaskLogList
								items={logQuery.data?.items ?? []}
								statuses={statuses}
								loading={logQuery.isPending}
								error={logQuery.isError ? logQuery.error : undefined}
								onRetry={() => logQuery.refetch()}
							/>
							<PaginationControl
								page={logPage}
								pageSize={20}
								total={logQuery.data?.total ?? 0}
								onPageChange={setLogPage}
							/>
						</InspectorSection>
					</div>
				</aside>
			</main>

			<TaskForm
				open={dialog === "edit"}
				onOpenChange={(next) => {
					if (!next) setDialog(null);
				}}
				pending={updateMutation.isPending}
				editing={editing}
				userOptions={userOptions}
				onEdit={(payload) =>
					updateMutation.mutate({
						id: task.id,
						name: payload.name,
						description: payload.description,
						dueAt: payload.dueAt,
						priority: payload.priority,
						reminderConfig: payload.reminderConfig,
						payload: { type: payloadType, links: payload.links, attachments: payload.attachments },
						expectedPayload: editPayloadBaseline.current,
					})
				}
			/>

			<ConfirmDialog
				open={dialog === "remove"}
				onOpenChange={(next) => {
					if (!next) setDialog(null);
				}}
				title="删除任务"
				description={`「${task.name}」会被软删,动作与评论一并不可见。`}
				isPending={removeMutation.isPending}
				onConfirm={() => removeMutation.mutate({ id: task.id })}
			/>

			{/* 移出成员 —— 破坏性操作,先确认 */}
			<removeMember.Dialog
				title="移出成员"
				description={(t) =>
					`把「${t.name || PLACEHOLDER_EMPTY}」从这条任务移出?TA 将失去推进 / 答复的权限(已发的评论与历史保留)。`
				}
				isPending={memberRemoveMutation.isPending}
				confirmText="移出"
				pendingText="移出中…"
				onConfirm={(t) =>
					memberRemoveMutation.mutate({ taskId: task.id, userId: t.userId }, { onSuccess: removeMember.dismiss })
				}
			/>

			<TaskStatusDialog
				open={statusTo !== null}
				onOpenChange={(next) => {
					if (!next) setStatusTo(null);
				}}
				pending={transitMutation.isPending}
				value={statusTo ?? ""}
				onValueChange={setStatusTo}
				options={statusOptions}
				onConfirm={() => {
					if (statusTo) transitMutation.mutate({ id: task.id, to: statusTo });
				}}
			/>

			{/* 转交执行人 —— 选一位成员,原执行人自动降为参与者 */}
			<TaskTransferDialog
				open={transferTo !== null}
				onOpenChange={(next) => {
					if (!next) setTransferTo(null);
				}}
				pending={transferMutation.isPending}
				value={transferTo ?? ""}
				onValueChange={setTransferTo}
				options={transferOptions}
				onConfirm={() => {
					if (transferTo) transferMutation.mutate({ taskId: task.id, userId: transferTo });
				}}
			/>

			<TaskInitiateDialog
				mode={actionMode}
				onClose={() => setActionMode(null)}
				pending={actionMutation.isPending}
				assignees={actionAssignees}
				onAssigneesChange={setActionAssignees}
				consultMode={consultMode}
				onConsultModeChange={setConsultMode}
				targetOptions={actionTargetOptions}
				peopleOptions={peopleOptions}
				orderHint={orderHint}
				onConfirm={() =>
					actionMutation.mutate({
						taskId: task.id,
						toStatus: actionMode === "approve" ? (actionTargetOptions[0]?.value ?? null) : null,
						assigneeId: actionAssignees[0] ?? "",
						nextAssigneeIds: actionAssignees.slice(1),
						flowMode: actionMode === "consult" ? consultMode : "serial",
					})
				}
			/>

			<TaskMemberDialog
				open={dialog === "member"}
				onOpenChange={(next) => {
					setDialog(next ? "member" : null);
					if (!next) setNewMemberIds([]);
				}}
				pending={memberAddMutation.isPending}
				value={newMemberIds}
				onChange={setNewMemberIds}
				options={userOptions.filter(
					(person) => person.value !== task.creatorId && !members.some((member) => member.userId === person.value),
				)}
				onConfirm={() => void addMembers()}
			/>

			<TaskAttachDialog
				open={dialog === "attach"}
				onOpenChange={(next) => {
					if (!next) setDialog(null);
				}}
				pending={attachMutation.isPending}
				value={draftAttachments}
				onChange={setDraftAttachments}
				onConfirm={() =>
					attachMutation.mutate({
						id: task.id,
						attachments: draftAttachments.map((file) => file.id),
						expectedAttachments: attachmentBaseline.current,
					})
				}
			/>

			<TaskRespondDialog
				approved={respond?.approved ?? true}
				open={respond !== null}
				onClose={() => setRespond(null)}
				pending={respondMutation.isPending}
				reason={respond?.reason ?? ""}
				onReasonChange={(reason) => setRespond((prev) => (prev ? { ...prev, reason } : prev))}
				onConfirm={() => {
					if (!respond) return;
					respondMutation.mutate(
						{ id: respond.id, approved: respond.approved, reason: respond.reason.trim() || null },
						{ onSuccess: () => setRespond(null) },
					);
				}}
			/>
			{preview.dialog}
		</div>
	);
}
