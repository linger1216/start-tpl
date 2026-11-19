import type { ReactNode } from "react";
import { DepartmentUserSelect } from "#/components/modules/shared/department-user-select";
import { MultiSelect } from "#/components/modules/shared/multi-select";
import { AttachmentChips, TaskAttachmentAddButton } from "#/components/modules/task-close/task-content-attachments";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { SearchSelect, type SearchSelectOption } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { APPROVE_PRESETS, REJECT_PRESETS } from "#/lib/task/close-spec";
import type { TaskAttachment } from "#/lib/task/payload";
import { MAX_ATTACHMENTS } from "#/lib/task/payload";
import { TaskActionDialog } from "./task-action-dialog";

/**
 * 任务详情页的**表单型弹窗**集合(纯展示 + 受控值),共用 `TaskActionDialog` 外壳:
 * 转交执行人 / 附件 / 更改状态 / 发起审批·征询 / 通过·驳回 / 加入成员 —— 六个都在这儿。
 * 搬到本文件只为给页面减负,不改任何交互或校验。
 */
export function TaskTransferDialog({
	open,
	onOpenChange,
	pending,
	value,
	onValueChange,
	options,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	pending: boolean;
	value: string;
	onValueChange: (next: string) => void;
	options: SearchSelectOption<string>[];
	onConfirm: () => void;
}) {
	return (
		<TaskActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title="转交执行人"
			description="把执行人身份交给同为成员的另一个人;原执行人会改为参与者。"
			pending={pending}
			confirmDisabled={!value}
			confirmText="转交"
			pendingText="转交中…"
			onConfirm={onConfirm}
		>
			<DetailRow label="交给谁" align="center">
				<SearchSelect
					aria-label="交给谁"
					value={value}
					onValueChange={onValueChange}
					options={options}
					placeholder="从成员里选一个"
				/>
			</DetailRow>
		</TaskActionDialog>
	);
}

export function TaskAttachDialog({
	open,
	onOpenChange,
	pending,
	value,
	onChange,
	onConfirm,
	hasChildren,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	pending: boolean;
	value: TaskAttachment[];
	onChange: (next: TaskAttachment[]) => void;
	onConfirm: () => void;
	hasChildren: boolean;
}) {
	return (
		<TaskActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title="附件"
			description="选完即传;保存后随整棵树可见(父子任务都能看到)。"
			pending={pending}
			confirmDisabled={false}
			confirmText="保存"
			pendingText="保存中…"
			bodyClassName=""
			onConfirm={onConfirm}
		>
			<div className="space-y-2">
				{hasChildren ? (
					<Alert variant="info" title="保存后同步" className="mb-2">
						父任务维护的附件会同步到下级任务；下级自行添加的附件会保留。
					</Alert>
				) : null}
				<div className="flex items-center justify-between gap-2">
					<p className="min-w-0 truncate text-xs text-muted-foreground">
						{value.length === 0
							? "还没有附件。选完即传,保存只写一条轻量记录。"
							: `共 ${value.length} / ${MAX_ATTACHMENTS} 个`}
					</p>
					<TaskAttachmentAddButton value={value} onChange={onChange} disabled={pending} />
				</div>
				{value.length > 0 ? (
					<AttachmentChips
						attachments={value}
						onRemove={(id) => onChange(value.filter((item) => item.id !== id))}
						disabled={pending}
					/>
				) : null}
			</div>
		</TaskActionDialog>
	);
}

