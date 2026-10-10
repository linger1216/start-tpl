import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { TaskAttachmentPreview } from "#/components/modules/task-close/task-close-attachment-preview";
import { TaskAttachmentList } from "#/components/modules/task-close/task-content-attachments";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Textarea } from "#/components/ui/textarea";
import { useFileUpload } from "#/hooks/use-file-upload";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import type { TaskAttachment } from "#/lib/task-content";
import { formatLocalMinute } from "#/lib/time";

type Pending = { id: string; name: string };

/**
 * 评论区 —— 全员可发(任务可见即可评论),附件复用 `sys_file`。
 *
 * 上传是**选完即传**(复用 `useFileUpload` 的秒传/直传链路),提交评论时只带 `sys_file.id` 列表;
 * 不打包成「提交时一起传」是刻意的:大文件先传完,点提交就是一次轻量写。
 */
export function TaskCloseComments({
	taskId,
	meId,
	canRemoveAny,
}: {
	taskId: string;
	meId: string;
	canRemoveAny: boolean;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { upload } = useFileUpload();
	const fileRef = useRef<HTMLInputElement | null>(null);

	const [content, setContent] = useState("");
	const [attachments, setAttachments] = useState<Pending[]>([]);
	const [uploading, setUploading] = useState(false);
	/** 正在预览的**已有**评论附件 */
	const [preview, setPreview] = useState<TaskAttachment | null>(null);

	const listQuery = useQuery(trpc.taskClose.commentList.queryOptions({ taskId }));
	// 评论也会进活动日志(`tc_log`)—— 失效要连日志一起,否则「动态」卡还停在发评论之前
	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());

	const createMutation = useMutation(
		trpc.taskClose.commentCreate.mutationOptions({
			onSuccess: async () => {
				setContent("");
				setAttachments([]);
				await invalidate();
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const removeMutation = useMutation(
		trpc.taskClose.commentRemove.mutationOptions({
			onSuccess: () => invalidate(),
			onError: (error) => toast.error(toApiError(error).message),
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

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">评论</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4 pt-0">
				{items.length === 0 ? (
					<p className="text-sm text-muted-foreground">{listQuery.isPending ? "加载中…" : "还没有评论。"}</p>
				) : (
					<ul className="divide-y divide-border">
						{items.map((item) => (
							<li key={item.id} className="group flex items-start gap-3 py-3">
								<div className="min-w-0 flex-1 space-y-1">
									<div className="flex items-baseline gap-2 text-xs text-muted-foreground">
										<span className="font-medium text-foreground">{item.authorName ?? "—"}</span>
										{item.createdAt ? <span>{formatLocalMinute(item.createdAt)}</span> : null}
									</div>
									<p className="text-sm whitespace-pre-wrap text-foreground">{item.content}</p>
									{item.attachments.length > 0 ? (
										<div className="pt-0.5">
											{/* 复用任务附件的预览弹窗:chip 可点 → 预览 / 下载 */}
											<TaskAttachmentList attachments={item.attachments} onOpen={setPreview} />
										</div>
									) : null}
								</div>
								{item.authorId === meId || canRemoveAny ? (
									<Button
										size="icon-sm"
										variant="ghost"
										aria-label="删除评论"
										className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
										disabled={removeMutation.isPending}
										onClick={() => removeMutation.mutate({ id: item.id })}
									>
										<Trash2 className="size-3.5" />
									</Button>
								) : null}
							</li>
						))}
					</ul>
				)}

				<div className="space-y-2 border-t border-border pt-3">
					<Textarea
						rows={3}
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder="说点什么…(Ctrl/Cmd + Enter 提交)"
						onKeyDown={(e) => {
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
								createMutation.mutate({
									taskId,
									content: content.trim(),
									attachments: attachments.map((f) => f.id),
								});
							}
						}}
					/>
					{attachments.length > 0 ? (
						<div className="flex flex-wrap gap-2">
							{attachments.map((file) => (
								<span
									key={file.id}
									className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-xs"
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
					<div className="flex items-center justify-between gap-2">
						<input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => pickFiles(e.target.files)} />
						<Button
							size="sm"
							variant="outline"
							disabled={uploading || attachments.length >= MAX_FILES}
							onClick={() => fileRef.current?.click()}
						>
							<Paperclip className="size-3.5" />
							{uploading ? "上传中…" : "附件"}
						</Button>
						<Button
							size="sm"
							disabled={!canSubmit}
							onClick={() =>
								createMutation.mutate({
									taskId,
									content: content.trim(),
									attachments: attachments.map((f) => f.id),
								})
							}
						>
							{createMutation.isPending ? "提交中…" : "发表"}
						</Button>
					</div>
				</div>
			</CardContent>

			<TaskAttachmentPreview
				taskId={taskId}
				attachment={preview}
				open={preview !== null}
				onOpenChange={(next) => {
					if (!next) setPreview(null);
				}}
			/>
		</Card>
	);
}

/** 与 `commentCreate` 入参的 `.max(20)` 对齐 */
const MAX_FILES = 20;
