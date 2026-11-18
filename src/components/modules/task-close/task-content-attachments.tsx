import { Paperclip, Plus, X } from "lucide-react";
import { useRef } from "react";
import { useAttachmentUpload } from "#/components/modules/task-close/use-attachment-upload";
import { Button } from "#/components/ui/button";
import { formatBytes } from "#/lib/format";
import type { TaskAttachment } from "#/lib/task/payload";
import { MAX_ATTACHMENTS } from "#/lib/task/payload";

/**
 * 附件区(编辑态)—— 选完即传(复用 `useFileUpload` 的秒传 / 直传链路),提交时只带 `sys_file.id`。
 *
 * 与评论附件**完全同一套路**(`task-comments.tsx` 是模板):一并传完大文件,点保存只是轻量写。
 * 私桶(`"private"`)—— 任务附件不该公开直链。
 *
 * 「选文件的按钮」(`TaskAttachmentAddButton`)与「已选清单」(`AttachmentChips`)各自可单独摆 ——
 * 建任务弹窗要把「+」放进折叠区标题行右上角。
 */

/** 选文件 + 即传的图标按钮(带隐藏 input),上传态自己管 */
export function TaskAttachmentAddButton({
	value,
	onChange,
	disabled,
	compact = false,
}: {
	value: TaskAttachment[];
	onChange: (next: TaskAttachment[]) => void;
	disabled?: boolean;
	/** 新建任务的折叠标题行使用小型图标按钮。 */
	compact?: boolean;
}) {
	const fileRef = useRef<HTMLInputElement | null>(null);
	const { uploading, pick } = useAttachmentUpload({
		limit: MAX_ATTACHMENTS,
		existing: () => value.length,
		onRows: (rows) => {
			// 多选要**攒齐再写一次**:逐个 onChange 会拿同一个旧 value,最后只剩最后传上的那个
			const picked: TaskAttachment[] = [];
			for (const row of rows) {
				if (value.some((item) => item.id === row.id) || picked.some((item) => item.id === row.id)) continue;
				picked.push({ id: row.id, name: row.originName, size: row.size });
			}
			if (picked.length > 0) onChange([...value, ...picked]);
		},
		resetInput: () => {
			if (fileRef.current) fileRef.current.value = "";
		},
	});

	return (
		<>
			<Button
				type="button"
				size={compact ? "xs" : "icon-sm"}
				variant={compact ? "ghost" : "outline"}
				className={compact ? "size-6 p-0 text-muted-foreground" : undefined}
				aria-label={uploading ? "上传中" : "添加附件"}
				title={uploading ? "上传中…" : "添加附件"}
				disabled={disabled || uploading || value.length >= MAX_ATTACHMENTS}
				onClick={() => fileRef.current?.click()}
			>
				{uploading ? (
					<span className="size-3.5 animate-pulse rounded-full bg-primary/60" />
				) : (
					<Plus className={compact ? "size-3.5" : "size-4"} />
				)}
			</Button>
			<input
				ref={fileRef}
				type="file"
				multiple
				className="hidden"
				onChange={(event) => void pick(event.target.files)}
			/>
		</>
	);
}

/** 附件区(只读态,详情页用)—— 名字 + 大小;给了 `onOpen` 就能点开预览 */
export function TaskAttachmentList({
	attachments,
	onOpen,
}: {
	attachments: TaskAttachment[];
	onOpen?: (attachment: TaskAttachment) => void;
}) {
	if (attachments.length === 0) {
		return <p className="text-sm text-muted-foreground">（没有附件）</p>;
	}
	return <AttachmentChips attachments={attachments} onOpen={onOpen} />;
}

/** 附件条目(名字 + 大小 + 可选删除)—— 编辑态与只读态共用 */
export function AttachmentChips({
	attachments,
	onRemove,
	onOpen,
	disabled,
}: {
	attachments: TaskAttachment[];
	onRemove?: (id: string) => void;
	onOpen?: (attachment: TaskAttachment) => void;
	disabled?: boolean;
}) {
	return (
		<div className="flex flex-wrap gap-2">
			{attachments.map((file) => (
				<AttachmentChip key={file.id} file={file} onPreview={onOpen} onRemove={onRemove} disabled={disabled} showSize />
			))}
		</div>
	);
}

/** 单个附件的预览与移除入口。 */
export function AttachmentChip({
	file,
	onPreview,
	onRemove,
	disabled,
	showSize = false,
}: {
	/** 最小形状:只带 id + 名字也能用(评论 / 征询的待传附件没有 size) */
	file: Pick<TaskAttachment, "id" | "name"> & Partial<Pick<TaskAttachment, "size" | "contentType">>;
	onPreview?: (file: TaskAttachment) => void;
	onRemove?: (id: string) => void;
	disabled?: boolean;
	showSize?: boolean;
}) {
	const body = (
		<>
			<Paperclip className="size-3 shrink-0" />
			<span className="min-w-0 max-w-64 truncate">{file.name}</span>
			{showSize && typeof file.size === "number" && Number.isFinite(file.size) ? (
				<span className="shrink-0">{formatBytes(file.size)}</span>
			) : null}
		</>
	);
	return (
		<span className="inline-flex min-w-0 max-w-56 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
			{onPreview ? (
				<button
					type="button"
					title={`预览 ${file.name}`}
					className="inline-flex min-w-0 items-center gap-1.5 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
					onClick={() => onPreview?.(file as TaskAttachment)}
				>
					{body}
				</button>
			) : (
				body
			)}
			{onRemove ? (
				<button
					type="button"
					aria-label={`移除 ${file.name}`}
					disabled={disabled}
					className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
					onClick={() => onRemove(file.id)}
				>
					<X className="size-3" />
				</button>
			) : null}
		</span>
	);
}
