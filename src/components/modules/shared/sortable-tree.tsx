import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { DragEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "#/lib/utils";

/**
 * 可排序树 —— 支持**同级拖拽排序**(不允许跨级)与键盘等价操作。
 *
 * 交互约定:
 *  - 行本身可拖;拖到**同一父节点下的兄弟**上才允许放下(上半 = 插到它前面,下半 = 插到它后面);
 *  - 拖到别的层级 → 显示禁止态,松开无效(服务端应再校一遍,双层防线);
 *  - 键盘可达:选中行后可用 ↑ / ↓ 方向键在同级内上移 / 下移(拖拽的等价操作);
 *  - 带 `collapsed` 内部态,展开 / 收起不上升为受控 prop(它纯粹是视觉折叠)。
 *
 * 数据只有 `id` / `name` / `depth` / `parentId` / `children` 五项是必需的,
 * 其余展示内容(图标、徽章、右侧附注)由 `renderIcon` / `renderTrailing` 注入 ——
 * 这样「菜单管理」「组织架构」「分类目录」可以共用一个实现。
 */

export type SortableTreeNode<TData = unknown> = {
	id: string;
	name: string;
	/** 层级(0 = 一级);用于缩进与 `aria-level` */
	depth: number;
	/** 父节点 id(同级判定的唯一依据);一级节点为 `null` */
	parentId: string | null;
	children: SortableTreeNode<TData>[];
	/** 调用方附加的原始数据(选中时原样回传) */
	data?: TData;
};

/** 把「拖动的节点」落到「目标节点」的前 / 后 */
export type ReorderPosition = "before" | "after";

export function SortableTree<TData = unknown>({
	nodes,
	selectedId,
	dragDisabled = false,
	onSelect,
	onReorder,
	renderIcon,
	renderTrailing,
	ariaLabel = "树",
	className,
}: {
	nodes: SortableTreeNode<TData>[];
	selectedId?: string | null;
	/** 有未保存的修改时禁止重排(否则顺序与右侧表单对不上) */
	dragDisabled?: boolean;
	onSelect?: (node: SortableTreeNode<TData>) => void;
	/**
	 * 拖放结果 / 键盘上移下移。
	 * 键盘操作时 `draggedId === targetId === 当前节点`,位置表示「相对自己往前 / 往后一格」。
	 */
	onReorder?: (draggedId: string, targetId: string, position: ReorderPosition) => void;
	renderIcon?: (node: SortableTreeNode<TData>) => ReactNode;
	/** 行右侧的徽章 / 附注区 */
	renderTrailing?: (node: SortableTreeNode<TData>) => ReactNode;
	ariaLabel?: string;
	className?: string;
}) {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	const [dragId, setDragId] = useState<string | null>(null);
	const [dropHint, setDropHint] = useState<{ id: string; position: ReorderPosition; allowed: boolean } | null>(null);
	const selectedRef = useRef<HTMLDivElement | null>(null);

	// 选中项变化 → 滚进可视区(新建的节点排在同级末尾,不滚用户看不到它被加在哪)
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在选中项变化时滚一次,行 DOM 引用由 ref 提供
	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);

	const findNode = (list: SortableTreeNode<TData>[], id: string): SortableTreeNode<TData> | null => {
		for (const node of list) {
			if (node.id === id) return node;
			const deeper = findNode(node.children, id);
			if (deeper) return deeper;
		}
		return null;
	};

	/** 同级判定:父子相同才允许落 —— 这一条就是"不能跨级" */
	const isSameLevel = (a: string, b: string) => {
		const left = findNode(nodes, a);
		const right = findNode(nodes, b);
		return Boolean(left && right && left.parentId === right.parentId);
	};

	function handleDragOver(event: DragEvent<HTMLElement>, targetId: string) {
		if (!dragId || dragId === targetId) return;
		if (!isSameLevel(dragId, targetId)) {
			// 不 preventDefault = 不允许放下;同时给一个视觉反馈
			setDropHint({ id: targetId, position: "after", allowed: false });
			return;
		}
		event.preventDefault();
		const rect = event.currentTarget.getBoundingClientRect();
		const position: ReorderPosition = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
		setDropHint({ id: targetId, position, allowed: true });
	}

	function handleDrop(event: DragEvent<HTMLElement>, targetId: string) {
		event.preventDefault();
		const hint = dropHint;
		setDropHint(null);
		setDragId(null);
		if (!dragId || dragId === targetId || !hint?.allowed) return;
		onReorder?.(dragId, targetId, hint.position);
	}

	const renderNodes = (list: SortableTreeNode<TData>[]): ReactNode =>
		list.map((node) => {
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
								event.preventDefault();
								onSelect?.(node);
							}
							if (event.key === "ArrowUp" && !dragDisabled) {
								event.preventDefault();
								onReorder?.(node.id, node.id, "before");
							}
							if (event.key === "ArrowDown" && !dragDisabled) {
								event.preventDefault();
								onReorder?.(node.id, node.id, "after");
							}
						}}
						className={cn(
							"group relative flex items-center gap-1.5 rounded-lg border border-transparent py-1.5 pr-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
							selectedId === node.id ? "border-primary/40 bg-primary/5" : "hover:bg-muted/60",
							hint && !hint.allowed && "opacity-60",
							dragDisabled ? "cursor-default" : "cursor-grab",
						)}
						style={{ paddingLeft: 6 + node.depth * 18 }}
						onClick={() => onSelect?.(node)}
					>
						{/* 放下位置提示线 */}
						{hint?.allowed ? (
							<span
								className={cn(
									"pointer-events-none absolute right-2 left-2 h-0.5 rounded-full bg-primary",
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
										event.stopPropagation();
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

						{renderIcon?.(node)}
						<span className={cn("min-w-0 flex-1 truncate", node.depth === 0 ? "text-[13px]" : "text-[12.5px]")}>
							{node.name}
						</span>
						{renderTrailing?.(node)}
					</div>
					{hasChildren && !isCollapsed ? renderNodes(node.children) : null}
				</div>
			);
		});

	return (
		<div role="tree" aria-label={ariaLabel} className={cn("space-y-0.5", className)}>
			{renderNodes(nodes)}
		</div>
	);
}
