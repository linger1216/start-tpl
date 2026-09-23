import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { buildMenuTree, type MenuTreeNode } from "#/components/layout/nav-menu";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import {
	type MenuFormValues,
	menuFormValues,
	SettingsMenusForm,
} from "#/components/modules/settings/settings-menus-form";
import { SettingsMenusTree } from "#/components/modules/settings/settings-menus-tree";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { newId } from "#/lib/ids";
import { asMenuType, MENU_TYPE } from "#/lib/menu-spec";

/**
 * 系统设置 ▸ 菜单管理(编排壳)—— **左侧树 + 右侧详情**,菜单改完直接生效。
 *
 * 数据来源就是运行时菜单表(`menu`),所以这里改完不用发版:侧边栏 / 面包屑下次渲染即变。
 * 三件事:
 * 1. **拖拽调序**:只在**同一级**内允许(拖到别的层级显示禁止态;服务端再校一遍);
 * 2. **直接编辑**:名称 / 路径 / 图标 / 是否显示,显式保存(带「未保存」徒标);
 * 3. **增删**:新增同级 / 子菜单;删除时有子菜单会被拒(先删子级,避免误删整枝)。
 */
/**
 * 新建菜单时的临时路径。
 *
 * 表定义里 `path` 是 **not null + 唯一** —— 没有"还没有路径"的中间态,所以新建时必须先给一个
 * 唯一占位路径,用户在右侧表单里改成真路由。用 nanoid 后缀保证不撞已有路径。
 */
function draftPath(): string {
	return `/new-menu-${newId().slice(0, 6)}`;
}

