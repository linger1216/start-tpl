import { Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { useFileUpload } from "#/hooks/use-file-upload";
import { formatBytes } from "#/lib/format";
import type { TaskAttachment } from "#/lib/task-content";

/** 与后端 `taskPayloadSchema.attachments` 的 `.max(20)` 对齐 */
const MAX_FILES = 20;

/**
 * 附件区(编辑态)—— 选完即传(复用 `useFileUpload` 的秒传 / 直传链路),提交时只带 `sys_file.id`。
 *
 * 与评论附件**完全同一套路**(`task-close-comments.tsx` 是模板):一并传完大文件,点保存只是轻量写。
 * 私桶(`"private"`)—— 任务附件不该公开直链。
 */
export function TaskAttachmentPicker({
	value,
	onChange,
	disabled,
}: {
	value: TaskAttachment[];
	onChange: (next: TaskAttachment[]) => void;
	disabled?: boolean;
}) {
	const { upload } = useFileUpload();
	const fileRef = useRef<HTMLInputElement | null>(null);
	const [uploading, setUploading] = useState(false);

	async function pick(files: FileList | null) {
		if (!files || files.length === 0) return;
		setUploading(true);
		try {
			for (const file of Array.from(files).slice(0, MAX_FILES - value.length)) {
				const result = await upload(file, "private");
				if (!result.ok) {
					toast.error(result.message);
					continue;
				}
				onChange([...value, { id: result.row.id, name: result.row.originName, size: result.row.size }]);
			}
		} finally {
			setUploading(false);
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	return (
		<div className="space-y-2">
			{value.length > 0 ? (
				<AttachmentChips
					attachments={value}
					onRemove={(id) => onChange(value.filter((item) => item.id !== id))}
					disabled={disabled}
				/>
			) : null}
			<input
				ref={fileRef}
				type="file"
				multiple
				className="hidden"
				onChange={(event) => void pick(event.target.files)}
			/>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={disabled || uploading || value.length >= MAX_FILES}
				onClick={() => fileRef.current?.click()}
			>
				<Paperclip className="size-3.5" />
				{uploading ? "上传中…" : "添加附件"}
			</Button>
		</div>
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

function AttachmentChips({
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
			{attachments.map((file) => {
				const body = (
					<>
						<Paperclip className="size-3 shrink-0" />
						<span className="min-w-0 max-w-64 truncate">{file.name}</span>
						{Number.isFinite(file.size) ? <span className="shrink-0">{formatBytes(file.size)}</span> : null}
					</>
				);
				return (
					<span
						key={file.id}
						className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
					>
						{onOpen ? (
							<button
								type="button"
								className="inline-flex min-w-0 items-center gap-1.5 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
								onClick={() => onOpen(file)}
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
			})}
		</div>
	);
}
