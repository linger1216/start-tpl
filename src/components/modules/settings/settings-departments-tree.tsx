import { Plus, Trash2 } from "lucide-react";

import { SortableTree } from "#/components/modules/shared/sortable-tree";
import { ActionIconButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";

/** 部门表的一行(tRPC 出参形状) */
export type DeptRow = {
	id: string;
	parentId: string | null;
	name: string;
	sort: number;
	status: number;
	remark: string | null;
};

export type DeptTreeNode = DeptRow & {
	depth: number;
	children: DeptTreeNode[];
};

/**
 * 平铺行 → 部门树(自关联)。
 *
 * 容错那条与菜单树一致:`parentId` 指向一个**不存在的父**(父被删了)时,当一级节点处理 ——
 * 否则那一枝会整块消失在界面上(数据在、但谁也看不见,最难排查)。
 */
export function buildDeptTree(rows: readonly DeptRow[]): { tree: DeptTreeNode[]; byId: Map<string, DeptTreeNode> } {
	const byParent = new Map<string, DeptRow[]>();
	for (const row of rows) {
		const key = row.parentId ?? "";
		byParent.set(key, [...(byParent.get(key) ?? []), row]);
	}
	for (const list of byParent.values()) {
		list.sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name, "zh-Hans-CN"));
	}

	const known = new Set(rows.map((row) => row.id));
	const byId = new Map<string, DeptTreeNode>();
	const build = (parentKey: string, depth: number): DeptTreeNode[] =>
		(byParent.get(parentKey) ?? []).map((row) => {
			const node: DeptTreeNode = { ...row, depth, children: build(row.id, depth + 1) };
			byId.set(node.id, node);
			return node;
		});

	const roots = [...build("", 0)];
	// 父不存在的行(父被删)→ 提到一级,免得整枝消失
	for (const row of rows) {
		if (row.parentId && !known.has(row.parentId)) roots.push({ ...row, depth: 0, children: [] });
	}
	return { tree: roots, byId };
}

/** 部门树 —— 拖拽排序 + 选中(与菜单 / 标签两页共用 `SortableTree`) */
export function SettingsDepartmentsTree({
	nodes,
	selectedId,
	onSelect,
	onReorder,
	onAddChild,
	onDelete,
}: {
	nodes: DeptTreeNode[];
	selectedId: string | null;
	onSelect: (node: DeptTreeNode) => void;
	onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
	/**
	 * 行尾快捷操作(悬停显形、不会顺带选中该行 —— 由 `SortableTree` 统一处理)。
	 * **只有新增 / 删除**:点节点右侧就是编辑面板,行上再放一个「编辑」是冗余的。
	 */
	onAddChild: (node: DeptTreeNode) => void;
	onDelete: (node: DeptTreeNode) => void;
}) {
	return (
		<div className="min-h-48 rounded-lg border border-border bg-card p-2">
			{nodes.length === 0 ? (
				<p className="px-2 py-6 text-center text-[12.5px] text-muted-foreground">还没有部门,点右上角「新增部门」</p>
			) : (
				<SortableTree
					nodes={nodes}
					selectedId={selectedId}
					ariaLabel="部门树"
					onSelect={onSelect}
					onReorder={onReorder}
					renderRow={(node) => (
						<>
							<span className="min-w-0 flex-1 truncate text-[13px]">{node.name}</span>
							{node.status === 0 ? (
								<Badge variant="outline" className="px-1.5 text-[10.5px] text-muted-foreground">
									已停用
								</Badge>
							) : null}
						</>
					)}
					renderActions={(node) => (
						<>
							<ActionIconButton label={`在「${node.name}」下新增子部门`} onClick={() => onAddChild(node)}>
								<Plus className="size-3.5" />
							</ActionIconButton>
							<ActionIconButton tone="danger" label={`删除「${node.name}」`} onClick={() => onDelete(node)}>
								<Trash2 className="size-3.5" />
							</ActionIconButton>
						</>
					)}
				/>
			)}
		</div>
	);
}
