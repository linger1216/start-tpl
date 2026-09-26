import {
	ChevronDown,
	ChevronRight,
	GripVertical,
	ListChevronsDownUp,
	ListChevronsUpDown,
	ListTree,
	Search,
	X,
} from "lucide-react";
import type { DragEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ActionIconButton } from "#/components/ui/action-button";
import { Input } from "#/components/ui/input";
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

/** 收集所有「有子节点」的 id(全部展开时要逐个记住) */
function collectExpandableIds<T extends SortableTreeNode>(list: T[], out: string[] = []): string[] {
	for (const node of list) {
		if (node.children.length > 0) {
			out.push(node.id);
			collectExpandableIds(node.children as T[], out);
		}
	}
	return out;
}

/** 节点总数(含各级子节点)—— 工具栏上那个「共 N 个节点」 */
function countNodes<T extends SortableTreeNode>(list: T[]): number {
	let total = list.length;
	for (const node of list) total += countNodes(node.children as T[]);
	return total;
}

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
	defaultCollapsed = true,
	searchable = true,
	searchPlaceholder = "搜索节点…",
	searchText,
	onSelect,
	onReorder,
	renderRow,
	renderActions,
	initialExpandedIds,
	onExpandedChange,
}: {
	nodes: T[];
	selectedId: string | null;
	/** 有未保存的修改时禁止重排(否则顺序与右侧详情对不上) */
	dragDisabled?: boolean;
	ariaLabel: string;
	/**
	 * 初始是否**全部折叠**(默认 `true`)。大树上"打开即全展开"会瞬间渲染几千行 ——
	 * 部门树 3691 个节点实测要 2.9s、8.3 万个 DOM 节点;全折叠后首屏只渲染顶级那几个。
	 * 传 `false` 可以让小树打开就是展开的(节点很多时别这么干)。
	 */
	defaultCollapsed?: boolean;
	/** 是否在工具条里显示搜索框(默认 `true`)。要搜索就必须给 `searchText` */
	searchable?: boolean;
	searchPlaceholder?: string;
	/**
	 * 节点的**可搜索文本**。组件只认得 `id / parentId / children`(业务字段由调用方 `renderRow` 渲染),
	 * 所以"按什么搜"必须由调用方告诉它 —— 不给就没有搜索框(没东西可搜)。
	 */
	searchText?: (node: T) => string;
	onSelect: (node: T) => void;
	/** 把"拖动的节点"落到"目标节点"的前 / 后;`draggedId === targetId` 表示键盘上下移 */
	onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
	/** 每行的业务内容(渲染在折叠控件之后) */
	renderRow: (node: T) => ReactNode;
	/**
	 * 行上的快捷操作(新增子节点 / 编辑 / 删除 …)**渲染在行尾**。
	 *
	 * 三条约定由组件统一负责,调用方不用再各写一遍:
	 *  1. **悬停 / 键盘聚焦才显形**(`group-hover` + `focus-within`)—— 树是窄列,常显会一直和名称抢宽;
	 *  2. 容器带 `data-row-actions` 标记,**行的选中事件会跳过它** —— 不然点"删除"会顺带把这一行选中(标签树踩过);
	 *  3. 与 `renderRow` 的标签同级,所以标签要 `flex-1 truncate`(各树的 renderRow 里已经是这么写的)。
	 */
	renderActions?: (node: T) => ReactNode;
	/**
	 * 库里存的展开态(`page.tree`,`useTreePrefs` 给的)—— **只在第一次拿到时套用一次**。
	 * 传 `undefined` 表示「还没读到」(这时别动,保持默认折叠);传 `[]` 表示「就是全折叠」。
	 */
	initialExpandedIds?: readonly string[] | null;
	/** 折叠 / 展开变化时回调(调用方拿去写进参数管理) */
	onExpandedChange?: (expanded: string[]) => void;
}) {
	/**
	 * 记的是**已展开**的节点(不是已折叠的)—— 这样"默认全折叠"天然成立:
	 * 初始空集 = 全部折叠,不依赖 `nodes` 那一刻有没有数据(它是异步来的,
	 * 若按"已折叠集合"初始化,首帧拿到空数组会把初始状态算错、等数据到了反而全展开)。
	 */
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(
		() => new Set(defaultCollapsed ? [] : collectExpandableIds(nodes)),
	);
	const applyExpanded = (next: ReadonlySet<string>) => {
		setExpanded(next);
		onExpandedChange?.([...next]);
	};

	const toggleCollapsed = (id: string) => {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		applyExpanded(next);
	};

	/** 库里那套展开态到位后套用一次(用 ref 挡住后续渲染,免得上层 query 刷新把用户的展开打回去) */
	const expandedAppliedRef = useRef(false);
	useEffect(() => {
		if (expandedAppliedRef.current || initialExpandedIds == null) return;
		expandedAppliedRef.current = true;
		setExpanded(new Set(initialExpandedIds));
	}, [initialExpandedIds]);
	const [keyword, setKeyword] = useState("");
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
			const isCollapsed = !expandedNow.has(node.id);
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
							// 焦点在行尾操作按钮上时,回车交给那个按钮(别顺手把整行选中了)
							if ((event.target as HTMLElement).closest("[data-row-actions]")) return;
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
							// ⚠️ 整行**不再**用 `cursor-grab`:行尾按钮是 `cursor-pointer`,
							//    整行 grab 会让鼠标在两者边界上一抖就 grab ⇄ 手型来回换 ——
							//    用户报的"鼠标一直闪"实测就是这条(2026-09)。抓取提示只留在把手上(见下)。
							"cursor-default",
						)}
						style={{ paddingLeft: 6 + node.depth * 18 }}
						onClick={(event) => {
							// 行尾操作区里的点击不算"选中这一行"(那些按钮各自处理自己的事)
							if ((event.target as HTMLElement).closest("[data-row-actions]")) return;
							// 点父节点顺手展开 / 收起 —— 不用非得去戳那个 16px 的小箭头
							if (hasChildren) toggleCollapsed(node.id);
							onSelect(node);
						}}
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

						{/* 折叠箭头:只有有子节点的行才有(叶子行留空占位,名称照样对齐) */}
						<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/50">
							{hasChildren ? (
								<button
									type="button"
									aria-label={isCollapsed ? "展开" : "收起"}
									className="rounded p-0.5 hover:bg-muted hover:text-foreground"
									onClick={(event) => {
										event.stopPropagation();
										toggleCollapsed(node.id);
									}}
								>
									{isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
								</button>
							) : null}
						</span>

						{/*
						 * **拖拽把手:每一行都要有**。
						 *
						 * 踩过的坑:以前这个把手只在**叶子**行显示(有子节点的行在同一位置显示折叠箭头),
						 * 于是"有子节点的那几行没有把手"—— 用户看到的现象是**"这几行不能拖动"**,
						 * 其实能拖,只是**没给可供性**。所以箭头归箭头(负责展开),把手归把手(每行都有)。
						 */}
						<GripVertical
							className="size-3.5 shrink-0 cursor-grab text-muted-foreground/50 active:cursor-grabbing"
							aria-hidden="true"
						/>

						{renderRow(node)}

						{renderActions ? (
							<div
								data-row-actions=""
								className="flex shrink-0 items-center gap-2.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100"
							>
								{renderActions(node)}
							</div>
						) : null}
					</div>
					{/* 子节点是**行的兄弟**,不是行的子元素:缩进由每行自己的 paddingLeft 负责,
					    嵌进行里会让它们继承行的 padding / 点击态 */}
					{hasChildren && !isCollapsed ? renderNodes(node.children as T[]) : null}
				</div>
			);
		});

	// 搜索:保留「命中的节点 + 它的祖先链」(不然命中项不知道挂在哪一层),并把命中路径全部展开
	const trimmed = keyword.trim().toLowerCase();
	const filtered = useMemo(() => {
		if (!trimmed || !searchText) return nodes;
		const prune = (list: T[]): T[] => {
			const kept: T[] = [];
			for (const node of list) {
				const children = prune(node.children as T[]);
				if (children.length > 0 || searchText(node).toLowerCase().includes(trimmed)) {
					kept.push({ ...node, children } as T);
				}
			}
			return kept;
		};
		return prune(nodes);
	}, [nodes, trimmed, searchText]);

	const searching = trimmed.length > 0 && Boolean(searchText);
	const showSearch = searchable && Boolean(searchText);
	const expandableIds = collectExpandableIds(filtered);
	const total = countNodes(nodes);
	// 搜索中:命中路径一律展开(否则用户还得自己一层层点开)
	const expandedNow = searching ? new Set(expandableIds) : expanded;
	const allExpanded = !searching && expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id));

	return (
		/*
		 * 占满父级剩下的高度 + 内部滚动:**树可以很长,页面不能被它撑长,也不该矮成一条**。
		 * 原来是写死 `max-h-[62vh]`:数据少时树只有半屏高、和数据多的页面高矮不一 ——
		 * 现在改成"吃掉父级给的高度"(父级是 `CardContent` 的 `min-h-0 flex-1`),由页面统一高度。
		 * `scrollbar-gutter: stable` 让滚动条出现 / 消失时行宽不跳(树是窄列,跳一下很明显)。
		 *
		 * 收在这里而不是各页面各包一层:原来只有菜单页包了,标签页漏了,于是标签一多就复发同一个问题。
		 * 工具条(总数 + 全部展开 / 折叠)也在这里 —— 它是树的固有部分,三棵树都要有,放页面里又会各写一遍。
		 */
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center justify-between gap-2 pb-1">
				<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
					<ListTree className="size-3.5" />共 <span className="font-medium tabular-nums text-foreground">{total}</span>{" "}
					个节点
					{searching ? (
						<span>
							· 命中 <span className="font-medium tabular-nums text-foreground">{countNodes(filtered)}</span> 个
						</span>
					) : null}
				</span>
				<div className="flex items-center gap-0.5">
					<ActionIconButton
						label="全部展开"
						disabled={allExpanded}
						onClick={() => applyExpanded(new Set(expandableIds))}
					>
						<ListChevronsUpDown className="size-3.5" />
					</ActionIconButton>
					<ActionIconButton label="全部折叠" disabled={expanded.size === 0} onClick={() => applyExpanded(new Set())}>
						<ListChevronsDownUp className="size-3.5" />
					</ActionIconButton>
				</div>
			</div>
			{showSearch ? (
				<div className="relative shrink-0 pb-1.5">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={keyword}
						onChange={(event) => setKeyword(event.target.value)}
						placeholder={searchPlaceholder}
						aria-label={searchPlaceholder}
						className="h-7 pr-7 pl-7 text-xs"
					/>
					<button
						type="button"
						aria-label="清除搜索"
						title="清除搜索"
						disabled={!keyword}
						onClick={() => setKeyword("")}
						className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors disabled:cursor-default disabled:opacity-35 enabled:cursor-pointer enabled:hover:bg-muted enabled:hover:text-foreground"
					>
						<X className="size-3.5" />
					</button>
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
				<div role="tree" aria-label={ariaLabel} className="space-y-0.5">
					{filtered.length === 0 ? (
						<p className="px-2 py-6 text-center text-xs text-muted-foreground">
							{searching ? "没有匹配的节点" : "还没有节点"}
						</p>
					) : (
						renderNodes(filtered)
					)}
				</div>
			</div>
		</div>
	);
}