export function SettingsMenusPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const listQuery = useQuery(trpc.menu.list.queryOptions());
	const rows = listQuery.data ?? [];
	const { tree, byId } = useMemo(() => buildMenuTree(rows), [rows]);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [values, setValues] = useState<MenuFormValues | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);

	const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
	const dirty = Boolean(selected && values && JSON.stringify(values) !== JSON.stringify(menuFormValues(selected)));

	function invalidate() {
		return queryClient.invalidateQueries(trpc.menu.pathFilter());
	}

	/** 选中一个节点:有未保存改动时先提示(避免静默丢弃) */
	function selectNode(node: MenuTreeNode) {
		if (node.id === selectedId) return;
		if (dirty) toast.warning("上一个菜单的修改未保存,已放弃");
		setSelectedId(node.id);
		setValues(menuFormValues(node));
	}

	const updateMutation = useMutation(
		trpc.menu.update.mutationOptions({
			onSuccess: async (row) => {
				await invalidate();
				setValues(menuFormValues({ ...(byId.get(row.id) as MenuTreeNode), ...row }));
				toast.success(`已保存「${row.name}」`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const reorderMutation = useMutation(
		trpc.menu.reorder.mutationOptions({
			onSuccess: async (outcome) => {
				await invalidate();
				if (outcome.updated > 0) toast.success("已调整顺序");
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const createMutation = useMutation(
		trpc.menu.create.mutationOptions({
			onSuccess: async (row) => {
				await invalidate();
				setSelectedId(row.id);
				setValues({
					name: row.name,
					path: row.path ?? "",
					icon: row.icon,
					visible: row.visible !== 0,
					type: asMenuType(row.type),
					perm: row.perm ?? "",
				});
				toast.success(`已新增「${row.name}」,改完记得保存`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const deleteMutation = useMutation(
		trpc.menu.delete.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setDeleteOpen(false);
				setSelectedId(null);
				setValues(null);
				toast.success("已删除菜单");
			},
			onError: (error) => {
				setDeleteOpen(false);
				toast.error(toApiError(error).message);
			},
		}),
	);

	/**
	 * 同级重排:把 `draggedId` 落到 `targetId` 的前 / 后。
	 *
	 * `targetId === draggedId` 是键盘上移 / 下移的调用方式 —— 此时取该节点的前一个 / 后一个兄弟。
	 * 只在这一层的 id 数组里做插入,所以**天然不可能跨级**。
	 */
	function handleReorder(draggedId: string, targetId: string, position: "before" | "after") {
		if (dirty) {
			toast.warning("有未保存的修改,先保存再调序");
			return;
		}
		const dragged = byId.get(draggedId);
		const target = byId.get(targetId);
		if (!dragged || !target) return;
		const parentId = dragged.parentId ?? null;
		if ((target.parentId ?? null) !== parentId) {
			toast.error("只能在同一级内调序");
			return;
		}
		const siblings = rows
			.filter((row) => (row.parentId ?? null) === parentId)
			.sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name, "zh-Hans-CN"));
		const ordered = siblings.map((row) => row.id).filter((id) => id !== draggedId);
		const anchorIndex = ordered.indexOf(targetId);
		if (anchorIndex < 0) return;
		let insertAt = position === "before" ? anchorIndex : anchorIndex + 1;
		if (targetId === draggedId) {
			// 键盘上下移:找它当前的兄弟位置,再往前往后挪一格
			const currentIndex = siblings.findIndex((row) => row.id === draggedId);
			insertAt =
				position === "before" ? Math.max(0, currentIndex - 1) : Math.min(siblings.length - 1, currentIndex + 1);
			ordered.splice(insertAt, 0, draggedId);
		} else {
			ordered.splice(insertAt, 0, draggedId);
		}
		if (ordered.join() === siblings.map((row) => row.id).join()) return; // 没变
		reorderMutation.mutate({ parentId, orderedIds: ordered });
	}

	return (
		<PageFrame>
			<PageHeader
				title="菜单管理"
				description="系统设置 ▸ 菜单管理:维护侧边栏菜单树。拖拽调整同级顺序、右侧直接改名称 / 路径 / 图标 / 显隐 —— 改完即时生效,无需发版。"
				actions={
					<Badge variant="secondary" className="gap-1">
						<ListChecks className="size-3" />共 {rows.length} 个菜单
					</Badge>
				}
			/>

			<div className="grid min-h-[24rem] flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
				<Card className="flex min-h-0 flex-col gap-3">
					<CardHeader className="flex-row items-center justify-between gap-2">
						<CardTitle className="flex items-center gap-2">
							<FolderTree className="size-4 text-muted-foreground" />
							菜单树
						</CardTitle>
						<div className="flex items-center gap-2">
							{listQuery.isFetching ? (
								<Badge variant="secondary" className="tabular-nums">
									读取中…
								</Badge>
							) : null}
							<Button
								size="sm"
								variant="outline"
								disabled={createMutation.isPending}
								onClick={() =>
									createMutation.mutate({
										parentId: null,
										name: "新菜单",
										path: draftPath(),
										icon: "file-text",
										visible: true,
									})
								}
							>
								新增一级菜单
							</Button>
						</div>
					</CardHeader>
					<CardContent className="flex min-h-0 flex-1 flex-col gap-2">
						<p className="text-[11.5px] text-muted-foreground">
							拖拽行可调序(仅限同级:上半插入到目标前,下半插入到目标后);拖到别的层级会显示禁止态。选中某行后也可用 ↑ / ↓
							键在同级内移动。
						</p>
						{/* 限高与内部滚动由 `shared/sortable-tree.tsx` 统一提供 */}
						<SettingsMenusTree
							tree={tree}
							selectedId={selectedId}
							dragDisabled={dirty || reorderMutation.isPending}
							onSelect={selectNode}
							onReorder={handleReorder}
							onAddChild={(node) =>
								createMutation.mutate({
									parentId: node.id,
									name: "新菜单",
									path: draftPath(),
									icon: "file-text",
									visible: true,
								})
							}
							onDelete={(node) => {
								selectNode(node);
								setDeleteOpen(true);
							}}
						/>
					</CardContent>
				</Card>

				{/* 宽屏吸顶:万一页面还是需要滚动,详情也不会跑到视野外 */}
				<Card className="flex min-h-0 flex-col gap-3">
					<CardHeader>
						<CardTitle className="text-[14px]">菜单详情</CardTitle>
					</CardHeader>
					<CardContent className="min-h-0 flex-1 overflow-y-auto">
						<SettingsMenusForm
							node={selected}
							values={values ?? { name: "", path: "", icon: null, visible: true, type: MENU_TYPE.MENU, perm: "" }}
							dirty={dirty}
							pending={updateMutation.isPending}
							onChange={setValues}
							onSave={() => {
								if (!selected || !values) return;
								updateMutation.mutate({
									id: selected.id,
									name: values.name,
									path: values.path,
									icon: values.icon,
									visible: values.visible,
									type: values.type,
									perm: values.perm.trim() || null,
								});
							}}
							onReset={() => selected && setValues(menuFormValues(selected))}
							onDelete={() => setDeleteOpen(true)}
							onAddChild={() =>
								selected &&
								createMutation.mutate({
									parentId: selected.id,
									name: "新菜单",
									path: draftPath(),
									icon: "file-text",
									visible: true,
								})
							}
							onAddSibling={() =>
								createMutation.mutate({
									parentId: selected?.parentId ?? null,
									name: "新菜单",
									path: draftPath(),
									icon: "file-text",
									visible: true,
								})
							}
						/>
					</CardContent>
				</Card>
			</div>

			<p className="text-[12.5px] text-muted-foreground">
				注:菜单树的图标名对应 `sidebar` 里登记的图标集,认不出的图标会退回默认图标;路径全局唯一,重复会在保存时被拦下。
			</p>

			<ConfirmDialog
				open={deleteOpen}
				onOpenChange={(next) => {
					if (!next) setDeleteOpen(false);
				}}
				title={`删除菜单「${selected?.name ?? ""}」?`}
				description="删除后侧边栏立即不再显示它;如果它下面还有子菜单,会先被拒绝 —— 请先删子级。"
				confirmText="删除"
				confirmVariant="destructive"
				isPending={deleteMutation.isPending}
				pendingText="删除中…"
				onConfirm={() => {
					if (selected) deleteMutation.mutate({ id: selected.id });
				}}
			/>
		</PageFrame>
	);
}
