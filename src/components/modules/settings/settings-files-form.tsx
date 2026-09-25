import { useEffect, useState } from "react";

import type { FileRow } from "#/components/modules/settings/settings-files-table";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";

/**
 * 重命名(改)—— 只改**展示用**的文件名。
 *
 * 对象键(`{yyyy}/{MM}/{nanoid}.{ext}`)与桶里的对象**都不动**:改键等于搬家,
 * 而历史记录 / 已发出去的链接都还指着旧键。文件名只是给人看的那一层。
 */
export function SettingsFilesForm({
	row,
	open,
	pending = false,
	onOpenChange,
	onSubmit,
}: {
	row: FileRow | null;
	open: boolean;
	pending?: boolean;
	onOpenChange: (next: boolean) => void;
	onSubmit: (name: string) => void;
}) {
	const [name, setName] = useState("");

	// 打开时灌入当前值 —— 与三个 tab 编辑界面不同,这里没有多 tab 共享 state 的问题
	useEffect(() => {
		if (open) setName(row?.originName ?? "");
	}, [open, row]);

	const trimmed = name.trim();
	const canSubmit = trimmed.length > 0 && trimmed !== row?.originName;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>重命名文件</DialogTitle>
					<DialogDescription>只改展示用文件名;对象键与桶里的对象保持不变。</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1">
					<DetailRow label="文件名" htmlFor="file-origin-name">
						<Input
							id="file-origin-name"
							value={name}
							autoFocus
							className="h-8 text-[13px]"
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && canSubmit) onSubmit(trimmed);
							}}
						/>
					</DetailRow>
					<DetailRow label="对象键">
						<span className="font-mono text-[11.5px] text-muted-foreground">{row?.objectKey ?? "—"}</span>
					</DetailRow>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
						取消
					</Button>
					<Button onClick={() => onSubmit(trimmed)} disabled={pending || !canSubmit}>
						{pending ? "保存中…" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
