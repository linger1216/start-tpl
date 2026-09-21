import { ChevronDown, ChevronRight, Folder, GripVertical, Plus, Tag, Trash2 } from "lucide-react";
import type { DragEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "#/lib/utils";

/** 标签树节点(前端拼树后的形状) */
export type TagNode = {
	id: string;
	parentId: string | null;
	label: string;
	value: string | null;
	desc: string | null;
	sort: number;
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
		return {
			id: row.id,
			parentId: row.parentId,
			label: row.label,
			value: row.value,
			desc: row.desc,
			sort: row.sort,
			depth,
			children: kids.map((kid) => make(kid, depth + 1)),
		};
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
};

/**
 * 标签树 —— 支持**同级拖拽排序**(与菜单树同一套交互),并直接提供「新增子节点 / 删除」操作。
 *
 * 行本身可拖;拖到**同一父节点下的兄弟**上才允许放下(上半 = 插到它前面,下半 = 插到它后面);
 * 拖到别的层级 → 显示禁止态,松开无效(服务端 `move` 也会再校一遍)。
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
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	const [dragId, setDragId] = useState<string | null>(null);
	const [dropHint, setDropHint] = useState<{ id: string; position: "before" | "after"; allowed: boolean } | null>(null);
	const selectedRef = useRef<HTMLDivElement | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在选中项变化时滚一次,行 DOM 引用由 ref 提供
	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);

	const isSameLevel = (a: string, b: string) => {
		const find = (nodes: TagNode[], id: string): TagNode | null => {
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
			setDropHint({ id: targetId, position: "after", allowed: false });
			return;
		}
		event.preventDefault();
		const rect = event.currentTarget.getBoundingClientRect();
		const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
		setDropHint({ id: targetId, position, allowed: true });
	}

	function handleDrop(event: DragEvent<HTMLElement>, targetId: string) {
		event.preventDefault();
		const hint = dropHint;
		setDropHint(null);
		setDragId(null);
		if (!dragId || dragId === targetId || !hint?.allowed) return;
		onMove(dragId, targetId, hint.position);
	}

	const renderNodes = (nodes: TagNode[]) =>
		nodes.map((node) => {
			const hasChildren = node.children.length > 0;
			const isCollapsed = collapsed.has(node.id);
			const hint = dropHint?.id === node.id ? dropHint : null;
			const isDim = node.parentId === null;
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
								onSelect(node);
							}
							if (event.key === "ArrowUp" && !dragDisabled) {
								event.preventDefault();
								onMove(node.id, node.id, "before");
							}
							if (event.key === "ArrowDown" && !dragDisabled) {
								event.preventDefault();
								onMove(node.id, node.id, "after");
							}
						}}
						className={cn(
							"group relative flex items-center gap-1.5 rounded-lg border border-transparent py-1.5 pr-1.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40",
							selectedId === node.id
								? "border-primary/40 bg-primary/5"
								: "hover:border-hue-blue-line hover:bg-[color:var(--af-hover)]",
							hint && !hint.allowed && "opacity-60",
							dragDisabled ? "cursor-default" : "cursor-grab",
						)}
						style={{ paddingLeft: 6 + node.depth * 18 }}
						onClick={() => onSelect(node)}
					>
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

						{isDim ? (
							<Folder className="size-3.5 shrink-0 text-[color:var(--hue-violet-fg)]" />
						) : (
							<Tag className="size-3.5 shrink-0 text-muted-foreground" />
						)}
						<span className="min-w-0 flex-1 truncate text-[13px]">{node.label}</span>
						{node.value ? (
							<span className="max-w-32 truncate font-mono text-[11px] text-muted-foreground/70">{node.value}</span>
						) : null}

						<button
							type="button"
							aria-label={`在「${node.label}」下新增子节点`}
							className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
							onClick={(event) => {
								event.stopPropagation();
								onAddChild(node);
							}}
						>
							<Plus className="size-3.5" />
						</button>
						<button
							type="button"
							aria-label={`删除「${node.label}」`}
							className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
							onClick={(event) => {
								event.stopPropagation();
								onDelete(node);
							}}
						>
							<Trash2 className="size-3.5" />
						</button>
					</div>
					{hasChildren && !isCollapsed ? renderNodes(node.children) : null}
				</div>
			);
		});

	return (
		<div role="tree" aria-label="标签树" className="space-y-0.5">
			{renderNodes(tree)}
		</div>
	);
}
