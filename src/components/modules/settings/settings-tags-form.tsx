import { useEffect, useState } from "react";

import { DetailMeta, type DetailMetaInfo } from "#/components/modules/shared/detail-dialog";
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

export type TagFormValues = { label: string; value: string | null; desc: string | null };

/**
 * 标签节点表单 —— 同时服务「新增」(在某父节点下挂一个)与「编辑」(改 label / value / desc)。
 * 不在这层写库:把值抛回页面,由页面走 tRPC。
 */
export function SettingsTagsForm({
	open,
	mode,
	parentLabel,
	initial,
	pending,
	meta,
	onOpenChange,
	onSubmit,
}: {
	open: boolean;
	mode: "create" | "edit";
	parentLabel?: string | null;
	initial?: TagFormValues | null;
	pending?: boolean;
	/** 创建 / 更新时间(编辑模式由页面传;新建为 null,不渲染那一行) */
	meta?: DetailMetaInfo | null;
	onOpenChange: (next: boolean) => void;
	onSubmit: (values: TagFormValues) => void;
}) {
	const [label, setLabel] = useState("");
	const [value, setValue] = useState("");
	const [desc, setDesc] = useState("");

	useEffect(() => {
		if (!open) return;
		if (mode === "edit" && initial) {
			setLabel(initial.label);
			setValue(initial.value ?? "");
			setDesc(initial.desc ?? "");
		} else {
			setLabel("");
			setValue("");
			setDesc("");
		}
	}, [open, mode, initial]);

	const trimmed = label.trim();

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{mode === "create" ? "新增标签节点" : "编辑标签节点"}</DialogTitle>
					<DialogDescription>
						{mode === "create"
							? parentLabel
								? `在「${parentLabel}」下新增一个子节点`
								: "新增一个顶层维度(标签分类)"
							: "修改名称 / 取值 / 含义"}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<DetailRow label="名称" htmlFor="tag-label">
						<Input
							id="tag-label"
							value={label}
							spellCheck={false}
							className="text-sm"
							placeholder="如 场所风险等级 / 红色"
							onChange={(event) => setLabel(event.target.value)}
						/>
					</DetailRow>
					<DetailRow label="取值(可选)" htmlFor="tag-value">
						<Input
							id="tag-value"
							value={value}
							spellCheck={false}
							className="font-mono text-xs"
							placeholder="可与名称不同,留空则同名称"
							onChange={(event) => setValue(event.target.value)}
						/>
					</DetailRow>
					<DetailRow label="含义(可选)" htmlFor="tag-desc">
						<Textarea
							id="tag-desc"
							value={desc}
							rows={3}
							className="text-xs"
							placeholder="这个标签代表什么,给人看的说明"
							onChange={(event) => setDesc(event.target.value)}
						/>
					</DetailRow>
				</div>

				<DetailMeta meta={meta} />
				<DialogFooter className="gap-2">
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						disabled={pending || trimmed.length === 0}
						onClick={() => onSubmit({ label: trimmed, value: value.trim() || null, desc: desc.trim() || null })}
					>
						{pending ? "保存中…" : mode === "create" ? "创建" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
