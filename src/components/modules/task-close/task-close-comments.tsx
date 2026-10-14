import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { TaskAttachmentPreview } from "#/components/modules/task-close/task-close-attachment-preview";
import { TaskAttachmentList } from "#/components/modules/task-close/task-content-attachments";
import { Button } from "#/components/ui/button";
import { useFileUpload } from "#/hooks/use-file-upload";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import type { TaskAttachment } from "#/lib/task-content";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

type Pending = { id: string; name: string };

/**
 * 评论与回复(裸结构,不包 Card / 标题)—— 由调用方提供 block head(原型的「评论与回复」块)与外层容器。
 *
 * 三段:
 *   1. ci —— 评论输入:左 avatar + 右圆角 field(textarea + 工具条:附件 / @ / 发送)
 *   2. ul.thread —— 评论流:每条 avatar + 人/时间 + 正文 + 操作(删除)+ 附件
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
}: {
	taskId: string;
	meId: string;
	/** `meName` 给 ci 输入区 avatar 当首字母;load 失败时 fallback "我" */
	meName?: string | null;
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
				{/* 输入框:去掉 focus 变色边框 / 外圈(用户嫌丑)—— 只留一层静态描边 */}
				<div className="rounded-lg border border-border bg-card">
					<textarea
						rows={3}
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder="说点什么…  输入 @ 提及成员"
						aria-label="评论"
						className="block w-full resize-none bg-transparent px-3.5 py-3 text-[13.5px] leading-[1.55]  placeholder:text-muted-foreground"
						onKeyDown={(e) => {
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								e.preventDefault();
								submit();
							}
						}}
					/>
					{attachments.length > 0 ? (
						<div className="flex flex-wrap gap-1.5 border-t border-dashed border-border px-3 pt-2">
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
								aria-label="提及"
								title="提及成员:暂未实现"
								onClick={() => toast.info("@提及:暂未实现,需要新交互后再接上")}
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
				<p className="py-1 pl-[48px] text-[12.5px] text-muted-foreground">
					{listQuery.isPending ? "加载中…" : "还没有评论。"}
				</p>
			) : (
				<ul className="grid gap-[18px]">
					{items.map((item) => (
						<li key={item.id} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 group">
							<Avatar initials={(item.authorName ?? "?").slice(0, 1)} />
							<div className="min-w-0 pt-0.5">
								<div className="inline-flex items-baseline gap-2 text-[13px] flex-wrap">
									<strong className="font-semibold text-foreground">{item.authorName ?? "—"}</strong>
									{item.createdAt ? (
										<span className="text-[11.5px] text-muted-foreground">{formatLocalMinute(item.createdAt)}</span>
									) : null}
								</div>
								<p className="mt-1 text-[13.5px] leading-relaxed text-foreground whitespace-pre-wrap">{item.content}</p>
								{item.attachments.length > 0 ? (
									<div className="mt-1.5">
										{/* 复用任务附件的预览弹窗:chip 可点 → 预览 / 下载 */}
										<TaskAttachmentList attachments={item.attachments} onOpen={setPreview} />
									</div>
								) : null}
								{item.authorId === meId || canRemoveAny ? (
									<div className="mt-1 inline-flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
										<Button
											size="sm"
											variant="ghost"
											aria-label="删除评论"
											disabled={removeMutation.isPending}
											onClick={() => removeMutation.mutate({ id: item.id })}
										>
											<Trash2 className="size-3.5" />
											<span>删除</span>
										</Button>
									</div>
								) : null}
							</div>
						</li>
					))}
				</ul>
			)}

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
 * 评论流里的小头像 —— 圆形 + 品牌蓝底(`bg-primary`,即原型 `.avatar--md` 的 Airtable Blue)+ 白字。
 *
 * ⚠️ **不要用 `bg-accent`** —— 那在本项目是浅灰面 `#f8fafc`,白字压上去看不清(原型里的
 * `--color-accent` 是品牌蓝,与本项目的 `--accent` 同名不同物)。用 `text-primary-foreground`
 * 而非硬编码 `text-white`,深色模式下自动翻转。
 *
 * 双层 `shadow` 给头像加一圈「同底色外环 + 描边」,把头像从浅背景里"凸"出来 —— 两个色都用
 * `var(--color-background)` / `var(--color-border)` 跟随主题。原型 `.avatar--md` 36px,这里沿用。
 */
function Avatar({ initials }: { initials: string }) {
	return (
		<span
			className={cn(
				"flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-primary-foreground",
				"shadow-[0_0_0_2px_var(--color-background),0_0_0_3px_var(--color-border)]",
			)}
		>
			{initials}
		</span>
	);
}
