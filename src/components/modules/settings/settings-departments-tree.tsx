import { Building2, Plus, Trash2 } from "lucide-react";

import { SortableTree } from "#/components/modules/shared/sortable-tree";
import { ActionIconButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { useTreePrefs } from "#/hooks/use-tree-prefs";

/** 部门表的一行(tRPC 出参形状) */
export type DeptRow = {
	id: string;
	parentId: string | null;
	name: string;
	sort: number;
	status: number;
	remark: string | null;
	/** 创建 / 更新时间(ISO 字符串;编辑面板底部统一展示) */
	createTime: string | null;
	updateTime: string | null;
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
	/** 展开态记在参数管理的 `page.tree` 里,下次打开还是这套(hook 必须在所有 return 之前,别放进分支) */
	const { initialExpandedIds, persist: persistTree } = useTreePrefs("settings.departments");
	// 空态:不要自带边框的盒子 —— 菜单 / 标签两棵树的容器就是外层那张 `Card`,
	// 这里再多一层 `border` 会变成"框里套框"(而且 `min-h-48` 会和栅格的下限打架)。
	if (nodes.length === 0) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
				<Building2 className="size-8 opacity-40" />
				<p className="text-[12.5px]">还没有部门,点右上角的 ＋ 新增一个</p>
			</div>
		);
	}

	return (
		<SortableTree
			initialExpandedIds={initialExpandedIds}
			onExpandedChange={persistTree}
			nodes={nodes}
			selectedId={selectedId}
			ariaLabel="部门树"
			searchPlaceholder="搜索部门名…"
			searchText={(node) => node.name}
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
	);
}
