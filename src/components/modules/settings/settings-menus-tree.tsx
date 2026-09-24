import { EyeOff, Plus, Trash2 } from "lucide-react";

import { NAV_ICON_MAP } from "#/components/layout/nav-config";
import type { MenuTreeNode } from "#/components/layout/nav-menu";
import { SortableTree } from "#/components/modules/shared/sortable-tree";
import { ActionIconButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { useTreePrefs } from "#/hooks/use-tree-prefs";
import { recordIdFromMenuDetailPath } from "#/lib/menu-detail-path";
import { MENU_TYPE } from "#/lib/menu-spec";

/**
 * 菜单树 —— 交互(拖拽 / 折叠 / 选中 / 键盘)全在 `shared/sortable-tree.tsx`,
 * 这里只负责**这一行长什么样**:图标 + 名称 + 参数化/隐藏徽章 + 路径;
 * 行尾操作(新增子菜单 / 编辑 / 删除)交给 `SortableTree` 的 `renderActions`,悬停才显形。
 *
 * 隐藏项(`visible = 0`)照常显示,只是带一个「隐藏」徽标 —— 管理页要能看见它们。
 */
export function SettingsMenusTree({
	tree,
	selectedId,
	dragDisabled,
	onSelect,
	onReorder,
	onAddChild,
	onDelete,
}: {
	tree: MenuTreeNode[];
	selectedId: string | null;
	/** 有未保存的修改时禁止重排(否则顺序与详情对不上) */
	dragDisabled?: boolean;
	onSelect: (node: MenuTreeNode) => void;
	/** 把"拖动的节点"落到"目标节点"的前 / 后 */
	onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
	/**
	 * 行尾快捷操作(悬停显形、不会顺带选中该行 —— 由 `SortableTree` 统一处理)。
	 * **只有新增 / 删除**:点节点右侧就是编辑面板,行上再放一个「编辑」是冗余的。
	 */
	onAddChild: (node: MenuTreeNode) => void;
	onDelete: (node: MenuTreeNode) => void;
}) {
	/** 展开态记在参数管理的 `page.tree` 里,下次打开还是这套 */
	const { initialExpandedIds, persist: persistTree } = useTreePrefs("settings.menus");

	return (
		<SortableTree
			initialExpandedIds={initialExpandedIds}
			onExpandedChange={persistTree}
			nodes={tree}
			selectedId={selectedId}
			dragDisabled={dragDisabled}
			ariaLabel="菜单树"
			searchPlaceholder="搜索菜单名 / 路径 / 权限…"
			searchText={(node) => `${node.name} ${node.path ?? ""} ${node.perm ?? ""}`}
			onSelect={onSelect}
			onReorder={onReorder}
			renderRow={(node) => {
				const Icon = NAV_ICON_MAP[node.icon as keyof typeof NAV_ICON_MAP];
				return (
					<>
						{Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
						<span className="min-w-0 flex-1 truncate text-[13px]">{node.name}</span>
						{recordIdFromMenuDetailPath(node.path) ? (
							<Badge variant="outline" className="px-1.5 text-[10.5px] text-primary">
								参数化
							</Badge>
						) : null}
						{Number(node.type) === MENU_TYPE.BUTTON ? (
							<Badge variant="outline" className="px-1.5 text-[10.5px] text-hue-violet-fg">
								按钮
							</Badge>
						) : null}
						{Number(node.type) === MENU_TYPE.BUTTON && node.perm ? (
							<span className="max-w-40 truncate font-mono text-[11px] text-muted-foreground/70">{node.perm}</span>
						) : null}
						{node.visible === 0 ? (
							<Badge variant="outline" className="gap-1 px-1.5 text-[10.5px] text-muted-foreground">
								<EyeOff className="size-3" />
								隐藏
							</Badge>
						) : null}
						{node.path ? (
							<span className="max-w-40 truncate font-mono text-[11px] text-muted-foreground/70">{node.path}</span>
						) : (
							<span className="text-[11px] text-muted-foreground/60">分组</span>
						)}
					</>
				);
			}}
			renderActions={(node) => (
				<>
					<ActionIconButton label={`在「${node.name}」下新增子菜单`} onClick={() => onAddChild(node)}>
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
