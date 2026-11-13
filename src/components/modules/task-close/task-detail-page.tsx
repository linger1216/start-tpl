import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Info, Paperclip, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageFrame } from "#/components/layout/page-frame";
import { MultiSelect } from "#/components/modules/shared/multi-select";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { TaskAttachmentPreview } from "#/components/modules/task-close/task-attachment-preview";
import { TaskCard, TaskCardLink } from "#/components/modules/task-close/task-card";
import { TaskComments } from "#/components/modules/task-close/task-comments";
import { TaskAttachmentList, TaskAttachmentPicker } from "#/components/modules/task-close/task-content-attachments";
import { TaskFlowSpine, TaskTodoStrip, type TodoItem } from "#/components/modules/task-close/task-flow-spine";
import { TaskForm, type TaskFormEditing, type TaskFormPayload } from "#/components/modules/task-close/task-form";
import { TaskLinkBlocks } from "#/components/modules/task-close/task-link-blocks";
import { TaskLogList } from "#/components/modules/task-close/task-log";
import { TaskReport } from "#/components/modules/task-close/task-report";
import { TaskUrge } from "#/components/modules/task-close/task-urge";
import { Button, buttonVariants } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { RefreshButton } from "#/components/ui/refresh-button";
import { SearchSelect } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Tag } from "#/components/ui/tag.tsx";
import { Textarea } from "#/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";
import { DocDot, MetaRow, PageTitle } from "#/components/ui/typography";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError, toastApiError } from "#/lib/api/error";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { priorityLabelOf, statusLabelOf, type WorkflowStatus } from "#/lib/task-close-spec";
import type { TaskAttachment } from "#/lib/task-payload";
import { formatLocalDate, formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";
import { TaskActionDialog } from "./task-action-dialog";

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
 * `permissions` 派生(见 doc/task-close.md 的「按钮去向」):
 *   · 发起审批 —— `permissions.actionTargets`(模板里当前状态出发、我有权发起的 `via=action` 边);
 *     多个候选就在弹窗里选,再选「交给谁」,提交 `actionCreate`(带目标状态 → 任务锁定)。
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

	const [editOpen, setEditOpen] = useState(false);
	const [removeOpen, setRemoveOpen] = useState(false);
	const [memberOpen, setMemberOpen] = useState(false);
	/** 附件弹窗:创建人给任务加 / 删附件(随 `task.payload.attachments` 走) */
	const [attachOpen, setAttachOpen] = useState(false);
	const [draftAttachments, setDraftAttachments] = useState<TaskAttachment[]>([]);
	/** 加入成员:多选,统一按参与者加入(角色不让选) */
	const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
	/** 批量加入进行中(逐条调接口,不能靠单次 isPending) */
	const [addingMembers, setAddingMembers] = useState(false);
	/**
	 * 待确认移出的成员 —— 移出是破坏性操作,先弹 `ConfirmDialog`(非空即打开)。
	 * 存下 userId / role / 姓名:关掉弹窗后这些数据就没有别的来源了。
	 */
	const [pendingRemoveMember, setPendingRemoveMember] = useState<{
		userId: string;
		role: "participant" | "executor";
		name: string;
	} | null>(null);
	/** 「发起审批 / 发起征询」共用弹窗:`mode` 非空即打开(目标状态由流程自动判定,不让人选) */
	const [actionMode, setActionMode] = useState<"approve" | "consult" | null>(null);
	/** 交给谁 —— 多选,**选择顺序就是处理顺序**(第一个人先办,后面依次) */
	const [actionAssignees, setActionAssignees] = useState<string[]>([]);
	const [consultMode, setConsultMode] = useState<"serial" | "parallel">("serial");
	/** 转交弹窗:转给谁 */
	const [transferOpen, setTransferOpen] = useState(false);
	const [transferTo, setTransferTo] = useState("");
	/** 「改状态」弹窗:选择允许的直接转移 */
	const [statusOpen, setStatusOpen] = useState(false);
	const [statusTo, setStatusTo] = useState("");
	/** 驳回弹窗:动作 id + 原因(驳回必须写原因,服务端也会拒空的) */
	const [rejectId, setRejectId] = useState<string | null>(null);
	const [rejectReason, setRejectReason] = useState("");
	/** 通过也走弹窗:意见可选,常用原因点一下填进输入框 */
	const [approveId, setApproveId] = useState<string | null>(null);
	const [approveReason, setApproveReason] = useState("");
	/** 正在预览的附件(开弹窗看 / 下载) */
	const [previewAttachment, setPreviewAttachment] = useState<TaskAttachment | null>(null);
	/** 动态度:一次取多少条(「加载更多」每次 +20) */
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
			onSuccess: writeSuccess(invalidate, { close: () => setTransferOpen(false), message: () => "已转交" }),
			onError: toastApiError,
		}),
	);

	/** 「改状态」—— 沿模板直接转移边执行 */
	const transitMutation = useMutation(
		trpc.taskClose.taskTransit.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setStatusOpen(false), message: () => "状态已更新" }),
			onError: toastApiError,
		}),
	);

	/** 答复动作(通过 / 驳回)—— 只有指派人本人能答;驳回要写原因(服务端也会拒空的) */
	const viewMutation = useMutation(trpc.taskClose.actionView.mutationOptions({ onError: toastApiError }));
	const respondMutation = useMutation(
		trpc.taskClose.actionRespond.mutationOptions({
			onSuccess: async (_data, variables) => {
				await invalidate();
				setApproveId(null);
				setApproveReason("");
				setRejectId(null);
				setRejectReason("");
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
			onSuccess: writeSuccess(invalidate, { close: () => setEditOpen(false), message: () => "已保存" }),
			onError: toastApiError,
		}),
	);

	/** 附件弹窗专用保存 —— 只改 `payload.attachments`(任务相关方都能加;链接 / 说明服务端原样保留) */
	const attachMutation = useMutation(
		trpc.taskClose.taskAttach.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setAttachOpen(false), message: () => "附件已更新" }),
			onError: toastApiError,
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
			onError: toastApiError,
		}),
	);

	const memberAddMutation = useMutation(
		trpc.taskClose.memberAdd.mutationOptions({
			onSuccess: writeSuccess(invalidate),
			onError: toastApiError,
		}),
	);

	/** 批量加入:服务端是单人接口,这里逐个串行加,全加完再关窗 */
	const addMembers = async () => {
		const ids = [...newMemberIds];
		if (ids.length === 0 || addingMembers) return;
		setAddingMembers(true);
		try {
			for (const userId of ids) await memberAddMutation.mutateAsync({ taskId: task.id, userId, role: "participant" });
			setMemberOpen(false);
			setNewMemberIds([]);
			toast.success(`已加入 ${ids.length} 位成员`);
		} catch (error) {
			// 中途失败:已加进去的保留(服务端逐条提交),提示原因并清空选择
			toastApiError(error);
			setNewMemberIds([]);
		} finally {
			setAddingMembers(false);
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

	/**
	 * 「我的待办」中属于本任务的、当前还活着的 —— hooks **必须在 early-return 之前调用**,
	 * 否则 React 报 hooks 顺序错。data 尚未就绪时取 `[]` 兜底,`useEffect` 后的 early-return
	 * 会挡住下面的渲染,所以返回值仅在 data 已就绪路径里有意义。
	 */
	const myPendingActions = useMemo(
		() =>
			(detailQuery.data?.actions ?? []).filter(
				(row) => row.status === "active" && row.assigneeId === detailQuery.data?.meId,
			),
		[detailQuery.data],
	);

	/**
	 * 我在任务里的角色(admin / creator / executor / participant / null) —— **只给与状态无关的按钮**用。
	 *
	 * 与状态有关的两个按钮**不在这里判**:它们按「事项流程」(任务快照的模板)派生,见下面的
	 * `canApprove` / `canSetStatus` —— 「发起审批」看当前状态有没有我能发起的 action 边,
	 * 「改状态」看我能直改的 direct 边。这样换模板不用改前端。
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
			consult: detailQuery.data?.permissions.canInitiateConsult ?? false,
			edit: isAdmin || myRole === "creator",
			remove: isAdmin || myRole === "creator",
			refresh: myRole !== null,
			/** 加成员:服务端 `assertTaskParticipant` 同判据 —— 创建者 / 管理员 / 当前成员;旁观者不能 */
			addMember: myRole !== null,
			manageMembers: isAdmin || myRole === "creator",
		};
	}, [myRole, detailQuery.data?.permissions.canInitiateConsult]);

	/** 这条 id 在库里已经不存在了(被删 / 别人删了 / 手输错了) */
	const taskMissing = detailQuery.isError && isTaskMissing(detailQuery.error);
	/** 不是任务相关方(直接访问别人的任务 URL 也走这条) */
	const taskForbidden = detailQuery.isError && isTaskForbidden(detailQuery.error);
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
	/**
	 * `payload.type` 是业务场景标签,编辑界面不编辑它 —— 但保存时**必须原样带回**,
	 * 否则 `taskUpdate` 整块替换 payload 会把它抹掉(设置页的类型筛选随之失效)。
	 */
	const payloadType = (task.payload as { type?: string } | null)?.type;
	// 状态图快照:状态清单(value+label)从这里取(展示一律用 label)
	const workflow = task.workflow as { statuses?: WorkflowStatus[]; initial?: string } | null;
	const statuses = workflow?.statuses ?? [];
	const labelOf = (value: string) => statuses.find((status) => status.value === value)?.label ?? value;

	/** 被驳回过的审批边(`from->to`)—— 流程脊在箭头上挂小红章,"这一步被批回过"一眼可见 */
	const rejectedEdges = new Set(
		detailQuery.data.actions
			.filter((row) => row.status === "rejected" && row.fromStatus && row.toStatus)
			.map((row) => `${row.fromStatus}->${row.toStatus}`),
	);

	/**
	 * 「发起审批」的候选状态 —— **由服务端算好**(`permissions.actionTargets`,只含模板里当前状态出发、
	 * 且我有权发起的 `via=action` 边)。前端不自己解释 `who` / `edges`(见 doc/task-close.md「按钮级授权」)。
	 */
	const actionTargetOptions = permissions.actionTargets.map((value) => ({
		value,
		label: statusLabelOf(statuses, value),
	}));

	/**
	 * 「改状态」弹窗的候选由 `permissions.transitions` 提供
	 * (模板里他能直改的那几条 `direct` 边)。多个就让人在弹窗里选。
	 */
	const statusOptions = permissions.transitions.map((value) => ({ value, label: statusLabelOf(statuses, value) }));

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
	const hasMoreActions = can.transfer || (canSetStatus && canApprove) || can.edit || can.remove;

	/**
	 * 走过的状态 + 首次到达时刻 —— 读活动日志里 `toStatus` 非空的行(与流程条同源)。
	 * 日志是倒序,翻正序后每个状态取**首次**那条;当前态也会命中,所以它自带"什么时候到的"。
	 */
	const reachedAt = new Map<string, string>();
	for (const item of detailQuery.data.reached) {
		if (item.status && item.at) reachedAt.set(item.status, item.at);
	}

	/** 「轮到你了」的待办 —— 指给我的、还没结的动作;`toStatus` 为空 = 征询(不摊通过 / 驳回) */
	const todoItems: TodoItem[] = myPendingActions.map((row) => {
		const root = detailQuery.data.actions.find((item) => item.id === row.rootActionId);
		return {
			id: row.id,
			title:
				row.isLocking && root?.toStatus
					? `${row.creatorName ?? PLACEHOLDER_EMPTY} 发起 ${statusLabelOf(statuses, root.fromStatus ?? "")} → ${statusLabelOf(statuses, root.toStatus)}`
					: `${row.creatorName ?? PLACEHOLDER_EMPTY} 发起征询`,
			stateLabel: row.status === "active" ? "待答复" : "已发起",
			actionable: row.status === "active",
			consult: !row.isLocking,
		};
	});

	/**
	 * 头部那颗 ⓘ 的文案 —— 把「当前身份 + 事项流程给这个身份的边」摊开,让用户自己核对按钮为什么是这几个。
	 * 只是解释规则,不代替服务端授权(真正的拦截在 resolver 里)。
	 */
	const roleLabel = ROLE_LABEL[myRole ?? ""] ?? "旁观";
	const roleWhy = ROLE_WHY[myRole ?? ""] ?? ROLE_WHY.viewer;
	const tipLines = [
		`状态:${statusLabelOf(statuses, task.status)}`,
		`发起审批:${actionTargetOptions.length > 0 ? `→ ${actionTargetOptions.map((option) => option.label).join(" / ")}` : "无"}`,
		`直接更改状态:${statusOptions.length > 0 ? `→ ${statusOptions.map((option) => option.label).join(" / ")}` : "无"}`,
		...(permissions.locked ? ["任务被审批动作锁住,状态类按钮暂不可用"] : []),
	];

	/**
	 * 答复人 / 转交候选人 = **任务内的人**:创建人 + 参与者 + 执行人(右侧标出角色)。
	 * 不能选自己 —— 管理员除外(管理员本来就什么都能做)。父任务要找人,先自己加参与者。
	 */
	const peopleOptions = (() => {
		const list = [
			{ value: task.creatorId, label: task.creatorName ?? "创建人", hint: "创建人" },
			...members.map((row) => ({ value: row.userId, label: row.name ?? row.userId, hint: roleText(row.role) })),
		];
		const seen = new Set<string>();
		return list.filter((option) => {
			if (option.value === meId && !permissions.isAdmin) return false;
			if (seen.has(option.value)) return false;
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
		// 编辑弹窗只带**本任务自己的**内容 —— 页面上的并集是展示用的,存回去会把别人的内容克隆一份
		links: own.links,
		attachments: own.attachments,
	};

	/**
	 * 审批 / 征询的先后顺序说明 —— 审批挂在「目标状态」下面(先看清路径),征询挂在「交给谁」下面。
	 * 文案走人话:谁先谁后、最后落在哪。
	 */
	const orderHint =
		actionAssignees.length === 0 ? (
			<p className="text-xs text-muted-foreground">
				{actionMode === "approve" ? "选好审批人后,这里会显示他们审批的先后顺序。" : "选好后,这里会显示征询的先后顺序。"}
			</p>
		) : (
			<div className="grid gap-1">
				<ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					{actionAssignees.map((id, index) => (
						<li key={id} className="inline-flex items-center gap-1">
							<span className="inline-flex size-4 items-center justify-center rounded-full bg-muted font-medium text-foreground tabular-nums">
								{index + 1}
							</span>
							<span className="text-foreground">
								{peopleOptions.find((person) => person.value === id)?.label ?? id}
							</span>
							{index < actionAssignees.length - 1 ? <span aria-hidden>→</span> : null}
						</li>
					))}
				</ol>
				<p className="text-xs text-muted-foreground">
					{actionMode === "approve"
						? actionAssignees.length > 1
							? `这 ${actionAssignees.length} 位会依次审批,全部通过后进入「${actionTargetOptions[0]?.label ?? "目标状态"}」;任一人驳回就退回当前状态。`
							: `通过后进入「${actionTargetOptions[0]?.label ?? "目标状态"}」;驳回则退回当前状态。`
						: `${actionAssignees.length} 位会依次收到征询,先选的人先收到。`}
				</p>
			</div>
		);

	return (
		<div className="mx-auto flex w-full flex-col bg-card">
			{/* ─── 记录头(降级:不再是 24px 巨标题 + 彩色胶囊) ─────────────── */}
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
								<Button
									size="sm"
									title="发起审批;任务会锁定,等对方答复"
									onClick={() => {
										setActionAssignees([]);
										setActionMode("approve");
									}}
								>
									发起审批
								</Button>
							) : canSetStatus ? (
								<Button
									size="sm"
									title="按事项流程直接更改状态"
									onClick={() => {
										setStatusTo(statusOptions[0]?.value ?? "");
										setStatusOpen(true);
									}}
								>
									更改状态
								</Button>
							) : null}
							{can.consult ? (
								<Button
									variant="outline"
									size="sm"
									title="请某位成员给意见(不改状态、不锁任务)"
									onClick={() => {
										setActionAssignees([]);
										setActionMode("consult");
									}}
								>
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
										{can.transfer ? (
											<DropdownMenuItem
												onClick={() => {
													setTransferTo("");
													setTransferOpen(true);
												}}
											>
												转交执行人
											</DropdownMenuItem>
										) : null}
										{canSetStatus && canApprove ? (
											<DropdownMenuItem
												onClick={() => {
													setStatusTo(statusOptions[0]?.value ?? "");
													setStatusOpen(true);
												}}
											>
												更改状态
											</DropdownMenuItem>
										) : null}
										{(can.transfer || (canSetStatus && canApprove)) && (can.edit || can.remove) ? (
											<DropdownMenuSeparator />
										) : null}
										{can.edit ? <DropdownMenuItem onClick={() => setEditOpen(true)}>编辑</DropdownMenuItem> : null}
										{can.remove ? (
											<DropdownMenuItem variant="destructive" onClick={() => setRemoveOpen(true)}>
												删除
											</DropdownMenuItem>
										) : null}
									</DropdownMenuContent>
								</DropdownMenu>
							) : null}
							{can.refresh ? (
								<RefreshButton busy={detailQuery.isFetching} onClick={() => detailQuery.refetch()} />
							) : null}
						</div>
					</div>

					{task.description ? (
						<p className="mt-3 p-4 min-w-0 flex-1 text-base leading-relaxed text-muted-foreground wrap-break-word">
							{task.description}
						</p>
					) : null}
				</div>
			</header>

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
						onApprove={(id) => {
							setApproveReason("");
							setApproveId(id);
						}}
						onReject={(id) => {
							setRejectReason("");
							setRejectId(id);
						}}
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
							<header className="border-b border-border pb-2">
								<h2 className="inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-base font-semibold tracking-tight text-foreground">
									子任务
									<span className="text-xs font-medium tabular-nums text-muted-foreground">{children.length}</span>
								</h2>
							</header>
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{children.map((child) => (
									<TaskCardLink key={child.id} task={child} className="block h-48">
										<TaskCard task={child} statusLabel={labelOf} />
									</TaskCardLink>
								))}
							</div>
						</section>
					) : null}

					{/* 任务链接块 —— 内部页面 / 外部链接,按注册表渲染(未知块降级成占位,不崩) */}
					<section className="grid gap-3">
						<header className="flex items-center justify-between border-b border-dashed border-border pb-2">
							<h2 className="shrink-0 whitespace-nowrap text-base font-semibold tracking-tight text-foreground">
								任务链接
							</h2>
						</header>
						<TaskLinkBlocks links={links} />
					</section>

					{(task.creatorId === meId || permissions.isAdmin || members.some((member) => member.userId === meId)) && (
						<TaskReport
							taskId={task.id}
							canManage={(task.creatorId === meId || permissions.isAdmin) && !task.parentId && children.length === 0}
						/>
					)}

					{/* 附件 block */}
					<section className="grid gap-3 pt-6">
						<header className="flex items-center justify-between border-b border-border pb-2">
							<h2 className="inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-base font-semibold tracking-tight text-foreground">
								附件{" "}
								<span className="text-xs font-medium tabular-nums text-muted-foreground">{attachments.length}</span>
							</h2>
							{/* 新增附件:任务相关方都能加(执行人 / 参与者 / 创建人),旁观者不显示 */}
							{myRole !== null ? (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setDraftAttachments(own.attachments);
										setAttachOpen(true);
									}}
								>
									<Paperclip className="size-3.5" aria-hidden />
									新增附件
								</Button>
							) : null}
						</header>
						<TaskAttachmentList attachments={attachments} onOpen={setPreviewAttachment} />
					</section>

					{/* 评论与回复 block —— TaskComments 自带输入 + 嵌套 thread */}
					<section className="grid gap-3 pt-6">
						<header className="flex items-center justify-between border-b border-border pb-2">
							<h2 id="tc-comments-title" className="text-base font-semibold tracking-tight text-foreground">
								评论与回复
							</h2>
						</header>
						{/* 删评论:只有作者本人;`canRemoveAny` 只给管理员(创建者也不能删别人的) */}
						<TaskComments
							taskId={task.id}
							meId={meId}
							canRemoveAny={myRole === "admin"}
							labelledBy="tc-comments-title"
						/>
					</section>
				</section>

				{/* 右 检查器 —— 两块合成**一张面板**:内部用 inset 细线分组,不再每块各画一条虚线 */}
				<aside className="sticky top-18 self-start">
					<div className="overflow-hidden rounded-[10px] border border-border bg-card">
						{/* 参与人 —— 创建人 + 成员,所以不叫「成员」 */}
						<section className="grid gap-2 p-3.5">
							<header className="flex items-center justify-between">
								<h2 className="inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-base font-semibold tracking-tight text-foreground">
									参与人{" "}
									<span className="text-xs font-medium tabular-nums text-muted-foreground">{members.length + 1}</span>
								</h2>
								{can.addMember ? (
									<Button size="icon-sm" variant="outline" aria-label="加成员" onClick={() => setMemberOpen(true)}>
										<UserPlus className="size-3.5" />
									</Button>
								) : null}
							</header>
							<ul className="grid gap-0.5">
								<PeopleRow roleLabel="创建人" name={task.creatorName ?? PLACEHOLDER_EMPTY} main={false} />
								{members.map((m) => (
									<PeopleRow
										key={`${m.userId}-${m.role}`}
										roleLabel={roleText(m.role)}
										name={m.name ?? m.userId}
										main={m.role === "executor"}
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
									<li className="py-3 text-sm text-muted-foreground">还没有其他人。加人后他们能答复动作、参与讨论。</li>
								) : null}
							</ul>
						</section>

						<TaskUrge
							actions={detailQuery.data.actions.filter(
								(action) =>
									action.status === "active" &&
									(meId === task.creatorId || meId === action.creatorId || permissions.isAdmin),
							)}
						/>

						{/* 动态 —— 事件流(状态史由上方流程脊承担,这里不重复) */}
						<section className="grid gap-2 border-t border-border p-3.5">
							<h2 className="text-base font-semibold tracking-tight text-foreground">动态</h2>
							<TaskLogList
								items={logQuery.data?.items ?? []}
								statuses={statuses}
								roleLabel={roleText}
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
						</section>
					</div>
				</aside>
			</main>

			<TaskForm
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
						payload: { type: payloadType, links: payload.links, attachments: payload.attachments },
					})
				}
			/>

			<ConfirmDialog
				open={removeOpen}
				onOpenChange={setRemoveOpen}
				title="删除任务"
				description={`「${task.name}」会被软删,动作与评论一并不可见。`}
				isPending={removeMutation.isPending}
				onConfirm={() => removeMutation.mutate({ id: task.id })}
			/>

			{/* 移出成员 —— 破坏性操作,先确认 */}
			<ConfirmDialog
				open={pendingRemoveMember !== null}
				onOpenChange={(next) => {
					if (!next) setPendingRemoveMember(null);
				}}
				title="移出成员"
				description={`把「${pendingRemoveMember?.name ?? PLACEHOLDER_EMPTY}」从这条任务移出?TA 将失去推进 / 答复的权限(已发的评论与历史保留)。`}
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

			{/* 改状态 —— 按模板允许的转移执行 */}
			<TaskActionDialog
				open={statusOpen}
				onOpenChange={setStatusOpen}
				title="更改状态"
				description="按流程模板允许的直接转移边修改状态。"
				pending={transitMutation.isPending}
				confirmDisabled={!statusTo}
				confirmText="保存"
				pendingText="保存中…"
				onConfirm={() => transitMutation.mutate({ id: task.id, to: statusTo })}
			>
				<DetailRow label="目标状态" align="center">
					<Select
						items={statusOptions}
						value={statusTo}
						onValueChange={(next) => setStatusTo(next ? String(next) : "")}
					>
						<SelectTrigger className="w-full" aria-label="目标状态">
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
			</TaskActionDialog>

			{/* 转交执行人 —— 选一位成员,原执行人自动降为参与者 */}
			<TaskActionDialog
				open={transferOpen}
				onOpenChange={setTransferOpen}
				title="转交执行人"
				description="把执行人身份交给同为成员的另一个人;原执行人会改为参与者。"
				pending={transferMutation.isPending}
				confirmDisabled={!transferTo}
				confirmText="转交"
				pendingText="转交中…"
				onConfirm={() => transferMutation.mutate({ taskId: task.id, userId: transferTo })}
			>
				<DetailRow label="交给谁" align="center">
					<SearchSelect
						aria-label="交给谁"
						value={transferTo}
						onValueChange={setTransferTo}
						options={transferOptions}
						placeholder="从成员里选一个"
					/>
				</DetailRow>
			</TaskActionDialog>

			{/* 发起审批 / 发起征询 —— 同一个弹窗:审批多一步选目标状态 */}
			<TaskActionDialog
				open={actionMode !== null}
				onOpenChange={(next) => {
					if (!next) setActionMode(null);
				}}
				title={actionMode === "approve" ? "发起审批" : "发起征询"}
				description={
					actionMode === "approve"
						? "发出后任务会锁定:期间不能改状态,也不能再发起别的动作。"
						: "征询不改状态、也不锁任务,只是请对方给个意见。"
				}
				pending={actionMutation.isPending}
				confirmDisabled={actionAssignees.length === 0}
				confirmText="发起"
				pendingText="发起中…"
				onConfirm={() =>
					actionMutation.mutate({
						taskId: task.id,
						// 审批的目标状态由流程自动判定(当前状态出发的审批边,取模板顺序第一条),不让人选
						toStatus: actionMode === "approve" ? (actionTargetOptions[0]?.value ?? null) : null,
						assigneeId: actionAssignees[0] ?? "",
						nextAssigneeIds: actionAssignees.slice(1),
						flowMode: actionMode === "consult" ? consultMode : "serial",
					})
				}
			>
				{actionMode === "approve" ? (
					<DetailRow label="目标状态" align="center">
						<div className="grid gap-1.5">
							<span className="text-sm text-foreground">
								{actionTargetOptions[0]
									? `全部通过后,任务会进入「${actionTargetOptions[0].label}」`
									: "当前状态没有可发起的审批"}
							</span>
							{/* 审批顺序放在目标状态下面:先看清"这一趟要经过谁、最后到哪儿" */}
							{orderHint}
						</div>
					</DetailRow>
				) : null}
				<DetailRow label="交给谁" align="center">
					<div className="grid gap-1.5">
						<MultiSelect
							options={peopleOptions}
							value={actionAssignees}
							onChange={setActionAssignees}
							placeholder="搜索成员…"
							emptyText="没有可选的人 —— 先到「参与人」里加成员"
							minHeight={132}
							maxHeight={160}
						/>
						<p className="text-xs text-muted-foreground">
							{actionMode === "approve"
								? "点选的人会按先后排成一串;选谁、谁先谁后都由你定。"
								: "点选的人会按先后排成一串,先选的人先收到征询。"}
						</p>
						{actionMode === "consult" ? orderHint : null}
					</div>
				</DetailRow>
				{actionMode === "consult" && actionAssignees.length > 1 ? (
					<DetailRow label="处理方式" align="center">
						<div className="grid gap-1">
							<Select
								items={[
									{ value: "serial", label: "逐级" },
									{ value: "parallel", label: "并行" },
								]}
								value={consultMode}
								onValueChange={(next) => setConsultMode(next === "parallel" ? "parallel" : "serial")}
							>
								<SelectTrigger className="w-full" aria-label="处理方式">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="serial">逐级</SelectItem>
									<SelectItem value="parallel">并行</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								逐级:按顺序逐位处理,前一位回复后才轮到下一位;并行:同时送出,一位回复即结束。
							</p>
						</div>
					</DetailRow>
				) : null}
			</TaskActionDialog>

			<TaskActionDialog
				open={memberOpen}
				onOpenChange={(next) => {
					setMemberOpen(next);
					if (!next) setNewMemberIds([]);
				}}
				title="加入成员"
				description="多选,按参与者加入;需要执行人时在成员行里单独转交。"
				pending={addingMembers || memberAddMutation.isPending}
				confirmDisabled={newMemberIds.length === 0 || addingMembers}
				confirmText={newMemberIds.length > 1 ? `加入 ${newMemberIds.length} 人` : "加入"}
				pendingText="加入中…"
				onConfirm={() => void addMembers()}
			>
				<DetailRow label="人员" align="center">
					<MultiSelect
						options={userOptions.filter(
							(person) =>
								person.value !== meId &&
								person.value !== task.creatorId &&
								!members.some((member) => member.userId === person.value),
						)}
						value={newMemberIds}
						onChange={setNewMemberIds}
						placeholder="搜索姓名…"
						emptyText="没有可加入的人"
						minHeight={160}
						maxHeight={200}
					/>
				</DetailRow>
			</TaskActionDialog>

			<TaskActionDialog
				open={attachOpen}
				onOpenChange={setAttachOpen}
				title="附件"
				description="选完即传;保存后随整棵树可见(父子任务都能看到)。"
				pending={attachMutation.isPending}
				confirmDisabled={false}
				confirmText="保存"
				pendingText="保存中…"
				bodyClassName=""
				onConfirm={() =>
					attachMutation.mutate({
						id: task.id,
						attachments: draftAttachments.map((file) => file.id),
					})
				}
			>
				<TaskAttachmentPicker
					value={draftAttachments}
					onChange={setDraftAttachments}
					disabled={attachMutation.isPending}
				/>
			</TaskActionDialog>

			{/* 驳回 —— 必须写原因;原因会以一条评论留档(服务端同一口径) */}
			<TaskActionDialog
				open={approveId !== null}
				onOpenChange={(next) => {
					if (!next) setApproveId(null);
				}}
				title="通过"
				description="通过后按流程推进;意见可写可不写,写了会作为一条评论留档。"
				pending={respondMutation.isPending}
				confirmDisabled={false}
				confirmText="通过"
				pendingText="通过中…"
				onConfirm={() =>
					approveId &&
					respondMutation.mutate(
						{ id: approveId, approved: true, reason: approveReason.trim() || null },
						{ onSuccess: () => setApproveId(null) },
					)
				}
			>
				<DetailRow label="常见原因" align="center">
					<div className="flex flex-wrap gap-1.5">
						{APPROVE_PRESETS.map((reason) => (
							<Button key={reason} type="button" variant="outline" size="sm" onClick={() => setApproveReason(reason)}>
								{reason}
							</Button>
						))}
					</div>
				</DetailRow>
				<DetailRow label="意见" align="center">
					<Textarea
						rows={3}
						value={approveReason}
						placeholder="可写一句通过意见,留空也行…"
						onChange={(event) => setApproveReason(event.target.value)}
					/>
				</DetailRow>
			</TaskActionDialog>

			<TaskActionDialog
				open={rejectId !== null}
				onOpenChange={(next) => {
					if (!next) setRejectId(null);
				}}
				title="驳回"
				description="驳回要填写原因,会作为一条评论留档,和相关人一起看。"
				pending={respondMutation.isPending}
				confirmDisabled={rejectReason.trim().length === 0}
				confirmText="驳回"
				pendingText="驳回中…"
				onConfirm={() =>
					rejectId && respondMutation.mutate({ id: rejectId, approved: false, reason: rejectReason.trim() })
				}
			>
				<DetailRow label="常见原因" align="center">
					<div className="flex flex-wrap gap-1.5">
						{REJECT_PRESETS.map((reason) => (
							<Button
								key={reason}
								type="button"
								variant="outline"
								size="sm"
								// 点一下就**替换**输入框内容(单选式的快捷填写),不拼接
								onClick={() => setRejectReason(reason)}
							>
								{reason}
							</Button>
						))}
					</div>
				</DetailRow>
				<DetailRow label="原因" align="center">
					<Textarea
						rows={3}
						value={rejectReason}
						placeholder="说明为什么驳回…"
						onChange={(event) => setRejectReason(event.target.value)}
					/>
				</DetailRow>
			</TaskActionDialog>

			<TaskAttachmentPreview
				taskId={task.id}
				attachment={previewAttachment}
				open={previewAttachment !== null}
				onOpenChange={(next) => {
					if (!next) setPreviewAttachment(null);
				}}
			/>
		</div>
	);
}