/** 模板允许的直接状态转移。 */
export function TaskStatusDialog({
	open,
	onOpenChange,
	pending,
	value,
	onValueChange,
	options,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (value: boolean) => void;
	pending: boolean;
	value: string;
	onValueChange: (value: string) => void;
	options: Array<{ value: string; label: string }>;
	onConfirm: () => void;
}) {
	return (
		<TaskActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title="更改状态"
			description="按流程模板允许的直接转移边修改状态。"
			pending={pending}
			confirmDisabled={!value}
			confirmText="保存"
			pendingText="保存中…"
			onConfirm={onConfirm}
		>
			<DetailRow label="目标状态" align="center">
				<Select items={options} value={value} onValueChange={(next) => onValueChange(next ? String(next) : "")}>
					<SelectTrigger className="w-full" aria-label="目标状态">
						<SelectValue placeholder="选一个状态" />
					</SelectTrigger>
					<SelectContent>
						{options.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</DetailRow>
		</TaskActionDialog>
	);
}

/** 审批与征询共享的接收人和处理顺序表单。 */
export function TaskInitiateDialog({
	mode,
	onClose,
	pending,
	assignees,
	onAssigneesChange,
	consultMode,
	onConsultModeChange,
	targetOptions,
	peopleOptions,
	orderHint,
	onConfirm,
}: {
	mode: "approve" | "consult" | null;
	onClose: () => void;
	pending: boolean;
	assignees: string[];
	onAssigneesChange: (ids: string[]) => void;
	consultMode: "serial" | "parallel";
	onConsultModeChange: (mode: "serial" | "parallel") => void;
	targetOptions: Array<{ value: string; label: string }>;
	peopleOptions: Array<{ value: string; label: string; hint?: string }>;
	orderHint: ReactNode;
	onConfirm: () => void;
}) {
	return (
		<TaskActionDialog
			open={mode !== null}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
			title={mode === "approve" ? "发起审批" : "发起征询"}
			description={
				mode === "approve"
					? "发出后任务会锁定:期间不能改状态,也不能再发起别的动作。"
					: "征询不改状态、也不锁任务,只是请对方给个意见。"
			}
			pending={pending}
			confirmDisabled={assignees.length === 0}
			confirmText="发起"
			pendingText="发起中…"
			onConfirm={onConfirm}
		>
			{mode === "approve" ? (
				<DetailRow label="目标状态" align="center">
					<div className="grid gap-1.5">
						<span className="text-sm text-foreground">
							{targetOptions[0] ? `全部通过后,任务会进入「${targetOptions[0].label}」` : "当前状态没有可发起的审批"}
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
						value={assignees}
						onChange={onAssigneesChange}
						placeholder="搜索成员…"
						emptyText="没有可选的人 —— 先到「参与人」里加成员"
						minHeight={132}
						maxHeight={160}
					/>
					<p className="text-xs text-muted-foreground">
						{mode === "approve"
							? "点选的人会按先后排成一串;选谁、谁先谁后都由你定。"
							: "点选的人会按先后排成一串,先选的人先收到征询。"}
					</p>
					{mode === "consult" ? orderHint : null}
				</div>
			</DetailRow>
			{mode === "consult" && assignees.length > 1 ? (
				<DetailRow label="处理方式" align="center">
					<div className="grid gap-1">
						<Select
							items={[
								{ value: "serial", label: "逐级" },
								{ value: "parallel", label: "并行" },
							]}
							value={consultMode}
							onValueChange={(next) => onConsultModeChange(next === "parallel" ? "parallel" : "serial")}
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
	);
}

/** 审批通过或驳回的意见表单。 */
export function TaskRespondDialog({
	approved,
	open,
	onClose,
	pending,
	reason,
	onReasonChange,
	onConfirm,
}: {
	approved: boolean;
	open: boolean;
	onClose: () => void;
	pending: boolean;
	reason: string;
	onReasonChange: (reason: string) => void;
	onConfirm: () => void;
}) {
	const title = approved ? "通过" : "驳回";
	return (
		<TaskActionDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
			title={title}
			description={
				approved
					? "通过后按流程推进;意见可写可不写,写了会作为一条评论留档。"
					: "驳回要填写原因,会作为一条评论留档,和相关人一起看。"
			}
			pending={pending}
			confirmDisabled={!approved && !reason.trim()}
			confirmText={title}
			pendingText={`${title}中…`}
			onConfirm={onConfirm}
		>
			<DetailRow label="常见原因" align="center">
				<div className="flex flex-wrap gap-1.5">
					{(approved ? APPROVE_PRESETS : REJECT_PRESETS).map((item) => (
						<Button key={item} type="button" variant="outline" size="sm" onClick={() => onReasonChange(item)}>
							{item}
						</Button>
					))}
				</div>
			</DetailRow>
			<DetailRow label={approved ? "意见" : "原因"} align="center">
				<Textarea
					rows={3}
					value={reason}
					placeholder={approved ? "可写一句通过意见,留空也行…" : "说明为什么驳回…"}
					onChange={(event) => onReasonChange(event.target.value)}
				/>
			</DetailRow>
		</TaskActionDialog>
	);
}

/** 添加参与者。 */
export function TaskMemberDialog({
	open,
	onOpenChange,
	pending,
	value,
	onChange,
	options,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pending: boolean;
	value: string[];
	onChange: (value: string[]) => void;
	options: Array<{ value: string; label: string; hint?: string }>;
	onConfirm: () => void;
}) {
	return (
		<TaskActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title="加入成员"
			description="多选,按参与者加入;换执行人请用「转交执行人」。"
			pending={pending}
			confirmDisabled={value.length === 0}
			confirmText={`确定（${value.length}）`}
			pendingText="加入中…"
			onConfirm={onConfirm}
			contentClassName="sm:max-w-2xl"
		>
			<DepartmentUserSelect options={options} value={value} onChange={onChange} disabled={pending} />
		</TaskActionDialog>
	);
}
