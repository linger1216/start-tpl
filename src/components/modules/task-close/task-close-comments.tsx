import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Trash2, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { TaskAttachmentPreview } from "#/components/modules/task-close/task-close-attachment-preview";
import { NameSeal } from "#/components/modules/task-close/task-close-badge";
import { MentionList, type Participant, useMentionPicker } from "#/components/modules/task-close/task-close-mention";
import { TaskAttachmentList } from "#/components/modules/task-close/task-content-attachments";
import { ActionIconButton } from "#/components/ui/action-button";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { useFileUpload } from "#/hooks/use-file-upload";
import { writeError, writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import type { TaskAttachment } from "#/lib/task-content";
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
 *
 * `meName` 是给输入区 avatar 用的首字母(原型是「我」);fallback 到 "我"。
 */
export function TaskCloseComments({
	taskId,
	meId,
	meName,
	canRemoveAny,
	labelledBy,
}: {
	taskId: string;
	meId: string;
	/** `meName` 给 ci 输入区 avatar 当首字母;load 失败时 fallback "我" */
	meName?: string | null;
	canRemoveAny: boolean;
	/**
	 * 输入框的可见标签 id(调用方区块标题的 id)—— checkup P3:输入之后 placeholder 就没了,
	 * 光靠它当标签不够;指到区块标题上,字段名在页面上始终存在。
	 */
	labelledBy?: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { upload } = useFileUpload();
	const fileRef = useRef<HTMLInputElement | null>(null);
	const textRef = useRef<HTMLTextAreaElement | null>(null);

	const [content, setContent] = useState("");
	const [attachments, setAttachments] = useState<Pending[]>([]);
	const [uploading, setUploading] = useState(false);
	/** 正在预览的**已有**评论附件 */
	const [preview, setPreview] = useState<TaskAttachment | null>(null);
	/** 待确认删除的评论 —— 删除是破坏性操作,先弹 `ConfirmDialog`(非空即打开) */
	const [pendingRemove, setPendingRemove] = useState<{ id: string; authorName: string | null } | null>(null);

	const listQuery = useQuery(trpc.taskClose.commentList.queryOptions({ taskId }));
	// 参与人名单(创建者 + 成员,去掉自己)供 @选单过滤 —— 用 taskGet(详情页同键,缓存共享,不多打一次)
	const taskQuery = useQuery(trpc.taskClose.taskGet.queryOptions({ id: taskId }));
	const participants: Participant[] | undefined = (() => {
		const detail = taskQuery.data;
		if (!detail) return undefined;
		const roster = [
			{ id: detail.task.creatorId, name: detail.task.creatorName ?? "" },
			...detail.members.map((member) => ({ id: member.userId, name: member.name ?? "" })),
		];
		return roster.filter((person) => person.id !== meId && person.name);
	})();
	// 评论也会进活动日志(`tc_log`)—— 失效要连日志一起,否则「动态」卡还停在发评论之前
	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());
	const mention = useMentionPicker(participants, setContent, textRef);

	const createMutation = useMutation(
		trpc.taskClose.commentCreate.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => {
					setContent("");
					setAttachments([]);
				},
			}),
			onError: writeError,
		}),
	);

	const removeMutation = useMutation(
		trpc.taskClose.commentRemove.mutationOptions({
			onSuccess: writeSuccess(invalidate),
			onError: writeError,
		}),
	);

	async function pickFiles(files: FileList | null) {
		if (!files || files.length === 0) return;
		setUploading(true);
		try {
			for (const file of Array.from(files).slice(0, MAX_FILES - attachments.length)) {
				const result = await upload(file, "private");
				if (!result.ok) {
					toast.error(result.message);
					continue;
				}
				setAttachments((prev) => [...prev, { id: result.row.id, name: result.row.originName }]);
			}
		} finally {
			setUploading(false);
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	const items = listQuery.data ?? [];
	const canSubmit = content.trim().length > 0 && !uploading && !createMutation.isPending;

	function submit() {
		if (!canSubmit) return;
		createMutation.mutate({
			taskId,
			content: content.trim(),
			attachments: attachments.map((f) => f.id),
		});
	}

	return (
		<div className="grid gap-5">
			{/* ci —— 评论输入(原型的样:avatar + 边框 field + 工具条 + 发送) */}
			<div className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3">
				<Avatar initials={(meName ?? "我").slice(0, 1)} />
				{/* 输入框:静态描边 + 一条**焦点环**(不换边框色,只加环 —— 键盘用户要看得见落点) */}
				<div className="rounded-lg border border-border bg-card focus-within:ring-2 focus-within:ring-ring/40">
					<textarea
						ref={textRef}
						rows={3}
						value={content}
						onChange={(event) => {
							setContent(event.target.value);
							mention.track(event.target.value, event.target.selectionStart);
						}}
						placeholder="说点什么…  输入 @ 提及成员"
						aria-label="评论"
						aria-labelledby={labelledBy}
						className="block w-full resize-none bg-transparent px-3.5 py-3 text-base leading-[1.55] placeholder:text-muted-foreground sm:text-sm"
						onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
							// @选单在场时,↑↓/Enter/Tab/Esc 归它管 —— 别把"回车发送"带出来
							if (mention.onKeyDown(event)) return;
							if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
								event.preventDefault();
								submit();
							}
						}}
						onBlur={() => mention.close()}
					/>
					{mention.state ? (
						<MentionList
							options={mention.options}
							highlight={mention.highlight}
							onPick={(person) => mention.insert(person.name, content)}
						/>
					) : null}
					{attachments.length > 0 ? (
						<div className="flex flex-wrap gap-1.5 px-3 pt-2">
							{attachments.map((file) => (
								<span
									key={file.id}
									className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
								>
									{file.name}
									<button
										type="button"
										aria-label={`移除 ${file.name}`}
										onClick={() => setAttachments((prev) => prev.filter((f) => f.id !== file.id))}
									>
										<X className="size-3" />
									</button>
								</span>
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
								disabled={uploading || attachments.length >= MAX_FILES}
								onClick={() => fileRef.current?.click()}
							>
								<Paperclip className="size-3.5" />
								<span>附件</span>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								aria-label="提及成员"
								title="提及参与人(在光标处插入 @)"
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

			{/* thread —— 评论流(原型的 thread + thread__item) */}
			{items.length === 0 ? (
				<p className="py-1 pl-[48px] text-xs text-muted-foreground">
					{listQuery.isPending ? "加载中…" : "还没有评论。"}
				</p>
			) : (
				<ul className="grid gap-[18px]">
					{items.map((item) => (
						<li key={item.id} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 group">
							<Avatar initials={(item.authorName ?? "?").slice(0, 1)} />
							<div className="min-w-0 pt-0.5">
								{/* 名字 + 时间 + 删除同一行:删除是**纯图标**(ActionIconButton 的行内规格),
								    紧跟在日期右侧、与文字同一视觉水平;悬停/键盘聚焦才显形 */}
								<div className="inline-flex items-baseline gap-2 text-sm flex-wrap">
									<strong className="font-semibold text-foreground">{item.authorName ?? "—"}</strong>
									{item.createdAt ? (
										<span className="text-xs text-muted-foreground">{formatLocalMinute(item.createdAt)}</span>
									) : null}
									{item.authorId === meId || canRemoveAny ? (
										// 悬停**或键盘聚焦**才显形 —— 只挂 group-hover 会让 Tab 落在一个看不见的按钮上
										<ActionIconButton
											tone="danger"
											label="删除评论"
											disabled={removeMutation.isPending}
											onClick={() => setPendingRemove({ id: item.id, authorName: item.authorName })}
											className={cn(
												"opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
											)}
										>
											<Trash2 className="size-3" />
										</ActionIconButton>
									) : null}
								</div>
								{/* 驳回原因走「批注」Alert(左红竖线 + 批注小标);普通评论是正文 */}
								{item.content.startsWith("驳回原因:") ? (
									<Alert variant="danger" title="批注" className="mt-1">
										{item.content}
									</Alert>
								) : (
									<p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-wrap">{item.content}</p>
								)}
								{item.attachments.length > 0 ? (
									<div className="mt-1.5">
										{/* 复用任务附件的预览弹窗:chip 可点 → 预览 / 下载 */}
										<TaskAttachmentList attachments={item.attachments} onOpen={setPreview} />
									</div>
								) : null}
							</div>
						</li>
					))}
				</ul>
			)}

			{/* 删除评论 —— 破坏性操作,先确认(软删:从讨论流里消失,历史仍留痕) */}
			<ConfirmDialog
				open={pendingRemove !== null}
				onOpenChange={(next) => {
					if (!next) setPendingRemove(null);
				}}
				title="删除评论"
				description={`删除「${pendingRemove?.authorName ?? "—"}」的这条评论?删除后讨论流里不再显示。`}
				isPending={removeMutation.isPending}
				onConfirm={() => {
					if (!pendingRemove) return;
					removeMutation.mutate({ id: pendingRemove.id }, { onSuccess: () => setPendingRemove(null) });
				}}
			/>

			<TaskAttachmentPreview
				taskId={taskId}
				attachment={preview}
				open={preview !== null}
				onOpenChange={(next) => {
					if (!next) setPreview(null);
				}}
			/>
		</div>
	);
}

/** 与 `commentCreate` 入参的 `.max(20)` 对齐 */
const MAX_FILES = 20;

/**
 * 评论流里的姓名签 —— 已合流到 `NameSeal`(task-close-badge.tsx):墨底方章 + 反白首字 + 宋体。
 * 「公文·印鉴」世界里,评论/回复的头像是**一枚小章**,与成员列表的姓名签、状态章同形族
 * (圆形蓝头像是旧世界的异物,已换);同一人在两处长得一样。
 */
const Avatar = ({ initials }: { initials: string }) => <NameSeal name={initials} size="md" />;