function roleText(role: string): string {
	return ({ creator: "创建者", participant: "参与者", executor: "执行者" } as Record<string, string>)[role] ?? role;
}

/** 驳回的常用原因 —— 点一下填进输入框,省得每次从零打字 */
const REJECT_PRESETS = [
	"材料不完整",
	"数据有误",
	"信息不一致",
	"不符合要求",
	"依据不足",
	"需补充说明",
	"流程不符",
	"重复提交",
	"超出范围",
];
/** 通过的常用意见 */
const APPROVE_PRESETS = ["情况属实", "符合要求", "材料齐全", "已核对无误", "同意办理"];

/** 头部 ⓘ 用的身份名 —— 比 `roleText` 多「管理员 / 旁观」两种(那两个不是 `tc_member` 里的角色) */
const ROLE_LABEL: Record<string, string> = {
	admin: "管理员",
	creator: "创建者",
	executor: "执行者",
	participant: "参与者",
};

/** ⓘ 里「为什么有这些按钮」的一句话 —— 与 `doc/task-close.md` 的「头部按钮(按事项流程派生)」同口径 */
const ROLE_WHY: Record<string, string> = {
	admin: "系统管理员:按流程模板与条件执行状态转移。",
	creator: "任务创建人:编辑 / 删除 / 发起征询按身份;状态类按钮按模板里 who 含 creator 的边。",
	executor: "执行者:转交 / 发起征询按身份;状态类按钮按模板里 who 含 executor 的边。",
	participant: "参与者:发起征询按身份;状态类按钮按模板里 who 含 participant 的边。",
	viewer: "你不在这条任务的流程里(既不是创建人、也不是成员):只能看,不能推进。",
};

