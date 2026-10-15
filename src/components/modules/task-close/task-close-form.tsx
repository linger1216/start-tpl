import { useEffect, useState } from "react";

import { TaskAttachmentPicker } from "#/components/modules/task-close/task-content-attachments";
import { TaskContentEditor } from "#/components/modules/task-close/task-content-editor";
import { Button } from "#/components/ui/button";
import { DatePicker } from "#/components/ui/date-picker";
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
import { Input } from "#/components/ui/input";
import { SearchSelect, type SearchSelectOption } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskPriority } from "#/lib/task-close-spec";
import type { TaskAttachment, TaskContentBlock } from "#/lib/task-content";
import { formatLocalDate } from "#/lib/time";

/** ISO → 本地 `YYYY-MM-DD`(日期选择器只认这个形状;空值回空串) */
function toDateInput(iso: string | null | undefined): string {
	return iso ? formatLocalDate(iso) : "";
}

/** 本地 `YYYY-MM-DD` → ISO(按本地 0 点算,避免 `new Date("YYYY-MM-DD")` 当 UTC 差一天) */
function fromDateInput(date: string): string | null {
	return date ? new Date(`${date}T00:00:00`).toISOString() : null;
}

/** 优先级 Select 的固定选项 —— 「未设置」(null)放最前,允许保留旧值不变 */
const PRIORITY_OPTIONS: { value: TaskPriority | null; label: string }[] = [
	{ value: null, label: "未设置" },
	...TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_LABEL[value] })),
];

/** 编辑态回填 —— 模板与成员是建任务时定的,之后各有自己的接口;内容 / 附件随任务本身走 */
export type TaskFormEditing = {
	id: string;
	name: string;
	description: string | null;
	dueAt: string | null;
	/** `0|1|2|null` —— 服务端的 `tinyint(1)` 读出来是 number,严格档位不在这里断,在 server zod 上校验 */
	priority: number | null;
	content: TaskContentBlock[];
	attachments: TaskAttachment[];
};

export type TaskFormPayload = {
	name: string;
	description: string | null;
	dueAt: string | null;
	/** 提交时:`null` = 没选,`0|1|2` = 选定档;接口上 `undefined` 表示「不动旧值」,**这里**总是显式传值 */
	priority: number | null;
	workflowId: string;
	executorId: string | null;
	content: TaskContentBlock[];
	/** 附件 id 列表(`sys_file.id`) */
	attachments: string[];
};

type Option = SearchSelectOption<string>;

/**
 * 新建 / 编辑任务。
 *
 * 新建:`taskCreate`(选模板 + 选一名执行人);编辑:`taskUpdate`(只改名称 / 描述 / 截止 / 优先级)。
 * **一件事一个接口**,所以这里也按模式分派,不做「一个提交按钮打两个接口」。
 */
