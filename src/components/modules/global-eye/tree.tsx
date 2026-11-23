import { Building2, Server, Video } from "lucide-react";

import { EmptyState } from "#/components/layout/empty-state";
import { SortableTree } from "#/components/modules/shared/sortable-tree";
import { Tag } from "#/components/ui/tag";
import { useTreePrefs } from "#/hooks/use-para-prefs";
import type { TreeNode } from "#/lib/tree";

/** 节点种类:组织 / 设备 / 通道(与 `lib/global-eye.ts` 同口径) */
export type GlobalEyeNodeKind = "org" | "device" | "channel";

/** 树节点的业务字段(tRPC `globalEye.channelTree` 出参形状) */
export type GlobalEyeNode = {
	id: string;
	parentId: string | null;
	name: string;
	sort: number;
	kind: GlobalEyeNodeKind;
	online: boolean | null;
	/** 通道的完整原始字段 —— 右侧详情面板遍历它展示全部信息 */
	raw: Record<string, unknown>;
};

/** 树节点 —— 通用节点形态(`lib/tree.ts`),别再把 depth / children 抄一遍 */
export type GlobalEyeTreeNode = TreeNode<GlobalEyeNode>;

/** 按 id 在（已拼好的）树里找节点 */
export function findGlobalEyeNode(nodes: GlobalEyeTreeNode[], id: string): GlobalEyeTreeNode | null {
	for (const node of nodes) {
		if (node.id === id) return node;
		const deeper = findGlobalEyeNode(node.children, id);
		if (deeper) return deeper;
	}
	return null;
}

const KIND_ICON = { org: Building2, device: Server, channel: Video } as const;

/**
 * 全球眼通道树 —— 复用 `SortableTree` 的折叠 / 搜索 / 选中 / 内部滚动，
 * 但 **`draggable={false}`**：通道是外部平台的只读目录，重排没有意义，拖拽把手会误导。
 */
export function GlobalEyeTree({
	nodes,
	selectedId,
	onSelect,
}: {
	nodes: GlobalEyeTreeNode[];
	selectedId: string | null;
	onSelect: (node: GlobalEyeTreeNode) => void;
}) {
	/** 展开态记在参数管理的 `page.tree` 里(hook 必须在所有 return 之前) */
	const { initialExpandedIds, persist: persistTree } = useTreePrefs("globalEye.channels");

	if (nodes.length === 0) {
		return (
			<EmptyState
				bare
				icon={<Video className="size-5" />}
				title="没有可用的通道"
				description="未从全球眼平台取到任何组织或通道。请确认 GLOBALEYE_* 配置与网络连通性后，点右上角刷新。"
			/>
		);
	}

	return (
		<SortableTree
			nodes={nodes}
			selectedId={selectedId}
			draggable={false}
			ariaLabel="视频通道树"
			searchPlaceholder="搜索组织 / 设备 / 通道…"
			searchText={(node) => node.name}
			onSelect={onSelect}
			onReorder={() => {}}
			initialExpandedIds={initialExpandedIds}
			onExpandedChange={persistTree}
			renderRow={(node) => {
				const Icon = KIND_ICON[node.kind];
				return (
					<>
						<Icon className="size-3.5 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
						{node.kind === "channel" ? (
							node.online ? (
								<Tag className="border-transparent bg-hue-teal-soft px-1.5 text-xs text-hue-teal-fg">在线</Tag>
							) : (
								<Tag variant="outline" className="px-1.5 text-xs text-muted-foreground">
									离线
								</Tag>
							)
						) : null}
					</>
				);
			}}
		/>
	);
}
