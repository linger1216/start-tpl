import { KeyRound } from "lucide-react";
import { useMemo, useState } from "react";

import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";

/**
 * 权限树(分组 + 复选框)—— 角色授权 / 用户授权 / 用户组授权三处共用。
 *
 * **树数据由调用方传入**:本组件不认任何具体权限来源。典型做法是从菜单配置
 * (`layout/nav-config` 的 `NAV_NODES`)派生出「菜单权限 + 操作权限」两棵树 ——
 * 那样勾选项天然等于侧边栏里真实存在的菜单,不会两边漂移。
 */

export type PermissionNode = {
	id: string;
	name: string;
	/** 「操作」类节点会带一个徽章区分(菜单权限不带) */
	kind?: string;
	children?: PermissionNode[];
};

/** 单个节点子树里的全部权限点 id */
export function permissionIdsIn(node: PermissionNode, out: string[] = []): string[] {
	out.push(node.id);
	for (const child of node.children ?? []) permissionIdsIn(child, out);
	return out;
}

/** 关键词过滤:返回该节点下可见的权限点 id(未命中返回空数组) */
function visiblePermissionIds(node: PermissionNode, keyword: string): string[] {
	const kw = keyword.trim();
	if (!kw) return permissionIdsIn(node);
	if (node.name.includes(kw)) return permissionIdsIn(node);
	return (node.children ?? []).flatMap((child) => visiblePermissionIds(child, kw));
}

/** 当前关键词下整棵树可见的权限点 id(供「全选当前 / 清空当前 / 共 N 项」用) */
function visiblePermissionIdsInTree(nodes: readonly PermissionNode[], keyword: string): string[] {
	return nodes.flatMap((node) => visiblePermissionIds(node, keyword));
}

/** 树节点:部分选中不点亮复选框(只有全选才 `checked`) */
function PermissionTreeNode({
	node,
	keyword,
	selected,
	onToggle,
	depth = 0,
}: {
	node: PermissionNode;
	keyword: string;
	selected: readonly string[];
	onToggle: (ids: string[], on: boolean) => void;
	depth?: number;
}) {
	const ids = visiblePermissionIds(node, keyword);
	if (ids.length === 0) return null;
	const hit = ids.filter((id) => selected.includes(id)).length;
	const on = hit > 0 && hit === ids.length;
	const children = (node.children ?? []).filter((child) => visiblePermissionIds(child, keyword).length > 0);
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
				{node.kind === "操作" ? (
					<Badge variant="outline" className="text-xs">
						操作
					</Badge>
				) : null}
			</div>
			{children.length > 0 ? (
				<div className="ml-2 space-y-1">
					{children.map((child) => (
						<PermissionTreeNode
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
 * 整棵权限树的内容(节点 + 空态提示)。
 * 滚动容器(max-h / border / p-3)由调用方提供,因为各处的容器尺寸由各自布局决定。
 */
export function PermissionTree({
	nodes,
	keyword,
	selected,
	onToggle,
}: {
	nodes: readonly PermissionNode[];
	keyword: string;
	selected: readonly string[];
	onToggle: (ids: string[], on: boolean) => void;
}) {
	const visible = visiblePermissionIdsInTree(nodes, keyword);
	return (
		<>
			{nodes.map((node) => (
				<PermissionTreeNode key={node.id} node={node} keyword={keyword} selected={selected} onToggle={onToggle} />
			))}
			{visible.length === 0 ? <p className="text-xs text-muted-foreground">没有匹配的权限点</p> : null}
		</>
	);
}

/**
 * 权限点选择区(组合件)—— 「标题 + 计数 + 搜索 + 全选当前 / 清空当前 + 树」。
 *
 * 三处授权弹窗此前各抄了一遍这一整块(标题计数文案略有出入,行为一致),
 * 现在只有这一个实现;弹窗自己的头部信息(角色名 / 用户清单)由调用方在外部渲染。
 */
export function PermissionPicker({
	nodes,
	selected,
	onToggle,
	title = "权限点",
	placeholder = "搜索权限点,如 导出 / 查看…",
	maxHeight = 288,
	className,
}: {
	nodes: readonly PermissionNode[];
	selected: readonly string[];
	onToggle: (ids: string[], on: boolean) => void;
	title?: string;
	placeholder?: string;
	/** 滚动区最大高度(px) */
	maxHeight?: number;
	className?: string;
}) {
	const [keyword, setKeyword] = useState("");
	const visibleIds = useMemo(() => visiblePermissionIdsInTree(nodes, keyword), [nodes, keyword]);
	const total = useMemo(() => visiblePermissionIdsInTree(nodes, "").length, [nodes]);

	return (
		<div className={className}>
			<div className="flex flex-wrap items-center gap-2">
				<KeyRound className="size-3.5 text-primary" />
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
				<PermissionTree nodes={nodes} keyword={keyword} selected={selected} onToggle={onToggle} />
			</div>
		</div>
	);
}
