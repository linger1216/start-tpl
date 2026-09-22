import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { DragEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "#/lib/utils";

/**
 * **可拖拽排序的树** —— 业务无关的那一半(菜单管理 / 标签管理共用同一套交互)。
 *
 * 为什么抽出来:原来 `settings-menus-tree.tsx` 与 `settings-tags-tree.tsx` 各写了一份
 * 「同级判定 + dragover/drop + 放下提示线 + 折叠 + 键盘上下移 + 选中滚动」,约 150 行**逐字重复**。
 * 重复的代价不是啰嗦,而是同一类 bug 要在两处修:上一轮那个"事件方法漏括号导致拖拽没反应"的坑,
 * 就是因为两份实现里有一份漏了括号 —— 抽成一份之后,这类问题一次修完。
 *
 * 分工:
 *  - **本组件**:树的形状与交互(`role="tree"` / 拖拽 / 折叠 / 选中 / 键盘);
 *  - **调用方**:只给数据 + 一个 `renderRow` 插槽(每行右侧那段是业务自己的:图标、徽章、操作按钮)。
 *
 * 业务约束:只允许**同级**拖拽(拖到别的层级显示禁止态、松手无效),服务端还会再校一遍。
 */

/** 树节点至少要有这些字段 —— 业务侧自己拼树(depth 从 0 开始) */
export type SortableTreeNode = {
	id: string;
	parentId: string | null;
	depth: number;
	children: SortableTreeNode[];
};

export function SortableTree<T extends SortableTreeNode>({
	nodes,
	selectedId,
	dragDisabled,
	ariaLabel,
	onSelect,
	onReorder,
	renderRow,
}: {
	nodes: T[];
	selectedId: string | null;
	/** 有未保存的修改时禁止重排(否则顺序与右侧详情对不上) */
	dragDisabled?: boolean;
	ariaLabel: string;
	onSelect: (node: T) => void;
	/** 把"拖动的节点"落到"目标节点"的前 / 后;`draggedId === targetId` 表示键盘上下移 */
	onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
	/** 每行的业务内容(渲染在折叠控件之后) */
	renderRow: (node: T) => ReactNode;
}) {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	const [dragId, setDragId] = useState<string | null>(null);
	const [dropHint, setDropHint] = useState<{ id: string; position: "before" | "after"; allowed: boolean } | null>(null);
	const selectedRef = useRef<HTMLDivElement | null>(null);

	// 选中项变化 → 滚进可视区(新增的节点排在同级末尾,不滚用户看不到它被加在哪)
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在选中项变化时滚一次,行 DOM 引用由 ref 提供
	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);

	/** 同级判定:父子相同才允许落 —— 这一条就是"不能跨级" */
	function isSameLevel(a: string, b: string): boolean {
		const find = (list: T[], id: string): T | null => {
			for (const node of list) {
				if (node.id === id) return node;
				const deeper = find(node.children as T[], id);
				if (deeper) return deeper;
			}
			return null;
		};
		const left = find(nodes, a);
		const right = find(nodes, b);
		return Boolean(left && right && (left.parentId ?? null) === (right.parentId ?? null));
	}

	function handleDragOver(event: DragEvent<HTMLElement>, targetId: string) {
		if (!dragId || dragId === targetId) return;
		if (!isSameLevel(dragId, targetId)) {
			// 不 preventDefault = 不允许放下;同时给一个视觉反馈
			setDropHint({ id: targetId, position: "after", allowed: false });
			return;
		}
		// ⚠️ 这个括号是**功能本体**:HTML5 拖放的规则是「dragover 里调了 preventDefault,drop 才会触发」。
		// 漏成 `event.preventDefault;` 就是"拖了半天没反应"(不报错、不 lint、编译也过)。
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
		onReorder(dragId, targetId, hint.position);
	}

	const renderNodes = (list: T[]): ReactNode =>
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
								onSelect(node);
							}
							if (event.key === "ArrowUp" && !dragDisabled) {
								event.preventDefault();
								onReorder(node.id, node.id, "before");
							}
							if (event.key === "ArrowDown" && !dragDisabled) {
								event.preventDefault();
								onReorder(node.id, node.id, "after");
							}
						}}
						className={cn(
							"group relative flex items-center gap-1.5 rounded-lg border border-transparent py-1.5 pr-1.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40",
							selectedId === node.id ? "border-primary/40 bg-primary/5" : "hover:border-hue-blue-line hover:bg-hover",
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

						{renderRow(node)}
					</div>
					{/* 子节点是**行的兄弟**,不是行的子元素:缩进由每行自己的 paddingLeft 负责,
					    嵌进行里会让它们继承行的 padding / 点击态 */}
					{hasChildren && !isCollapsed ? renderNodes(node.children as T[]) : null}
				</div>
			);
		});

	return (
		/*
		 * 限高 + 内部滚动:**树可以很长,页面不能被它撑长**。
		 * 不限高时,点最下面那个节点,右侧详情已经滚到屏幕外,得再滑回去看 ——
		 * 限高后左右两列始终一屏可见,树在里面自己滚。
		 * `scrollbar-gutter: stable` 让滚动条出现 / 消失时行宽不跳(树是窄列,跳一下很明显)。
		 *
		 * 收在这里而不是各页面各包一层:原来只有菜单页包了,标签页漏了,于是标签一多就复发同一个问题。
		 */
		<div className="max-h-[62vh] overflow-y-auto pr-1 [scrollbar-gutter:stable]">
			<div role="tree" aria-label={ariaLabel} className="space-y-0.5">
				{renderNodes(nodes)}
			</div>
		</div>
	);
}
