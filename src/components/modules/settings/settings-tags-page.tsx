import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree, Plus, Tags as TagsIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import {
	SettingsTagsCreateDialog,
	type TagCreateValues,
} from "#/components/modules/settings/settings-tags-create-dialog";
import { SettingsTagsForm, type TagFormValues, tagFormValues } from "#/components/modules/settings/settings-tags-form";
import { SettingsTagsTree, type TagNode, type TagRow } from "#/components/modules/settings/settings-tags-tree";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { writeError, writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { buildTree, bySortThenLabel } from "#/lib/tree";

/**
 * 系统设置 ▸ 标签管理 —— **持久化**的 `sys_tag` 树(维度 → 标签两级)。
 *
 * 版式:指标卡(替换原来的柱状图)+ 左树右详情。
 *  - 左:标签树,支持**同级拖拽排序**、**新增子节点**、**删除**;
 *  - 右:选中节点的详情(label / value / desc)—— **常驻表单直接编辑**(参表菜单管理),
 *    提供「保存 / 还原 / 新增子节点 / 删除」;新建维度 / 新建子节点走单独 dialog。
 *
 * 数据走 `trpc.tag.*`(读写 `sys_tag`);树由 `buildTree` 在前端拼。
 */
export function SettingsTagsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [values, setValues] = useState<TagFormValues | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [createParent, setCreateParent] = useState<TagNode | null>(null);
	const [pendingDelete, setPendingDelete] = useState<TagNode | null>(null);

	const listQuery = useQuery({ ...trpc.tag.list.queryOptions(), placeholderData: keepPreviousData });
	const rows = (listQuery.data ?? []) as TagRow[];
	const { tree, byId } = useMemo(() => buildTree(rows, { compare: bySortThenLabel }), [rows]);

	const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
	const dirty = Boolean(selected && values && JSON.stringify(values) !== JSON.stringify(tagFormValues(selected)));

	const createMutation = useMutation(
		trpc.tag.create.mutationOptions({
			onSuccess: writeSuccess(() => queryClient.invalidateQueries(trpc.tag.pathFilter()), {
				close: (row) => {
					setCreateOpen(false);
					setCreateParent(null);
					setSelectedId(row.id);
					setValues(tagFormValues(row));
				},
				message: () => "已新增标签节点",
			}),
			onError: writeError,
		}),
	);

	const updateMutation = useMutation(
		trpc.tag.update.mutationOptions({
			onSuccess: async (row) => {
				await queryClient.invalidateQueries(trpc.tag.pathFilter());
				setValues(tagFormValues(row));
				toast.success("已保存");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const deleteMutation = useMutation(
		trpc.tag.remove.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.tag.pathFilter());
				setPendingDelete(null);
				if (selectedId && pendingDelete && pendingDelete.id === selectedId) {
					setSelectedId(null);
					setValues(null);
				}
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

	/** 选中一个节点:有未保存改动时先提示(避免静默丢弃) */
	function selectNode(node: TagNode) {
		if (node.id === selectedId) return;
		if (dirty) toast.warning("上一个标签的修改未保存,已放弃");
		setSelectedId(node.id);
		setValues(tagFormValues(node));
	}

	/** 打开新建 dialog:工具条(parent = null)或行尾 + (parent = 当前节点) */
	function openCreate(parent: TagNode | null) {
		setCreateParent(parent);
		setCreateOpen(true);
	}

	function handleCreateSubmit(input: TagCreateValues) {
		createMutation.mutate({ parentId: createParent ? createParent.id : null, ...input });
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

			<div className="grid min-h-96 flex-1 gap-4 lg:grid-cols-[30rem_minmax(0,1fr)]">
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
								onSelect={selectNode}
								onAddChild={(node) => openCreate(node)}
								onDelete={(node) => setPendingDelete(node)}
								onMove={handleMove}
							/>
						)}
					</CardContent>
				</Card>

				{/* 右:选中节点详情 —— 常驻表单(参表「菜单详情」),点节点即编辑 */}
				<Card className="flex min-h-0 flex-col gap-3">
					<CardHeader className="pb-0">
						<CardTitle className="flex items-center gap-2 text-sm">
							<TagsIcon className="size-4 text-muted-foreground" />
							节点详情
						</CardTitle>
					</CardHeader>
					<CardContent className="min-h-0 flex-1 overflow-y-auto">
						<SettingsTagsForm
							node={selected}
							values={values ?? { label: "", value: "", desc: "" }}
							dirty={dirty}
							pending={updateMutation.isPending}
							onChange={setValues}
							onSave={() => {
								if (!selected || !values) return;
								updateMutation.mutate({
									id: selected.id,
									label: values.label.trim(),
									value: values.value?.trim() || null,
									desc: values.desc?.trim() || null,
								});
							}}
							onReset={() => selected && setValues(tagFormValues(selected))}
							onDelete={() => selected && setPendingDelete(selected)}
							onAddChild={() => selected && openCreate(selected)}
						/>
					</CardContent>
				</Card>
			</div>

			<SettingsTagsCreateDialog
				open={createOpen}
				parentLabel={createParent?.label ?? null}
				pending={createMutation.isPending}
				onOpenChange={(next) => {
					if (!next) {
						setCreateOpen(false);
						setCreateParent(null);
					}
				}}
				onSubmit={handleCreateSubmit}
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
				isPending={deleteMutation.isPending}
				onConfirm={() => pendingDelete && deleteMutation.mutate({ id: pendingDelete.id })}
			/>
		</PageFrame>
	);
}

/** 子树节点数(含自身),用于删除确认文案 */
function countSubtree(node: TagNode): number {
	return 1 + node.children.reduce((sum, child) => sum + countSubtree(child), 0);
}
