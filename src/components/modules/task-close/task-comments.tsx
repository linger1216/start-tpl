import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { AsyncState } from "#/components/modules/task-close/async-state";
import { InitialsCircle } from "#/components/modules/task-close/initials-circle";
import { AttachmentChip, TaskAttachmentList } from "#/components/modules/task-close/task-content-attachments";
import { MentionTextarea, type Participant, useMentionPicker } from "#/components/modules/task-close/task-mention";
import { useAttachmentPreview } from "#/components/modules/task-close/use-attachment-preview";
import { useAttachmentUpload } from "#/components/modules/task-close/use-attachment-upload";
import { useConfirm } from "#/components/modules/task-close/use-confirm";
import { ActionIconButton } from "#/components/ui/action-button";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";

import { writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { REJECT_NOTE_PREFIX } from "#/lib/task/close-spec";
import type { TaskAttachment } from "#/lib/task/payload";
import { MAX_ATTACHMENTS } from "#/lib/task/payload";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

type Pending = { id: string; name: string };

/**
 * 评论与回复(裸结构,不包 Card / 标题)—— 由调用方提供 block head(原型的「评论与回复」块)与外层容器。
 *
 * 三段:
 *   1. ci —— 评论输入:左 avatar + 右圆角 field(textarea + 工具条:附件 / @ / 发送)
 *   2. ul.thread —— 评论流:每条 avatar + 人/时间(右侧悬停出删除)+ 正文 + 附件
 *
 * 上传是**选完即传**(复用 `useFileUpload` 的秒传/直传链路),提交评论时只带 `sys_file.id` 列表;
 * 不打包成「提交时一起传」是刻意的:大文件先传完,点提交就是一次轻量写。
 */
export function TaskComments({
	taskId,
	meId,
	participants,
	canRemoveAny,
	labelledBy,
}: {
	taskId: string;
	meId: string;
	participants: Participant[];
	canRemoveAny: boolean;
	/**
	 * 输入框的可见标签 id(调用方区块标题的 id)—— checkup P3:输入之后 placeholder 就没了,
	 * 光靠它当标签不够;指到区块标题上,字段名在页面上始终存在。
	 */
	labelledBy?: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const fileRef = useRef<HTMLInputElement | null>(null);
	const textRef = useRef<HTMLTextAreaElement | null>(null);

	const [content, setContent] = useState("");
	const [attachments, setAttachments] = useState<Pending[]>([]);
	const { uploading, pick: pickFiles } = useAttachmentUpload({
		limit: MAX_ATTACHMENTS,
		existing: () => attachments.length,
		onRows: (rows) => setAttachments((prev) => [...prev, ...rows.map((row) => ({ id: row.id, name: row.originName }))]),
		resetInput: () => {
			if (fileRef.current) fileRef.current.value = "";
		},
	});
	/** 正在预览的**已有**评论附件 */
	const preview = useAttachmentPreview<TaskAttachment>(taskId);
	const del = useConfirm<{ id: string; authorName: string | null }>();

	const listQuery = useQuery(trpc.taskClose.commentList.queryOptions({ taskId }));
	// 评论也会进活动日志(`tc_log`)—— 失效要连日志一起,否则「动态」卡还停在发评论之前
	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());
	const mention = useMentionPicker(participants, setContent, textRef);

	const createMutation = useMutation(
		trpc.taskClose.commentCreate.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => {
					setContent("");
					mention.reset();
					setAttachments([]);
				},
			}),
			onError: toastApiError,
		}),
	);

	const removeMutation = useMutation(
		trpc.taskClose.commentRemove.mutationOptions({
			onSuccess: writeSuccess(invalidate),
			onError: toastApiError,
		}),
	);

	const items = listQuery.data ?? [];
	const canSubmit = content.trim().length > 0 && !uploading && !createMutation.isPending;

	function submit() {
		if (!canSubmit) return;
		createMutation.mutate({
			taskId,
			content: content.trim(),
			attachments: attachments.map((f) => f.id),
			mentionIds: mention.mentionIds,
		});
	}

	return (
		<div className="grid gap-5">
			{/* ci —— 评论输入(原型的样:avatar + 边框 field + 工具条 + 发送) */}
			<div className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3">
				<InitialsCircle name="我" className="size-9 text-[13px]" />
				{/* 输入框:静态描边 + 一条**焦点环**(不换边框色,只加环 —— 键盘用户要看得见落点) */}
				<div className="rounded-lg border border-border bg-card">
					<MentionTextarea
						value={content}
						onChange={setContent}
						mention={mention}
						textRef={textRef}
						rows={3}
						placeholder="说点什么…  输入 @ 提及成员"
						ariaLabel="评论"
						ariaLabelledBy={labelledBy}
						className="block w-full resize-none bg-transparent px-3.5 py-3 text-base leading-[1.55] placeholder:text-muted-foreground sm:text-sm"
						onPrimaryAction={submit}
					/>
					{attachments.length > 0 ? (
						<div className="flex flex-wrap gap-1.5 px-3 pt-2">
							{attachments.map((file) => (
								<AttachmentChip
									key={file.id}
									file={file}
									onRemove={(id) => setAttachments((prev) => prev.filter((f) => f.id !== id))}
								/>
							))}
						</div>
					) : null}
					<div className="flex items-center justify-between gap-2 border-t border-dashed border-border px-2 py-1">
						<input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => pickFiles(e.target.files)} />
						<div className="inline-flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								aria-label="附件"
								disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
								onClick={() => fileRef.current?.click()}
							>
								<Paperclip className="size-3.5" />
								<span>附件</span>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								aria-label="提及成员"
								title="提及成员(在光标处插入 @)"
								disabled={uploading}
								onClick={() => mention.insertAtCursor(content)}
							>
								<span aria-hidden className="text-base leading-none">
									@
								</span>
							</Button>
						</div>
						<Button size="sm" disabled={!canSubmit} onClick={submit}>
							{createMutation.isPending ? "发送中…" : "发送"}
						</Button>
					</div>
				</div>
			</div>

			{/* thread —— 评论流(原型的 thread + thread__item)。
			    外包一层 `bg-card` + 圆角 + 描边,与上半部「评论输入」Card 视觉一致;
			    缺了它下半部会透出 PageFrame 的画布色,看起来「上半有框、下半没框」割裂。 */}
			{listQuery.isError ? (
				<AsyncState
					inline
					pending={false}
					error={listQuery.error}
					isFetching={listQuery.isFetching}
					onRetry={() => listQuery.refetch()}
				/>
			) : (
				<ul className="grid gap-4.5 rounded-lg bg-card p-4">
					{items.map((item) => (
						<li key={item.id} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 group">
							<InitialsCircle name={item.authorName ?? "?"} className="size-9 text-[13px]" />
							<div className="min-w-0 pt-0.5">
								{/* 名字 + 时间 + 删除同一行:删除是**纯图标**(ActionIconButton 的行内规格),
								    紧跟在日期右侧、与文字同一视觉水平;悬停/键盘聚焦才显形 */}
								<div className="inline-flex items-baseline gap-2 text-sm flex-wrap">
									<strong className="font-semibold text-foreground">{item.authorName ?? PLACEHOLDER_EMPTY}</strong>
									{item.createdAt ? (
										<span className="text-xs text-muted-foreground">{formatLocalMinute(item.createdAt)}</span>
									) : null}
									{item.authorId === meId || canRemoveAny ? (
										// 悬停**或键盘聚焦**才显形 —— 只挂 group-hover 会让 Tab 落在一个看不见的按钮上
										<ActionIconButton
											tone="danger"
											label="删除评论"
											disabled={removeMutation.isPending}
											onClick={() => del.ask({ id: item.id, authorName: item.authorName })}
											className={cn(
												"opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
											)}
										>
											<Trash2 className="size-3" />
										</ActionIconButton>
									) : null}
								</div>
								{/* 驳回原因走「批注」Alert(左红竖线 + 批注小标);普通评论是正文 */}
								{item.content.startsWith(REJECT_NOTE_PREFIX) ? (
									<Alert variant="danger" title="批注" className="mt-1">
										{item.content}
									</Alert>
								) : (
									<p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-wrap">{item.content}</p>
								)}
								{item.attachments.length > 0 ? (
									<div className="mt-1.5">
										{/* 复用任务附件的预览弹窗:chip 可点 → 预览 / 下载 */}
										<TaskAttachmentList attachments={item.attachments} onOpen={preview.preview} />
									</div>
								) : null}
							</div>
						</li>
					))}
				</ul>
			)}

			{preview.dialog}

			{/* 删除评论 —— 破坏性操作,先确认(软删:从讨论流里消失,历史仍留痕) */}
			<del.Dialog
				title="删除评论"
				description={(t) => `删除「${t.authorName ?? PLACEHOLDER_EMPTY}」的这条评论?删除后讨论流里不再显示。`}
				isPending={removeMutation.isPending}
				onConfirm={(t) => removeMutation.mutate({ id: t.id }, { onSuccess: del.dismiss })}
			/>
		</div>
	);
}
