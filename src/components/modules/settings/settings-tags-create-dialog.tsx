import { useEffect, useState } from "react";

import { DetailMeta } from "#/components/modules/shared/detail-dialog";
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
import { Textarea } from "#/components/ui/textarea";

export type TagCreateValues = { label: string; value: string | null; desc: string | null };

/**
 * 新建标签节点 dialog —— 服务「工具条新增维度」与「行尾 + 新增子节点」两个入口。
 *
 * 为什么单独是 dialog:`SettingsTagsForm` 是右侧常驻编辑面板(参表 `SettingsMenusForm`),
 * 新建需要「在某个 parent 下挂一个」的语境,但页面可能还没选中节点(工具条新增维度),
 * 没有「当前选中节点 → 右侧表单」这条路径。
 *
 * 编辑沿用右侧表单,不在这里 —— 与菜单同形(菜单也是右侧编辑 + 新建走 `createMenu`)。
 */
export function SettingsTagsCreateDialog({
	open,
	parentLabel,
	pending,
	onOpenChange,
	onSubmit,
}: {
	open: boolean;
	parentLabel: string | null;
	pending?: boolean;
	onOpenChange: (next: boolean) => void;
	onSubmit: (values: TagCreateValues) => void;
}) {
	const [label, setLabel] = useState("");
	const [value, setValue] = useState("");
	const [desc, setDesc] = useState("");

	useEffect(() => {
		if (!open) return;
		setLabel("");
		setValue("");
		setDesc("");
	}, [open]);

	const trimmed = label.trim();

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>新增标签节点</DialogTitle>
					<DialogDescription>
						{parentLabel ? `在「${parentLabel}」下新增一个子节点` : "新增一个顶层维度(标签分类)"}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<DetailRow label="名称" htmlFor="tag-create-label">
						<Input
							id="tag-create-label"
							value={label}
							spellCheck={false}
							className="text-sm"
							placeholder="如 场所风险等级 / 红色"
							onChange={(event) => setLabel(event.target.value)}
						/>
					</DetailRow>
					<DetailRow label="取值(可选)" htmlFor="tag-create-value">
						<Input
							id="tag-create-value"
							value={value}
							spellCheck={false}
							className="font-mono text-xs"
							placeholder="可与名称不同,留空则同名称"
							onChange={(event) => setValue(event.target.value)}
						/>
					</DetailRow>
					<DetailRow label="含义(可选)" htmlFor="tag-create-desc">
						<Textarea
							id="tag-create-desc"
							value={desc}
							rows={3}
							className="text-xs"
							placeholder="这个标签代表什么,给人看的说明"
							onChange={(event) => setDesc(event.target.value)}
						/>
					</DetailRow>
				</div>

				{/* 新建没有时间,DetailMeta 不渲染 —— 传 null 兜底,跟原行为一致 */}
				<DetailMeta meta={null} />
				<DialogFooter className="gap-2">
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						disabled={pending || trimmed.length === 0}
						onClick={() => onSubmit({ label: trimmed, value: value.trim() || null, desc: desc.trim() || null })}
					>
						{pending ? "创建中…" : "创建"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
