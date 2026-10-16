import { Save, Undo2 } from "lucide-react";

import type { TagNode } from "#/components/modules/settings/settings-tags-tree";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Tag } from "#/components/ui/tag.tsx";
import { Textarea } from "#/components/ui/textarea";

/**
 * 标签节点的编辑值 —— 与 menu 的 `MenuFormValues` 同口径(都是 controlled 受控值,
 * 由 page 持有,`dirty` 由 page 用 JSON 比对计算)。
 */
export type TagFormValues = { label: string; value: string | null; desc: string | null };

/**
 * 从任意带 `label/value/desc` 的对象读出表单值 —— 实际只有 `TagNode` / tRPC 出参两种来源,
 * 但**不必**强求是 `TagNode`(create 时还没进树、byId 还没刷新,只能拿到 `TagRow`)。
 */
export function tagFormValues(node: { label: string; value: string | null; desc: string | null }): TagFormValues {
	return {
		label: node.label,
		value: node.value,
		desc: node.desc,
	};
}

/**
 * 右侧「节点详情」—— 选中节点时**直接编辑**(名称 / 取值 / 含义),
 * 跟菜单的 `SettingsMenusForm` 同形同口径:常驻 Card 内联表单,显式保存 + 「未保存」徽标。
 *
 * 新建走另一个 dialog(`SettingsTagsCreateDialog`,没有「选中的节点」就无处可放表单)。
 *
 * ⚠️ 不带 dialog 外壳:这是设计意图,跟「标签 → 直接编辑」的需求一一对应。
 *  - 没有 dialog 的开/合与重置副作用;
 *  - 「保存/还原」按钮直接放在面板底部;
 *  - page 通过 `dirty` 判断要不要 toast「未保存就切走了」。
 */
export function SettingsTagsForm({
	node,
	values,
	dirty,
	pending,
	onChange,
	onSave,
	onReset,
	onDelete,
	onAddChild,
}: {
	node: TagNode | null;
	values: TagFormValues;
	dirty: boolean;
	pending: boolean;
	onChange: (next: TagFormValues) => void;
	onSave: () => void;
	onReset: () => void;
	onDelete: () => void;
	/** 当前选中的就是 parent(在「新增子节点」按钮里直接调) */
	onAddChild: () => void;
}) {
	if (!node) {
		return (
			<div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
				左侧选一个标签节点,这里直接改它的名称 / 取值 / 含义
			</div>
		);
	}

	const trimmedLabel = values.label.trim();

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate text-sm font-medium text-foreground">{node.label}</div>
				</div>
				{dirty ? <span className="shrink-0 text-xs text-warn-fg">未保存</span> : null}
			</div>

			<DetailRow label="名称" htmlFor="tag-label">
				<Input
					id="tag-label"
					value={values.label}
					spellCheck={false}
					className="h-8 text-sm"
					placeholder="如 红色"
					onChange={(event) => onChange({ ...values, label: event.target.value })}
				/>
			</DetailRow>
			<DetailRow label="取值(可选)" htmlFor="tag-value">
				<Input
					id="tag-value"
					value={values.value ?? ""}
					spellCheck={false}
					className="h-8 font-mono text-xs"
					placeholder="可与名称不同,留空则同名称"
					onChange={(event) => onChange({ ...values, value: event.target.value })}
				/>
			</DetailRow>
			<DetailRow label="含义(可选)" htmlFor="tag-desc">
				<Textarea
					id="tag-desc"
					value={values.desc ?? ""}
					rows={3}
					className="text-xs"
					placeholder="这个标签代表什么,给人看的说明"
					onChange={(event) => onChange({ ...values, desc: event.target.value })}
				/>
			</DetailRow>

			<DetailMeta meta={{ createdAt: node.createTime, updatedAt: node.updateTime, id: node.id }} />

			{/* 动作行(三棵树统一):左 = 新增类,右 = 保存 / 还原 / 删除 —— 保存下面不再有别的东西 */}
			<div className="flex flex-wrap items-center justify-between gap-2 pt-1">
				<div className="flex flex-wrap items-center gap-2">
					<ActionButton disabled={pending} onClick={onAddChild}>
						新增子节点
					</ActionButton>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm" disabled={pending || !dirty || trimmedLabel.length === 0} onClick={onSave}>
						<Save className="size-3.5" />
						{pending ? "保存中…" : "保存"}
					</Button>
					<Button variant="outline" size="sm" disabled={pending || !dirty} onClick={onReset}>
						<Undo2 className="size-3.5" />
						还原
					</Button>
				</div>
			</div>
		</div>
	);
}
