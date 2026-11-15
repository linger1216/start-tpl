import { useState } from "react";
import { toast } from "sonner";
import type { FileRow } from "#/components/modules/settings/files/table";
import { useFileUpload } from "#/hooks/use-file-upload";

/**
 * 「选完即传」的统一骨架 —— `uploadMany` + 失败逐个 toast + 上传中状态 + 清空 input。
 * 行怎么落到本地状态(附件对象 / 只留 id)由调用方 `onRows` 决定;
 * `existing` 取**发起前**的已有数量(服务端按它算还能收几个)。
 */
export function useAttachmentUpload({
	limit,
	existing,
	onRows,
	resetInput,
}: {
	limit: number;
	existing: () => number;
	onRows: (rows: FileRow[]) => void;
	resetInput?: () => void;
}) {
	const { uploadMany } = useFileUpload();
	const [uploading, setUploading] = useState(false);

	async function pick(files: FileList | null) {
		if (!files || files.length === 0) return;
		setUploading(true);
		try {
			const { rows, failed } = await uploadMany(files, { kind: "private", limit, existing: existing() });
			for (const message of failed) toast.error(message);
			if (rows.length > 0) onRows(rows);
		} finally {
			setUploading(false);
			resetInput?.();
		}
	}

	return { uploading, pick };
}
