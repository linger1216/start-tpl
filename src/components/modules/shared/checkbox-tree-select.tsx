import { useMemo, useState } from "react";

import { ActionButton } from "#/components/ui/action-button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Tag } from "#/components/ui/tag";

/** 可搜索的树形多选项，数据与选择状态由调用方提供。 */
export type CheckboxTreeNode = {
	id: string;
	name: string;
	/** 可选的节点标签 */
	kind?: string;
	children?: CheckboxTreeNode[];
};

/** 单个节点子树里的全部节点 id */
function nodeIdsIn(node: CheckboxTreeNode, out: string[] = []): string[] {
	out.push(node.id);
	for (const child of node.children ?? []) nodeIdsIn(child, out);
	return out;
}

/** 关键词过滤:返回该节点下可见的节点 id(未命中返回空数组) */
function visibleIdsInNode(node: CheckboxTreeNode, keyword: string): string[] {
	const kw = keyword.trim();
	if (!kw) return nodeIdsIn(node);
	if (node.name.includes(kw)) return nodeIdsIn(node);
	return (node.children ?? []).flatMap((child) => visibleIdsInNode(child, kw));
}

/** 当前关键词下整棵树可见的节点 id(供「全选当前 / 清空当前 / 共 N 项」用) */
function visibleIdsInTree(nodes: readonly CheckboxTreeNode[], keyword: string): string[] {
	return nodes.flatMap((node) => visibleIdsInNode(node, keyword));
}

/** 树节点:部分选中不点亮复选框(只有全选才 `checked`) */
function CheckboxTreeItem({
	node,
	keyword,
	selected,
	onToggle,
	depth = 0,
}: {
	node: CheckboxTreeNode;
	keyword: string;
	selected: readonly string[];
	onToggle: (ids: string[], on: boolean) => void;
	depth?: number;
}) {
	const ids = visibleIdsInNode(node, keyword);
	if (ids.length === 0) return null;
	const hit = ids.filter((id) => selected.includes(id)).length;
	const on = hit > 0 && hit === ids.length;
	const children = (node.children ?? []).filter((child) => visibleIdsInNode(child, keyword).length > 0);
	return (
		<div className={depth === 0 ? "space-y-1" : "space-y-1 border-l border-border pl-3"}>
			<div className="flex items-center gap-2">
				<Checkbox
					aria-label={`选择${node.name}`}
					checked={on}
					// 只勾了一部分 ⇒ **半选**:以前父节点看着像完全没勾,折叠时最容易误判「怎么全没勾」
					indeterminate={hit > 0 && !on}
					onCheckedChange={(checked) => onToggle(ids, checked === true)}
				/>
				<span className={depth === 0 ? "text-sm font-medium text-foreground" : "text-xs text-foreground"}>
					{node.name}
				</span>
				<span className="text-xs tabular-nums text-muted-foreground">
					{hit}/{ids.length}
				</span>
				{node.kind ? (
					<Tag variant="outline" className="text-xs">
						{node.kind}
					</Tag>
				) : null}
			</div>
			{children.length > 0 ? (
				<div className="ml-2 space-y-1">
					{children.map((child) => (
						<CheckboxTreeItem
							key={child.id}
							node={child}
							keyword={keyword}
							selected={selected}
							onToggle={onToggle}
							depth={depth + 1}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

/**
 * 整棵选项树的内容(节点 + 空态提示)。
 * 滚动容器(max-h / border / p-3)由调用方提供,因为各处的容器尺寸由各自布局决定。
 */
function CheckboxTree({
	nodes,
	keyword,
	selected,
	onToggle,
}: {
	nodes: readonly CheckboxTreeNode[];
	keyword: string;
	selected: readonly string[];
	onToggle: (ids: string[], on: boolean) => void;
}) {
	const visible = visibleIdsInTree(nodes, keyword);
	return (
		<>
			{nodes.map((node) => (
				<CheckboxTreeItem key={node.id} node={node} keyword={keyword} selected={selected} onToggle={onToggle} />
			))}
			{visible.length === 0 ? <p className="text-xs text-muted-foreground">没有匹配的选项</p> : null}
		</>
	);
}

/** 搜索、批量选择和树节点展示，不包含业务权限规则。 */
export function CheckboxTreeSelect({
	nodes,
	selected,
	onToggle,
	title = "选项",
	placeholder = "搜索选项…",
	maxHeight = 288,
	className,
}: {
	nodes: readonly CheckboxTreeNode[];
	selected: readonly string[];
	onToggle: (ids: string[], on: boolean) => void;
	title?: string;
	placeholder?: string;
	/** 滚动区最大高度(px) */
	maxHeight?: number;
	className?: string;
}) {
	const [keyword, setKeyword] = useState("");
	const visibleIds = useMemo(() => visibleIdsInTree(nodes, keyword), [nodes, keyword]);
	const total = useMemo(() => visibleIdsInTree(nodes, "").length, [nodes]);

	return (
		<div className={className}>
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm font-medium text-foreground">
					{title}({selected.length} 项已选 / 共 {total} 项)
				</span>
				<Input
					value={keyword}
					onChange={(event) => setKeyword(event.target.value)}
					placeholder={placeholder}
					className="h-7 w-56"
				/>
				<ActionButton onClick={() => onToggle(visibleIds, true)}>全选当前</ActionButton>
				<ActionButton onClick={() => onToggle(visibleIds, false)}>清空当前</ActionButton>
			</div>
			<div className="mt-2 space-y-3 overflow-y-auto rounded-xl border border-border p-3" style={{ maxHeight }}>
				<CheckboxTree nodes={nodes} keyword={keyword} selected={selected} onToggle={onToggle} />
			</div>
		</div>
	);
}