export function TaskCloseForm({
	open,
	onOpenChange,
	pending,
	editing,
	workflowOptions,
	userOptions,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	pending: boolean;
	/** 非空 = 编辑态 */
	editing: TaskFormEditing | null;
	workflowOptions: Option[];
	userOptions: Option[];
	onSubmit: (payload: TaskFormPayload) => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [due, setDue] = useState("");
	/** `null` = 未设置;`0|1|2` = P0/P1/P2。DB 列是 tinyint,运行时是 number */
	const [priority, setPriority] = useState<number | null>(null);
	const [workflowId, setWorkflowId] = useState("");
	const [executorId, setExecutorId] = useState("");
	const [content, setContent] = useState<TaskContentBlock[]>([]);
	const [attachments, setAttachments] = useState<TaskAttachment[]>([]);

	// 打开时回填;模板缺省取第一个,避免"没选模板点保存"这种可避免的报错
	useEffect(() => {
		if (!open) return;
		setName(editing?.name ?? "");
		setDescription(editing?.description ?? "");
		setDue(toDateInput(editing?.dueAt));
		setPriority(editing?.priority ?? null);
		setWorkflowId(editing ? "" : (workflowOptions[0]?.value ?? ""));
		setExecutorId("");
		setContent(editing?.content ?? []);
		setAttachments(editing?.attachments ?? []);
	}, [open, editing, workflowOptions]);

	const canSubmit = name.trim().length > 0 && (editing !== null || workflowId.length > 0);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
				<DialogHeader className="shrink-0">
					<DialogTitle>{editing ? "编辑任务" : "新建任务"}</DialogTitle>
					<DialogDescription>
						{editing
							? "可改名称 / 描述 / 截止时间 / 优先级;成员与状态走详情页。"
							: "状态从模板的初始状态开始;执行人能发起「改状态」动作。"}
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="space-y-1 py-1">
					<DetailRow label="任务名称" htmlFor="tc-name">
						<Input
							id="tc-name"
							className="h-9 text-base sm:h-8 sm:text-sm"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="比如:3 号机组巡检"
						/>
					</DetailRow>

					{editing ? null : (
						<>
							<DetailRow label="流程模板">
								<Select
									items={workflowOptions}
									value={workflowId || null}
									onValueChange={(next) => setWorkflowId(next ? String(next) : "")}
								>
									<SelectTrigger size="sm" className="w-full">
										<SelectValue placeholder="请选择流程模板" />
									</SelectTrigger>
									<SelectContent>
										{workflowOptions.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</DetailRow>

							<DetailRow label="执行人">
								<SearchSelect
									value={executorId}
									onValueChange={setExecutorId}
									options={userOptions}
									placeholder="可不选,之后再指派"
								/>
							</DetailRow>
						</>
					)}

					<DetailRow label="截止时间" htmlFor="tc-due">
						<DatePicker id="tc-due" value={due} onChange={setDue} placeholder="选择日期" />
					</DetailRow>

					<DetailRow label="优先级">
						<Select
							items={PRIORITY_OPTIONS}
							value={priority}
							onValueChange={(next) => {
								// `next` 可能是 `0|1|2` 或在「未设置」分支里被传回 `""`,
								// 统一归到 number | null:空串 / 非 number / 越界 → null
								const raw = next as unknown;
								setPriority(typeof raw === "number" && (raw === 0 || raw === 1 || raw === 2) ? raw : null);
							}}
						>
							<SelectTrigger size="sm" className="w-full">
								<SelectValue placeholder="未设置" />
							</SelectTrigger>
							<SelectContent>
								{PRIORITY_OPTIONS.map((item) => (
									<SelectItem key={String(item.value ?? "null")} value={item.value as unknown as string}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailRow>

					<DetailRow label="描述" htmlFor="tc-desc">
						<Textarea
							id="tc-desc"
							rows={3}
							className="text-base sm:text-sm"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="补充说明(可空)"
						/>
					</DetailRow>

					{/* 内容块:一句话 + 表格 + 引用 / 外链,可混合、可排序(注册表见 task-content-editor) */}
					<div className="space-y-2 border-t border-border pt-3">
						<span className="text-sm font-medium">内容</span>
						<TaskContentEditor value={content} onChange={setContent} disabled={pending} />
					</div>

					{/* 附件:选完即传,提交只带 id 列表(与评论附件同一链路) */}
					<div className="space-y-2 border-t border-border pt-3">
						<span className="text-sm font-medium">附件</span>
						<TaskAttachmentPicker value={attachments} onChange={setAttachments} disabled={pending} />
					</div>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
						取消
					</Button>
					<Button
						disabled={pending || !canSubmit}
						onClick={() =>
							onSubmit({
								name: name.trim(),
								description: description.trim() || null,
								dueAt: fromDateInput(due),
								priority,
								workflowId,
								executorId: executorId || null,
								content,
								attachments: attachments.map((file) => file.id),
							})
						}
					>
						{pending ? "保存中…" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
