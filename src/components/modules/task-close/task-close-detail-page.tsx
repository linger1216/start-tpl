import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowLeft,
	CalendarClock,
	Clock,
	Flag,
	Info,
	Paperclip,
	Pencil,
	Send,
	Trash2,
	UserPlus,
} from "lucide-react";
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
import { TaskContentBlocks } from "#/components/modules/task-close/task-content-blocks";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";
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
 * 头部动作按钮(`@assets/ui/任务详情.html` 原型 + **按事项流程派生**,见下方 `canApprove` / `canSetStatus`):
 *   · 发起审批 —— 弹窗选**目标状态** + 「交给谁」。状态只列 `permissions.actionTargets`
 *     (模板里当前状态出发、我又有权发起的 `via=action` 边;多个就选),提交 `actionCreate`(带目标状态 → 任务锁定)。
 *   · 改状态 —— **直接改**。非管理员只列 `permissions.transitions`(模板里我能直改的 `direct` 边);
 *     **管理员例外**,列模板里的全部状态。提交 `taskTransit`。
 *   · 发起征询 —— 只选「交给谁」,提交 `actionCreate`(`toStatus = null`,不改状态、不锁任务)。
 *   · 转交 —— 弹窗从**参与人员**里选一人,提交 `taskTransfer`(原子换人:新人当执行人,原执行人降为参与者)。
 *   锁定期(`permissions.locked`,即状态 = `pending`)「发起审批 / 改状态」都不显示 —— 与服务端锁守卫一致。
 *
 * 视觉:一条**虚线系统**(`border-dashed border-border`),位置固定为「**标题 / 标签与其内容之间**」——
 * ① 任务头**只画一条**:标题块的 `border-b`(标题 + 动作组,与下面那排元信息胶囊之间);
 * ② 除「任务内容」外,每个区块(附件 / 评论与回复 / 参与人员 / 流程动态)标题文字下方的 `border-b`
 *    —— 任务内容紧跟在任务头之后,再画就与①叠成两条,故**不画**。
 * 不再画「区块与区块之间」的额外分隔线;列表行用 hover 底色代替行分隔线。
 * 保留:输入框描边、内容表格的框、附件 chip 的框 —— 那是控件 / 容器边界,不是分割线。
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
	/**
	 * 待确认移出的成员 —— 移出是破坏性操作,先弹 `ConfirmDialog`(非空即打开)。
	 * 存下 userId / role / 姓名:关掉弹窗后这些数据就没有别的来源了。
	 */
	const [pendingRemoveMember, setPendingRemoveMember] = useState<{
		userId: string;
		role: "participant" | "executor";
		name: string;
	} | null>(null);
	/** 「发起审批 / 发起征询」共用弹窗:`mode` 非空即打开(审批多一步选目标状态) */
	const [actionMode, setActionMode] = useState<"approve" | "consult" | null>(null);
	/** 弹窗里选的:目标状态(审批用)+ 交给谁 */
	const [actionTo, setActionTo] = useState("");
	const [actionHandle, setActionHandle] = useState("");
	/** 转交弹窗:转给谁 */
	const [transferOpen, setTransferOpen] = useState(false);
	const [transferTo, setTransferTo] = useState("");
	/** 管理员「改状态」弹窗:直接跳到模板里的任意状态 */
	const [statusOpen, setStatusOpen] = useState(false);
	const [statusTo, setStatusTo] = useState("");
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

	/** 「发起审批 / 发起征询」—— 同一个接口:`toStatus` 有值 = 审批(锁任务),为空 = 征询 */
	const actionMutation = useMutation(
		trpc.taskClose.actionCreate.mutationOptions({
			onSuccess: async (_data, variables) => {
				await invalidate();
				setActionMode(null);
				toast.success(variables.toStatus ? "已发起审批" : "已发起征询");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	/** 转交执行人 */
	const transferMutation = useMutation(
		trpc.taskClose.taskTransfer.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setTransferOpen(false);
				toast.success("已转交");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	/** 管理员「改状态」—— 直接跳到模板里的任意状态(服务端对管理员开了旁路) */
	const transitMutation = useMutation(
		trpc.taskClose.taskTransit.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setStatusOpen(false);
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

	/**
	 * 我在任务里的角色(admin / creator / executor / participant / null) —— **只给与状态无关的按钮**用。
	 *
	 * 与状态有关的两个按钮**不在这里判**:它们按「事项流程」(任务快照的模板)派生,见下面的
	 * `canApprove` / `canSetStatus` —— 「发起审批」看当前状态有没有我能发起的 action 边,
	 * 「改状态」看我能直改的 direct 边(只有管理员例外,可任意状态)。这样换模板不用改前端。
	 *
	 * 非状态按钮的角色口径(用户给定):
	 *   · 管理员(admin)           → 转交 / 发起征询 / 编辑 / 删除 / 刷新
	 *   · 创建者(creator)         → 发起征询 / 编辑 / 删除 / 刷新
	 *   · 执行者(executor)        → 转交 / 发起征询 / 刷新
	 *   · 参与者(participant)    → 发起征询 / 刷新
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

	const { task, content, attachments, members, permissions, meId } = detailQuery.data;
	// 状态图快照:状态清单(value+label)从这里取(展示一律用 label)
	const workflow = task.workflow as { statuses?: WorkflowStatus[]; initial?: string } | null;
	const statuses = workflow?.statuses ?? [];

	/**
	 * 「发起审批」的候选状态 —— **由服务端算好**(`permissions.actionTargets`,只含模板里当前状态出发、
	 * 且我有权发起的 `via=action` 边)。前端不自己解释 `who` / `edges`(见 doc/task-close.md「按钮级授权」)。
	 */
	const actionTargetOptions = permissions.actionTargets.map((value) => ({
		value,
		label: statusLabelOf(statuses, value),
	}));

	/**
	 * 「改状态」(直接改)的候选 —— **按事项流程派生**,不写死角色:
	 *   · 管理员 → 模板里的**全部**状态(去掉当前态);
	 *   · 其他角色 → `permissions.transitions`,即模板里他能直改的那几条 `direct` 边。
	 * 锁定期(`permissions.locked`)两个状态类按钮都关掉 —— 服务端的锁守卫对管理员同样生效。
	 */
	const statusOptions = (
		permissions.isAdmin
			? statuses.map((status) => ({ value: status.value, label: status.label }))
			: permissions.transitions.map((value) => ({ value, label: statusLabelOf(statuses, value) }))
	).filter((option) => option.value !== task.status);
	const canSetStatus = !permissions.locked && statusOptions.length > 0;

	/** 「发起审批」按钮:有可发起的 action 边、且没被锁 */
	const canApprove = !permissions.locked && actionTargetOptions.length > 0;

	/**
	 * 头部那颗 ⓘ 的文案 —— 把「当前身份 + 事项流程给这个身份的边」摊开,让用户自己核对按钮为什么是这几个。
	 * 只是解释规则,不代替服务端授权(真正的拦截在 resolver 里)。
	 */
	const roleLabel = ROLE_LABEL[myRole ?? ""] ?? "旁观";
	const roleWhy = ROLE_WHY[myRole ?? ""] ?? ROLE_WHY.viewer;
	const tipLines = [
		`状态:${statusLabelOf(statuses, task.status)}`,
		`发起审批:${actionTargetOptions.length > 0 ? `→ ${actionTargetOptions.map((option) => option.label).join(" / ")}` : "无"}`,
		`直接改状态:${
			permissions.isAdmin
				? "任意状态(管理员)"
				: statusOptions.length > 0
					? `→ ${statusOptions.map((option) => option.label).join(" / ")}`
					: "无"
		}`,
		...(permissions.locked ? ["任务被审批动作锁住,状态类按钮暂不可用"] : []),
	];

	/** 答复人 / 转交候选人 = 创建人 + 全部成员(去重;去掉自己 —— 不能指派给自己) */
	const peopleOptions = (() => {
		const list = [
			{ value: task.creatorId, label: task.creatorName ?? "创建人" },
			...members.map((row) => ({ value: row.userId, label: row.name ?? row.userId })),
		];
		const seen = new Set<string>();
		return list.filter((option) => {
			if (option.value === meId || seen.has(option.value)) return false;
			seen.add(option.value);
			return true;
		});
	})();
	/** 转交目标只能是**成员**(创建者不在 `tc_member` 里,服务端会拒) */
	const transferOptions = peopleOptions.filter((option) => option.value !== task.creatorId);

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
			<header className="bg-background">
				<div className="px-8 pt-4 pb-5">
					{/* 顶部左上:返回按钮(用户要求「顶部左上角」) */}
					<div className="mb-2.5">
						<Link to="/task-close">
							<Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground">
								<ArrowLeft className="size-3.5" />
								返回我的任务
							</Button>
						</Link>
					</div>

					<div className="border-b border-dashed border-border grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
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

						{/* 右上动作组 —— 与状态有关的按钮按事项流程派生,其余按身份(见上文 `myRole` / `canApprove` / `canSetStatus`) */}
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
										<p className="mt-1 text-[11px] leading-relaxed opacity-90">{roleWhy}</p>
										<ul className="mt-1.5 grid gap-0.5 text-[11px] leading-relaxed opacity-90">
											{tipLines.map((line) => (
												<li key={line}>{line}</li>
											))}
										</ul>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							{can.transfer ? (
								<Button
									variant="outline"
									size="sm"
									title="把执行人身份交给另一位参与人员"
									disabled={transferOptions.length === 0}
									onClick={() => {
										setTransferTo("");
										setTransferOpen(true);
									}}
								>
									转交
								</Button>
							) : null}
							{can.consult ? (
								<Button
									variant="outline"
									size="sm"
									title="请某位参与人员给意见(不改状态、不锁任务)"
									disabled={peopleOptions.length === 0}
									onClick={() => {
										setActionTo("");
										setActionHandle("");
										setActionMode("consult");
									}}
								>
									发起征询
								</Button>
							) : null}
							{/* 「发起审批」—— 按事项流程派生:当前状态有我能发起的 action 边才出现 */}
							{canApprove ? (
								<Button
									variant="outline"
									size="sm"
									title="发起审批;任务会锁定,等对方答复"
									disabled={peopleOptions.length === 0}
									onClick={() => {
										setActionTo(actionTargetOptions[0]?.value ?? "");
										setActionHandle("");
										setActionMode("approve");
									}}
								>
									发起审批
								</Button>
							) : null}
							{/* 「改状态」—— 按事项流程派生:管理员任意状态;其他角色只有模板里他能直改的那几条 */}
							{canSetStatus ? (
								<Button
									variant="outline"
									size="sm"
									title={permissions.isAdmin ? "直接把任务改到任意状态(管理员)" : "按事项流程直接改状态"}
									onClick={() => {
										setStatusTo("");
										setStatusOpen(true);
									}}
								>
									改状态
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

					{/* meta-line:任务头那唯一一条虚线在「标题块」的 `border-b` 上(这里不再重复画),以下是三条胶囊化元信息 */}
					<ul className="mt-4 flex flex-wrap items-center gap-2">
						<li className="inline-flex items-center gap-1.5 rounded-full bg-hue-blue-soft px-2.5 py-1 text-[12px] text-hue-blue-fg">
							<CalendarClock className="size-3.5 shrink-0" />
							<span>截止</span>
							<strong className="font-semibold">{task.dueAt ? formatLocalMinute(task.dueAt) : "未设置"}</strong>
						</li>
						<li className="inline-flex items-center gap-1.5 rounded-full bg-hue-violet-soft px-2.5 py-1 text-[12px] text-hue-violet-fg">
							<Flag className="size-3.5 shrink-0" />
							<span>优先级</span>
							<strong className="font-semibold">{task.priority ? priorityLabelOf(task.priority) : "未设置"}</strong>
						</li>
						<li className="inline-flex items-center gap-1.5 rounded-full bg-hue-teal-soft px-2.5 py-1 text-[12px] text-hue-teal-fg">
							<Clock className="size-3.5 shrink-0" />
							<span>创建于</span>
							<strong className="font-semibold">{task.createdAt ? formatLocalMinute(task.createdAt) : "—"}</strong>
						</li>
					</ul>
				</div>
			</header>

			{/* ─── main layout ─────────────────────────────────────────── */}
			<main className="grid gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_260px]">
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

					{/* 任务内容 block —— 文本 / 表格 / 引用 / 外链,按注册表渲染(未知块降级成占位,不崩) */}
					<section className="grid gap-3">
						<header className="flex items-center justify-between">
							<h2 className="inline-flex items-baseline gap-1.5 text-[13px] font-bold tracking-tight text-foreground">
								任务内容
							</h2>
						</header>
						<TaskContentBlocks content={content} />
					</section>

					{/* 附件 block */}
					<section className="grid gap-3 pt-6">
						<header className="flex items-center justify-between border-b border-dashed border-border pb-2">
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
					<section className="grid gap-3 pt-6">
						<header className="flex items-center justify-between border-b border-dashed border-border pb-2">
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
						<header className="flex items-center justify-between border-b border-dashed border-border pb-2">
							<h2 className="inline-flex items-baseline gap-1.5 text-[13px] font-bold tracking-tight text-foreground">
								参与人员 <span className="text-xs font-medium text-muted-foreground">{members.length + 1}</span>
							</h2>
							{can.addMember ? (
								<Button size="icon-sm" variant="outline" aria-label="加成员" onClick={() => setMemberOpen(true)}>
									<UserPlus className="size-3.5" />
								</Button>
							) : null}
						</header>
						<ul className="grid gap-0.5">
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
													setPendingRemoveMember({
														userId: m.userId,
														role: m.role as "participant" | "executor",
														name: m.name ?? m.userId,
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
					<section className="grid gap-3 pt-6">
						<header className="flex items-center justify-between border-b border-dashed border-border pb-2">
							<h2 className="inline-flex items-baseline gap-1.5 text-[13px] font-bold tracking-tight text-foreground">
								流程动态
							</h2>
							<Badge variant="secondary" className="text-[10px]">
								<Send className="mr-1 size-3" />
								实时
							</Badge>
						</header>
						<TaskStatusTimeline logs={logQuery.data?.items ?? []} statuses={statuses} current={task.status} />
						<div className="mt-3 grid gap-1">
							<h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">事件</h3>
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

			{/* 移出成员 —— 破坏性操作,先确认 */}
			<ConfirmDialog
				open={pendingRemoveMember !== null}
				onOpenChange={(next) => {
					if (!next) setPendingRemoveMember(null);
				}}
				title="移出成员"
				description={`把「${pendingRemoveMember?.name ?? "—"}」从这条任务移出?TA 将失去推进 / 答复的权限(已发的评论与历史保留)。`}
				isPending={memberRemoveMutation.isPending}
				confirmText="移出"
				pendingText="移出中…"
				onConfirm={() => {
					if (!pendingRemoveMember) return;
					memberRemoveMutation.mutate(
						{ taskId: task.id, userId: pendingRemoveMember.userId, role: pendingRemoveMember.role },
						{ onSuccess: () => setPendingRemoveMember(null) },
					);
				}}
			/>

			{/* 改状态(创建者 / 管理员)—— 直接跳到模板里的任意状态 */}
			<Dialog open={statusOpen} onOpenChange={setStatusOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>改状态</DialogTitle>
						<DialogDescription>直接把任务改到流程模板里的任意状态,不建审批动作、也不要求走模板的边。</DialogDescription>
					</DialogHeader>
					<DialogBody className="space-y-1 py-1">
						<DetailRow label="目标状态" align="center">
							<Select
								items={statusOptions}
								value={statusTo}
								onValueChange={(next) => setStatusTo(next ? String(next) : "")}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="选一个状态" />
								</SelectTrigger>
								<SelectContent>
									{statusOptions.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</DetailRow>
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" onClick={() => setStatusOpen(false)} disabled={transitMutation.isPending}>
							取消
						</Button>
						<Button
							disabled={transitMutation.isPending || !statusTo}
							onClick={() => transitMutation.mutate({ id: task.id, to: statusTo })}
						>
							{transitMutation.isPending ? "保存中…" : "保存"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* 转交执行人 —— 选一位参与人员,原执行人自动降为参与者 */}
			<Dialog open={transferOpen} onOpenChange={setTransferOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>转交执行人</DialogTitle>
						<DialogDescription>把执行人身份交给同为参与人员的另一个人;原执行人会改为参与者。</DialogDescription>
					</DialogHeader>
					<DialogBody className="space-y-1 py-1">
						<DetailRow label="交给谁" align="center">
							<SearchSelect
								value={transferTo}
								onValueChange={setTransferTo}
								options={transferOptions}
								placeholder="从参与人员里选一个"
							/>
						</DetailRow>
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" onClick={() => setTransferOpen(false)} disabled={transferMutation.isPending}>
							取消
						</Button>
						<Button
							disabled={transferMutation.isPending || !transferTo}
							onClick={() => transferMutation.mutate({ taskId: task.id, userId: transferTo })}
						>
							{transferMutation.isPending ? "转交中…" : "转交"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* 发起审批 / 发起征询 —— 同一个弹窗:审批多一步选目标状态 */}
			<Dialog
				open={actionMode !== null}
				onOpenChange={(next) => {
					if (!next) setActionMode(null);
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>{actionMode === "approve" ? "发起审批" : "发起征询"}</DialogTitle>
						<DialogDescription>
							{actionMode === "approve"
								? "目标状态只能从流程模板里、当前状态出发的「审批」边里选;发起后任务锁定,等对方答复。"
								: "征询不改状态、也不锁任务,只是请对方给个意见。"}
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="space-y-1 py-1">
						{actionMode === "approve" ? (
							<DetailRow label="目标状态" align="center">
								<Select
									items={actionTargetOptions}
									value={actionTo}
									onValueChange={(next) => setActionTo(next ? String(next) : "")}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="选一个目标状态" />
									</SelectTrigger>
									<SelectContent>
										{actionTargetOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</DetailRow>
						) : null}
						<DetailRow label="交给谁" align="center">
							<SearchSelect
								value={actionHandle}
								onValueChange={setActionHandle}
								options={peopleOptions}
								placeholder="从参与人员里选一个"
							/>
						</DetailRow>
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" onClick={() => setActionMode(null)} disabled={actionMutation.isPending}>
							取消
						</Button>
						<Button
							disabled={actionMutation.isPending || !actionHandle || (actionMode === "approve" && !actionTo)}
							onClick={() =>
								actionMutation.mutate({
									taskId: task.id,
									toStatus: actionMode === "approve" ? actionTo : null,
									handleId: actionHandle,
								})
							}
						>
							{actionMutation.isPending ? "提交中…" : "发起"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

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

/** 头部 ⓘ 用的身份名 —— 比 `roleText` 多「管理员 / 旁观」两种(那两个不是 `tc_member` 里的角色) */
const ROLE_LABEL: Record<string, string> = {
	admin: "管理员",
	creator: "创建者",
	executor: "执行者",
	participant: "参与者",
};

/** ⓘ 里「为什么有这些按钮」的一句话 —— 与 `doc/task-close.md` 的「头部按钮(按事项流程派生)」同口径 */
const ROLE_WHY: Record<string, string> = {
	admin: "系统管理员:不受事项流程限制,可直接改到任意状态。",
	creator: "任务创建人:编辑 / 删除 / 发起征询按身份;状态类按钮按模板里 who 含 creator 的边。",
	executor: "执行者:转交 / 发起征询按身份;状态类按钮按模板里 who 含 executor 的边。",
	participant: "参与者:发起征询按身份;状态类按钮按模板里 who 含 participant 的边。",
	viewer: "你不在这条任务的流程里(既不是创建人、也不是成员):只能看,不能推进。",
};

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
		<li className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-hover">
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
