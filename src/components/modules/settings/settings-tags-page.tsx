import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree, Plus, Tags as TagsIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsTagsFormDialog, type TagFormValues } from "#/components/modules/settings/settings-tags-form-dialog";
import { SettingsTagsTree, type TagNode, type TagRow } from "#/components/modules/settings/settings-tags-tree";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { buildTree, bySortThenLabel } from "#/lib/tree";

/**
 * 系统设置 ▸ 标签管理 —— **持久化**的 `sys_tag` 树(维度 → 标签两级)。
 *
 * 版式:指标卡(替换原来的柱状图)+ 左树右详情。
 *  - 左:标签树,支持**同级拖拽排序**、**新增子节点**、**删除**;
 *  - 右:选中节点的详情(label / value / desc / 父级 / 子节点数),并提供 新增子节点 / 编辑 / 删除。
 *
 * 数据走 `trpc.tag.*`(读写 `sys_tag`);树由 `buildTagTree` 在前端拼。
 */
export function SettingsTagsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [formOpen, setFormOpen] = useState(false);
	const [formMode, setFormMode] = useState<"create" | "edit">("create");
	const [formParentId, setFormParentId] = useState<string | null>(null);
	const [formParentLabel, setFormParentLabel] = useState<string | null>(null);
	const [formInitial, setFormInitial] = useState<TagFormValues | null>(null);
	const [pendingDelete, setPendingDelete] = useState<TagNode | null>(null);

	const listQuery = useQuery({ ...trpc.tag.list.queryOptions(), placeholderData: keepPreviousData });
	const rows = (listQuery.data ?? []) as TagRow[];
	const { tree, byId } = useMemo(() => buildTree(rows, { compare: bySortThenLabel }), [rows]);

	// 按 id 找节点直接用 `buildTree` 顺手带回来的 `byId`(以前这里手写了一遍递归)
	const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

	const createMutation = useMutation(
		trpc.tag.create.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.tag.pathFilter());
				setFormOpen(false);
				toast.success("已新增标签节点");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const updateMutation = useMutation(
		trpc.tag.update.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.tag.pathFilter());
				setFormOpen(false);
				toast.success("已保存");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const deleteMutation = useMutation(
		trpc.tag.delete.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.tag.pathFilter());
				setPendingDelete(null);
				if (selectedId && pendingDelete && pendingDelete.id === selectedId) setSelectedId(null);
				toast.success(`已删除 ${outcome.deleted} 个节点`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const moveMutation = useMutation(
		trpc.tag.move.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.tag.pathFilter());
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	// ── 指标卡(替换原柱状图)───────────────────────────────
	const dims = rows.filter((r) => r.parentId === null).length;
	const leaves = rows.length - dims;

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "total",
				label: "标签节点",
				value: rows.length,
				description: "维度 + 标签合计",
				Icon: TagsIcon,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "个",
			},
			{
				key: "dim",
				label: "维度(分类)",
				value: dims,
				description: "一级节点",
				Icon: FolderTree,
				tone: "bg-hue-violet-soft text-hue-violet-fg",
				unit: "个",
			},
			{
				key: "leaf",
				label: "标签(叶子)",
				value: leaves,
				description: "挂在维度下的取值",
				Icon: TagsIcon,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
				unit: "个",
			},
		],
		[rows.length, dims, leaves],
	);

	function openCreate(parent: TagNode | null) {
		setFormMode("create");
		setFormParentId(parent ? parent.id : null);
		setFormParentLabel(parent ? parent.label : null);
		setFormInitial(null);
		setFormOpen(true);
	}

	function openEdit(node: TagNode) {
		setFormMode("edit");
		setFormInitial({ label: node.label, value: node.value, desc: node.desc });
		setFormOpen(true);
	}

	function handleFormSubmit(values: TagFormValues) {
		if (formMode === "create") {
			createMutation.mutate({ parentId: formParentId, ...values });
		} else if (selected) {
			updateMutation.mutate({ id: selected.id, ...values });
		}
	}

	function handleMove(draggedId: string, targetId: string, position: "before" | "after") {
		const target = rows.find((r) => r.id === targetId);
		const newParentId = target?.parentId ?? null;
		const siblings = rows
			.filter((r) => (r.parentId ?? null) === newParentId && r.id !== draggedId)
			.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
		const idx = siblings.findIndex((s) => s.id === targetId);
		const insertAt = position === "before" ? idx : idx + 1;
		siblings.splice(insertAt, 0, {
			id: draggedId,
			parentId: newParentId,
			label: "",
			value: null,
			desc: null,
			sort: 0,
			createTime: null,
			updateTime: null,
		});
		moveMutation.mutate({ id: draggedId, newParentId, orderedSiblingIds: siblings.map((s) => s.id) });
	}

	return (
		<PageFrame>
			<PageHeader
				title="标签管理"
				description="系统设置 ▸ 标签管理:维护标签体系(维度 → 标签的树)。每个节点有名称 / 取值 / 含义;树支持新增子节点、删除、同级拖拽排序。数据持久化在 sys_tag 表,改完立即生效。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={listQuery.isFetching} onClick={() => void listQuery.refetch()} />
						<Button size="sm" disabled={createMutation.isPending} onClick={() => openCreate(null)}>
							<Plus className="size-3.5" />
							新增维度
						</Button>
					</div>
				}
			/>

			<StatCards items={stats} />

			<div className="grid min-h-[24rem] flex-1 gap-4 lg:grid-cols-[30rem_minmax(0,1fr)]">
				{/* 左:标签树 */}
				<Card className="flex min-h-0 flex-col gap-3">
					<CardHeader className="flex-row items-center justify-between gap-2">
						<CardTitle className="flex items-center gap-2">
							<FolderTree className="size-4 text-muted-foreground" />
							标签树
						</CardTitle>
					</CardHeader>
					<CardContent className="flex min-h-0 flex-1 flex-col gap-2">
						{rows.length === 0 ? (
							<div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
								<FolderTree className="size-8 opacity-40" />
								<p className="text-sm">还没有标签,点右上角新增一个维度。</p>
							</div>
						) : (
							<SettingsTagsTree
								tree={tree}
								selectedId={selectedId}
								dragDisabled={moveMutation.isPending}
								onSelect={(node) => setSelectedId(node.id)}
								onAddChild={(node) => openCreate(node)}
								onDelete={(node) => setPendingDelete(node)}
								onMove={handleMove}
							/>
						)}
					</CardContent>
				</Card>

				{/* 右:选中节点详情(宽屏吸顶:与「菜单详情」同一口径,页面需要滚动时详情也不会跑出视野) */}
				<Card className="flex min-h-0 flex-col gap-3">
					<CardHeader className="flex-row items-center justify-between gap-3 pb-0">
						<CardTitle className="flex items-center gap-2">
							<TagsIcon className="size-4 text-muted-foreground" />
							节点详情
						</CardTitle>
					</CardHeader>
					<CardContent className="min-h-0 flex-1 overflow-y-auto">
						{!selected ? (
							<div className="flex h-48 flex-col items-center justify-center gap-1 text-center text-muted-foreground">
								<TagsIcon className="size-8 opacity-40" />
								<p className="text-sm">从左侧树点选一个节点查看详情。</p>
							</div>
						) : (
							<div className="space-y-4">
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<h3 className="truncate text-lg font-semibold text-foreground">{selected.label}</h3>
											<Badge variant={selected.parentId === null ? "default" : "secondary"}>
												{selected.parentId === null ? "维度" : "标签"}
											</Badge>
										</div>
										{selected.value ? (
											<p className="mt-1 font-mono text-xs text-muted-foreground">{selected.value}</p>
										) : null}
									</div>
									<div className="flex shrink-0 items-center gap-1">
										<ActionButton onClick={() => openCreate(selected)}>新增子节点</ActionButton>
										<ActionButton onClick={() => openEdit(selected)}>编辑</ActionButton>
										<ActionButton tone="danger" onClick={() => setPendingDelete(selected)}>
											删除
										</ActionButton>
									</div>
								</div>

								<dl className="grid grid-cols-2 gap-3 text-xs">
									<div>
										<dt className="text-muted-foreground">含义</dt>
										<dd className="mt-0.5 text-foreground">{selected.desc || "—"}</dd>
									</div>
									<div>
										<dt className="text-muted-foreground">父级</dt>
										<dd className="mt-0.5 text-foreground">
											{selected.parentId ? ((byId.get(selected.parentId) ?? null)?.label ?? "(已删除)") : "— 顶层维度"}
										</dd>
									</div>
									<div>
										<dt className="text-muted-foreground">直接子节点</dt>
										<dd className="mt-0.5 text-foreground">{selected.children.length} 个</dd>
									</div>
									<div>
										<dt className="text-muted-foreground">节点 id</dt>
										<dd className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{selected.id}</dd>
									</div>
								</dl>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			<SettingsTagsFormDialog
				open={formOpen}
				mode={formMode}
				parentLabel={formParentLabel}
				initial={formInitial}
				meta={
					formMode === "edit" && selected ? { createdAt: selected.createTime, updatedAt: selected.updateTime } : null
				}
				pending={createMutation.isPending || updateMutation.isPending}
				onOpenChange={setFormOpen}
				onSubmit={handleFormSubmit}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除标签节点"
				description={
					pendingDelete
						? `确认删除「${pendingDelete.label}」?它会连带删掉其下全部子节点(共 ${countSubtree(pendingDelete)} 个)。`
						: ""
				}
				onConfirm={() => pendingDelete && deleteMutation.mutate({ id: pendingDelete.id })}
			/>
		</PageFrame>
	);
}

/** 子树节点数(含自身),用于删除确认文案 */
function countSubtree(node: TagNode): number {
	return 1 + node.children.reduce((sum, child) => sum + countSubtree(child), 0);
}
