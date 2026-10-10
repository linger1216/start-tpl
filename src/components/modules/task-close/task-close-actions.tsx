import { useMutation } from "@tanstack/react-query";
import { Check, Send, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { actionStatusText } from "#/components/modules/task-close/task-close-status";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
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
import { SearchSelect, type SearchSelectOption } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { statusLabelOf, type WorkflowStatus } from "#/lib/task-close-spec";
import { formatLocalMinute } from "#/lib/time";

export type ActionRow = {
	id: string;
	isLocking: boolean;
	fromStatus: string | null;
	toStatus: string | null;
	createdId: string;
	createdName: string | null;
	handleId: string;
	handleName: string | null;
	status: string;
	createdAt: string | null;
	updatedAt: string | null;
};

export type WorkflowEdge = { from: string; to: string; who: string[]; via: "direct" | "action" };

/** 「征询」选项的哨兵值(没有目标状态 = 只征询、不改状态) */
const CONSULT = "__consult__";

/**
 * 发起动作 + 动作时间线。
 *
 * 「发起」只有两种:从**模板里当前状态出发、`via:"action"` 的边**里选一条(会锁任务),
 * 或选「征询」(不锁)。服务端按 `toStatus` 是否有值派生 `is_locking` / `serial_no` / `sequence`,
 * 前端不重复那套规则(见 `doc/task-close.md` 的「动作派生规则」)。
 * 状态名一律显示模板里的 `label`(见 `statusLabelOf`)。
 */
export function TaskCloseActions({
	taskId,
	currentStatus,
	statuses,
	edges,
	actions,
	canInitiateStatusAction,
	canInitiateConsult,
	myActionIds,
	handleOptions,
	onDone,
}: {
	taskId: string;
	currentStatus: string;
	/** 任务状态图快照里的状态清单(取 label 用) */
	statuses: WorkflowStatus[];
	edges: WorkflowEdge[];
	actions: ActionRow[];
	canInitiateStatusAction: boolean;
	canInitiateConsult: boolean;
	/** 指给我的、还没答复的动作 id(详情页用 `actionMine` 算好) */
	myActionIds: Set<string>;
	handleOptions: SearchSelectOption<string>[];
	onDone: () => void;
}) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	/** 选中的动作:`CONSULT` = 征询,否则是目标状态 value */
	const [choice, setChoice] = useState(CONSULT);
	const [handleId, setHandleId] = useState("");
	/** 正在驳回的动作 id(要填原因) */
	const [rejectId, setRejectId] = useState<string | null>(null);
	const [rejectReason, setRejectReason] = useState("");

	// 能从**当前状态**发起审批的目标 —— 只认 `via=action` 的边(模板里已经枚举好)
	const statusTargets = edges.filter((edge) => edge.from === currentStatus && edge.via === "action").map((e) => e.to);
	const canOpen = canInitiateStatusAction || canInitiateConsult;

	const actionOptions = [
		{ value: CONSULT, label: "征询" },
		...statusTargets.map((value) => ({ value, label: statusLabelOf(statuses, value) })),
	];

	const createMutation = useMutation(
		trpc.taskClose.actionCreate.mutationOptions({
			onSuccess: () => {
				setOpen(false);
				setChoice(CONSULT);
				setHandleId("");
				onDone();
				toast.success("已发起");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const respondMutation = useMutation(
		trpc.taskClose.actionRespond.mutationOptions({
			onSuccess: () => {
				onDone();
				setRejectId(null);
				setRejectReason("");
				toast.success("已答复");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between">
				<CardTitle className="text-base">处理动作</CardTitle>
				{canOpen ? (
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							setChoice(CONSULT);
							setHandleId("");
							setOpen(true);
						}}
					>
						<Send className="size-3.5" />
						发起动作
					</Button>
				) : null}
			</CardHeader>
			<CardContent className="pt-0">
				{actions.length === 0 ? (
					<p className="text-sm text-muted-foreground">还没有动作。</p>
				) : (
					<ul className="divide-y divide-border">
						{actions.map((action) => (
							<li key={action.id} className="flex items-start justify-between gap-3 py-3">
								<div className="min-w-0 flex-1 space-y-1">
									<div className="flex flex-wrap items-center gap-2 text-sm">
										<span className="font-medium text-foreground">{action.createdName ?? "—"}</span>
										<span className="text-muted-foreground">
											{action.toStatus
												? `发起 ${statusLabelOf(statuses, action.fromStatus ?? "")} → ${statusLabelOf(statuses, action.toStatus)}`
												: "发起征询"}
										</span>
										{action.isLocking ? <span className="text-xs text-hue-amber-fg">（锁定任务）</span> : null}
										<span className="text-muted-foreground">→ {action.handleName ?? "—"}</span>
									</div>
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<span>{actionStatusText(action.status)}</span>
										{action.createdAt ? <span>{formatLocalMinute(action.createdAt)}</span> : null}
									</div>
								</div>
								{action.status === "active" && myActionIds.has(action.id) ? (
									<div className="flex shrink-0 gap-1.5">
										<Button
											size="sm"
											disabled={respondMutation.isPending}
											onClick={() => respondMutation.mutate({ id: action.id, approved: true })}
										>
											<Check className="size-3.5" />
											通过
										</Button>
										<Button
											size="sm"
											variant="outline"
											disabled={respondMutation.isPending}
											onClick={() => {
												setRejectReason("");
												setRejectId(action.id);
											}}
										>
											<X className="size-3.5" />
											驳回
										</Button>
									</div>
								) : null}
							</li>
						))}
					</ul>
				)}
			</CardContent>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>发起动作</DialogTitle>
						<DialogDescription>「征询」不改状态、不锁任务;选某条审批则等对方答复,任务在此期间锁住。</DialogDescription>
					</DialogHeader>
					<div className="space-y-1 py-1">
						{canInitiateStatusAction && statusTargets.length > 0 ? (
							<DetailRow label="动作" align="center">
								<Select
									items={actionOptions}
									value={choice}
									onValueChange={(next) => setChoice(next ? String(next) : CONSULT)}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{actionOptions.map((item) => (
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
								value={handleId}
								onValueChange={setHandleId}
								options={handleOptions}
								placeholder="选一个答复人"
							/>
						</DetailRow>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)} disabled={createMutation.isPending}>
							取消
						</Button>
						<Button
							disabled={createMutation.isPending || !handleId}
							onClick={() => createMutation.mutate({ taskId, toStatus: choice === CONSULT ? null : choice, handleId })}
						>
							{createMutation.isPending ? "提交中…" : "发起"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* 驳回要写原因 —— 原因会以一条评论留档(复用评论流) */}
			<Dialog
				open={rejectId !== null}
				onOpenChange={(next) => {
					if (!next) setRejectId(null);
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>驳回</DialogTitle>
						<DialogDescription>驳回要填写原因,会作为一条评论留档,和相关人一起看。</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<DetailRow label="原因" align="center">
							<Textarea
								rows={3}
								value={rejectReason}
								placeholder="说明为什么驳回…"
								onChange={(event) => setRejectReason(event.target.value)}
							/>
						</DetailRow>
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRejectId(null)} disabled={respondMutation.isPending}>
							取消
						</Button>
						<Button
							disabled={respondMutation.isPending || rejectReason.trim().length === 0}
							onClick={() =>
								rejectId && respondMutation.mutate({ id: rejectId, approved: false, reason: rejectReason.trim() })
							}
						>
							{respondMutation.isPending ? "提交中…" : "驳回"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
