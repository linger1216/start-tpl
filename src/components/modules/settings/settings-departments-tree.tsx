import { Building2, Plus, Trash2 } from "lucide-react";

import { SortableTree } from "#/components/modules/shared/sortable-tree";
import { ActionIconButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { useTreePrefs } from "#/hooks/use-tree-prefs";
import type { TreeNode } from "#/lib/tree";

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

/** 部门树节点 —— 就是通用节点形态(`lib/tree.ts`),别在这儿再把 depth/children 抄一遍 */
export type DeptTreeNode = TreeNode<DeptRow>;

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
				<p className="text-xs">还没有部门,点右上角的 ＋ 新增一个</p>
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
					<span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
					{node.status === 0 ? (
						<Badge variant="outline" className="px-1.5 text-xs text-muted-foreground">
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
