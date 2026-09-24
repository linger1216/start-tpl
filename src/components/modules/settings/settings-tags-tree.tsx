import { Folder, Plus, Tag, Trash2 } from "lucide-react";

import { SortableTree } from "#/components/modules/shared/sortable-tree";
import { ActionIconButton } from "#/components/ui/action-button";
import { useTreePrefs } from "#/hooks/use-tree-prefs";

/** 标签树节点(前端拼树后的形状)—— 行字段 + 树特有字段(与部门树同构,别再逐字段抄一遍) */
export type TagNode = TagRow & {
	depth: number;
	children: TagNode[];
};

/** 平铺行 → 树(自关联,递归拼;排序用 `sort`,再 `label`) */
export function buildTagTree(rows: readonly TagRow[]): TagNode[] {
	const byParent = new Map<string | null, TagRow[]>();
	for (const row of rows) {
		const key = row.parentId ?? null;
		const bucket = byParent.get(key);
		if (bucket) bucket.push(row);
		else byParent.set(key, [row]);
	}
	const make = (row: TagRow, depth: number): TagNode => {
		const kids = (byParent.get(row.id) ?? []).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
		return { ...row, depth, children: kids.map((kid) => make(kid, depth + 1)) };
	};
	const roots = (byParent.get(null) ?? []).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
	return roots.map((root) => make(root, 0));
}

/** 平铺行的形状(与 tRPC `tag.list` 出参一致) */
export type TagRow = {
	id: string;
	parentId: string | null;
	label: string;
	value: string | null;
	desc: string | null;
	sort: number;
	/** 创建 / 更新时间(ISO 字符串;编辑面板底部统一展示) */
	createTime: string | null;
	updateTime: string | null;
};

/**
 * 标签树 —— 交互(同级拖拽 / 折叠 / 选中 / 键盘)复用 `shared/sortable-tree.tsx`,
 * 这里只描述**这一行长什么样**:维度用文件夹图标、标签用 Tag 图标;行尾操作(新增子节点 / 删除)
 * 交给 `SortableTree` 的 `renderActions` —— **树行窄,那里用纯图标**(悬停才显形、点击不会选中该行)。
 * 「编辑」不放在行上:点节点右侧就是编辑面板。
 */
export function SettingsTagsTree({
	tree,
	selectedId,
	dragDisabled,
	onSelect,
	onAddChild,
	onDelete,
	onMove,
}: {
	tree: TagNode[];
	selectedId: string | null;
	dragDisabled?: boolean;
	onSelect: (node: TagNode) => void;
	onAddChild: (node: TagNode) => void;
	onDelete: (node: TagNode) => void;
	/** 把"拖动的节点"落到"目标节点"的前 / 后(同级) */
	onMove: (draggedId: string, targetId: string, position: "before" | "after") => void;
}) {
	/** 展开态记在参数管理的 `page.tree` 里,下次打开还是这套 */
	const { initialExpandedIds, persist: persistTree } = useTreePrefs("settings.tags");

	return (
		<SortableTree
			initialExpandedIds={initialExpandedIds}
			onExpandedChange={persistTree}
			nodes={tree}
			selectedId={selectedId}
			dragDisabled={dragDisabled}
			ariaLabel="标签树"
			searchPlaceholder="搜索标签名 / 取值…"
			searchText={(node) => `${node.label} ${node.value ?? ""}`}
			onSelect={onSelect}
			onReorder={onMove}
			renderRow={(node) => (
				<>
					{node.parentId === null ? (
						<Folder className="size-3.5 shrink-0 text-hue-violet-fg" />
					) : (
						<Tag className="size-3.5 shrink-0 text-muted-foreground" />
					)}
					<span className="min-w-0 flex-1 truncate text-[13px]">{node.label}</span>
					{node.value ? (
						<span className="max-w-32 truncate font-mono text-[11px] text-muted-foreground/70">{node.value}</span>
					) : null}
				</>
			)}
			renderActions={(node) => (
				<>
					<ActionIconButton label={`在「${node.label}」下新增子节点`} onClick={() => onAddChild(node)}>
						<Plus className="size-3.5" />
					</ActionIconButton>
					<ActionIconButton tone="danger" label={`删除「${node.label}」`} onClick={() => onDelete(node)}>
						<Trash2 className="size-3.5" />
					</ActionIconButton>
				</>
			)}
		/>
	);
}
