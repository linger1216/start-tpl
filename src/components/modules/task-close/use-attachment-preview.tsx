import { useState } from "react";
import { TaskAttachmentPreview } from "#/components/modules/task-close/task-attachment-preview";
import type { TaskAttachment } from "#/lib/task/payload";

/**
 * 附件预览弹窗的**成套件** —— 状态机 + 弹窗本身,一处给全。
 *
 * 之前只收编了状态机(`value` / `open` / `preview` / `onOpenChange`),弹窗还得每个调用点各写一遍
 * `taskId` / `attachment` / `open` / `onOpenChange` 四个 prop(5 处逐字相同)。现在 hook 直接吐出
 * 可渲染的 `dialog`,调用点只写 `{preview.dialog}`。
 *
 * `taskId` 为空 → 不渲染弹窗(只读预览签不出地址,也没有可点的附件)。
 */
export function useAttachmentPreview<T extends { id: string }>(taskId?: string) {
	const [value, setValue] = useState<T | null>(null);
	const open = value !== null;
	const onOpenChange = (next: boolean) => {
		if (!next) setValue(null);
	};
	return {
		/** 正在预览的附件(`null` = 没开) */
		value,
		/** 打开某个附件的预览 */
		preview: (next: T) => setValue(next),
		/** 预览弹窗 —— 直接渲染它 */
		dialog: taskId ? (
			<TaskAttachmentPreview
				taskId={taskId}
				attachment={(value ?? null) as TaskAttachment | null}
				open={open}
				onOpenChange={onOpenChange}
			/>
		) : null,
	};
}