/**
 * 参与人块里的一行 —— 左侧角色标签 + 右侧人名;`onRemove` 非空时显式给「移出」按钮。
 *
 * 头像与「评论与回复」`TaskComments` 的 `Avatar` **同色**:`bg-primary` + `text-primary-foreground`
 * (品牌蓝底 + 浅字)—— 同一个人在两处长得一样,不额外给主执行人染色。
 * 「主执行」这个身份靠**角色标签**(页面上传的是 `主执行`)+ 名字加粗来区分,不靠颜色。
 *
 * 用 `bg-primary/85` + `text-paper`(`--ink` 底、反白首字同族的墨底圆牌,深色模式自动翻转);
 * **不要写 `bg-accent`** —— 它在本项目是浅灰面 `#f8fafc`,白字压上去直接看不见
 * (原型里的 `--color-accent` 是品牌蓝,与本项目的 `--accent` 同名不同物)。
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
	return (
		<li className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-hover">
			<span className="w-14 shrink-0 text-xs text-muted-foreground">{roleLabel}</span>
			<div className="flex min-w-0 flex-1 items-center gap-2">
				{/* 圆牌:墨底反白首字(与评论头像同款,就地内联 —— badge 合流层已拆) */}
				<span
					aria-hidden
					className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-primary/85 text-xs font-heading font-bold leading-none text-paper"
				>
					{name.slice(0, 1)}
				</span>
				<span className={cn("truncate text-sm text-foreground", main && "font-semibold")}>{name}</span>
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
/** 权限不足 —— 服务端 FORBIDDEN(不是相关方);同样提示一声回列表,不留错误页 */
function isTaskForbidden(error: unknown): boolean {
	const err = error as {
		data?: { code?: unknown; httpStatus?: unknown };
		shape?: { code?: unknown; data?: { code?: unknown; httpStatus?: unknown } };
	} | null;
	const code = err?.data?.code ?? err?.shape?.data?.code;
	return code === "FORBIDDEN" || err?.data?.httpStatus === 403;
}

function isTaskMissing(error: unknown): boolean {
	const err = error as {
		data?: { code?: unknown; httpStatus?: unknown };
		shape?: { code?: unknown; data?: { code?: unknown; httpStatus?: unknown } };
	} | null;
	const code = err?.data?.code ?? err?.shape?.data?.code;
	return code === "NOT_FOUND" || err?.shape?.code === -32004 || err?.data?.httpStatus === 404;
}
