import { ChevronDown, ChevronRight, EyeOff, GripVertical } from "lucide-react";
import type { DragEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { NAV_ICON_MAP } from "#/components/layout/nav-config";
import type { MenuTreeNode } from "#/components/layout/nav-menu";
import { Badge } from "#/components/ui/badge";
import { recordIdFromMenuDetailPath } from "#/lib/menu-detail-path";
import { cn } from "#/lib/utils";

/**
 * 菜单树 —— 支持**同级拖拽排序**(不允许跨级)。
 *
 * 交互约定:
 * - 行本身可拖;拖到**同一父节点下的兄弟**上才允许放下(上半 = 插到它前面,下半 = 插到它后面);
 * - 拖到别的层级 → 显示禁止态,松开无效(服务端也会再校一遍,双层防线);
 * - 键盘可达:选中行后可用 ↑ / ↓ 按钮在同级内上下移动(拖拽的等价操作);
 * - 隐藏项(`visible = 0`)照常显示,只是带一个「隐藏」徽标 —— 管理页要能看见它们。
 */
export function SettingsMenusTree({
	tree,
	selectedId,
	dragDisabled,
	onSelect,
	onReorder,
}: {
	tree: MenuTreeNode[];
	selectedId: string | null;
	/** 有未保存的修改时禁止重排(否则顺序与详情对不上) */
	dragDisabled?: boolean;
	onSelect: (node: MenuTreeNode) => void;
	/** 把"拖动的节点"落到"目标节点"的前 / 后 */
	onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
}) {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	const [dragId, setDragId] = useState<string | null>(null);
	const selectedRef = useRef<HTMLDivElement | null>(null);

	// 选中项变化 → 滚进可视区(新建的菜单排在同级末尾,不滚用户看不到它被加在哪)
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在选中项变化时滚一次,行 DOM 引用由 ref 提供
	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);
	const [dropHint, setDropHint] = useState<{ id: string; position: "before" | "after"; allowed: boolean } | null>(null);

	/** 同级判定:父子相同才允许落 —— 这一条就是"不能跨级" */
	const isSameLevel = (a: string, b: string) => {
		const find = (nodes: MenuTreeNode[], id: string): MenuTreeNode | null => {
			for (const node of nodes) {
				if (node.id === id) return node;
				const deeper = find(node.children, id);
				if (deeper) return deeper;
			}
			return null;
		};
		const left = find(tree, a);
		const right = find(tree, b);
		return Boolean(left && right && (left.parentId ?? null) === (right.parentId ?? null));
	};

	function handleDragOver(event: DragEvent<HTMLElement>, targetId: string) {
		if (!dragId || dragId === targetId) return;
		const allowed = isSameLevel(dragId, targetId);
		if (!allowed) {
			// 不 preventDefault = 不允许放下;同时给一个视觉反馈
			setDropHint({ id: targetId, position: "after", allowed: false });
			return;
		}
		event.preventDefault;
		const rect = event.currentTarget.getBoundingClientRect;
		const position = event.clientY < rect().top + rect().height / 2 ? "before" : "after";
		setDropHint({ id: targetId, position, allowed: true });
	}

	function handleDrop(event: DragEvent<HTMLElement>, targetId: string) {
		event.preventDefault;
		const hint = dropHint;
		setDropHint(null);
		setDragId(null);
		if (!dragId || dragId === targetId || !hint?.allowed) return;
		onReorder(dragId, targetId, hint.position);
	}

	const renderNodes = (nodes: MenuTreeNode[]) =>
		nodes.map((node) => {
			const Icon = NAV_ICON_MAP[node.icon as keyof typeof NAV_ICON_MAP];
			const hasChildren = node.children.length > 0;
			const isCollapsed = collapsed.has(node.id);
			const hint = dropHint?.id === node.id ? dropHint : null;
			return (
				<div key={node.id}>
					<div
						ref={selectedId === node.id ? selectedRef : undefined}
						draggable={!dragDisabled}
						onDragStart={() => setDragId(node.id)}
						onDragEnd={() => {
							setDragId(null);
							setDropHint(null);
						}}
						onDragOver={(event) => handleDragOver(event, node.id)}
						onDrop={(event) => handleDrop(event, node.id)}
						role="treeitem"
						aria-selected={selectedId === node.id}
						aria-level={node.depth + 1}
						aria-expanded={hasChildren ? !isCollapsed : undefined}
						tabIndex={0}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault;
								onSelect(node);
							}
							if (event.key === "ArrowUp" && !dragDisabled) {
								event.preventDefault;
								onReorder(node.id, node.id, "before");
							}
							if (event.key === "ArrowDown" && !dragDisabled) {
								event.preventDefault;
								onReorder(node.id, node.id, "after");
							}
						}}
						className={cn(
							"group relative flex items-center gap-1.5 rounded-lg border border-transparent py-1.5 pr-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
							selectedId === node.id ? "border-primary/40 bg-primary/5" : "hover:bg-muted/60",
							hint && !hint.allowed && "opacity-60",
							dragDisabled ? "cursor-default" : "cursor-grab",
						)}
						style={{ paddingLeft: 6 + node.depth * 18 }}
						onClick={() => onSelect(node)}
					>
						{/* 放下位置提示线 */}
						{hint?.allowed ? (
							<span
								className={cn(
									"pointer-events-none absolute left-2 right-2 h-0.5 rounded-full bg-primary",
									hint.position === "before" ? "top-0" : "bottom-0",
								)}
							/>
						) : null}

						<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/50">
							{hasChildren ? (
								<button
									type="button"
									aria-label={isCollapsed ? "展开" : "收起"}
									className="rounded p-0.5 hover:bg-muted hover:text-foreground"
									onClick={(event) => {
										event.stopPropagation;
										setCollapsed((prev) => {
											const next = new Set(prev);
											if (next.has(node.id)) next.delete(node.id);
											else next.add(node.id);
											return next;
										});
									}}
								>
									{isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
								</button>
							) : (
								<GripVertical className="size-3.5" />
							)}
						</span>

						{Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
						<span className="min-w-0 flex-1 truncate text-[13px]">{node.name}</span>
						{recordIdFromMenuDetailPath(node.path) ? (
							<Badge variant="outline" className="px-1.5 text-[10.5px] text-primary">
								参数化
							</Badge>
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
					</div>
					{hasChildren && !isCollapsed ? renderNodes(node.children) : null}
				</div>
			);
		});

	return (
		<div role="tree" aria-label="菜单树" className="space-y-0.5">
			{renderNodes(tree)}
		</div>
	);
}
