import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import {
	type DeptFormValues,
	deptFormValues,
	SettingsDepartmentsForm,
} from "#/components/modules/settings/settings-departments-form";
import {
	type DeptRow,
	type DeptTreeNode,
	SettingsDepartmentsTree,
} from "#/components/modules/settings/settings-departments-tree";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { writeError, writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
import { buildTree, bySortThenName } from "#/lib/tree";

/**
 * 系统设置 ▸ 部门管理 —— **左侧部门树 + 右侧详情(含成员)**。
 *
 * 这一页只负责把
 * 「有哪些部门 / 谁在哪个部门 / 是什么角色」维护清楚。
 *
 * 张三是「上海=管理员、武汉=员工」时,这两条是**两条**成员记录(一人可跨部门),
 * 他最终能看什么就是这两个角色的并集 —— 没有"当前部门"、也不需要切换。
 */
export function SettingsDepartmentsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const treeQuery = useQuery(trpc.department.tree.queryOptions());
	const rows = (treeQuery.data ?? []) as DeptRow[];
	const { tree, byId } = useMemo(() => buildTree(rows, { rootKey: "", compare: bySortThenName }), [rows]);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [values, setValues] = useState<DeptFormValues | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);

	// 候选人只在选中部门(右侧详情表单)时才拉 —— 与下面的成员查询同一个开关
	const usersQuery = useQuery({
		...trpc.user.list.queryOptions(),
		enabled: Boolean(selectedId),
	});

	const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
	const dirty = Boolean(selected && values && JSON.stringify(values) !== JSON.stringify(deptFormValues(selected)));

	const membersQuery = useQuery({
		...trpc.department.members.queryOptions({ departmentId: selectedId ?? "" }),
		enabled: Boolean(selectedId),
	});

	function invalidate() {
		return queryClient.invalidateQueries(trpc.department.pathFilter());
	}

	function selectNode(node: DeptTreeNode) {
		if (node.id === selectedId) return;
		if (dirty) toast.warning("上一个部门的修改未保存,已放弃");
		setSelectedId(node.id);
		setValues(deptFormValues(node));
	}

	const createMutation = useMutation(
		trpc.department.create.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: (row) => {
					setSelectedId(row.id);
					setValues(deptFormValues({ ...row, depth: 0, children: [] }));
				},
				message: (row) => `已新增「${row.name}」`,
			}),
			onError: writeError,
		}),
	);

	const updateMutation = useMutation(
		trpc.department.update.mutationOptions({
			onSuccess: writeSuccess(invalidate, { message: (row) => `已保存「${row.name}」` }),
			onError: writeError,
		}),
	);

	const reorderMutation = useMutation(
		trpc.department.reorder.mutationOptions({
			onSuccess: writeSuccess(invalidate),
			onError: writeError,
		}),
	);

	const deleteMutation = useMutation(
		trpc.department.remove.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => {
					setDeleteOpen(false);
					setSelectedId(null);
					setValues(null);
				},
				message: () => "已删除",
			}),
			onError: writeError,
		}),
	);

	const memberMutation = useMutation(
		trpc.department.addMember.mutationOptions({
			onSuccess: writeSuccess(invalidate, { message: () => "已更新成员角色" }),
			onError: writeError,
		}),
	);

	const removeMemberMutation = useMutation(
		trpc.department.removeMember.mutationOptions({
			onSuccess: writeSuccess(invalidate, { message: () => "已移出该部门" }),
			onError: writeError,
		}),
	);

	const userOptions = (usersQuery.data ?? []).map((user) => ({ id: user.id, name: user.name, email: user.email }));
	const pending = updateMutation.isPending || deleteMutation.isPending;

	return (
		<PageFrame>
			<PageHeader
				title="部门管理"
				description="一个人可以同时属于多个部门,在每个部门里有一个角色 —— 权限取并集,不需要切换。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={treeQuery.isFetching} onClick={() => void treeQuery.refetch()} />
						<Button
							size="sm"
							disabled={createMutation.isPending}
							onClick={() => createMutation.mutate({ parentId: null, name: "新部门" })}
						>
							<Plus className="size-3.5" />
							新增部门
						</Button>
					</div>
				}
			/>

			<div className="grid min-h-96 flex-1 gap-4 lg:grid-cols-[30rem_minmax(0,1fr)]">
				<Card className="flex min-h-0 flex-col gap-3">
					<CardHeader className="flex-row items-center justify-between gap-2">
						<CardTitle className="flex items-center gap-2">
							<Building2 className="size-4 text-muted-foreground" />
							部门树
						</CardTitle>
					</CardHeader>
					<CardContent className="flex min-h-0 flex-1 flex-col gap-2">
						<SettingsDepartmentsTree
							nodes={tree}
							selectedId={selectedId}
							onSelect={selectNode}
							onReorder={(draggedId, targetId, position) => {
								// 与菜单页同款:把"这一级的完整名单"交给服务端(防跨级拖)
								const dragged = byId.get(draggedId);
								if (!dragged) return;
								const siblings = rows
									.filter((row) => (row.parentId ?? null) === (dragged.parentId ?? null))
									.sort((left, right) => left.sort - right.sort)
									.map((row) => row.id)
									.filter((id) => id !== draggedId);
								const at = siblings.indexOf(targetId);
								if (at < 0) return;
								siblings.splice(position === "before" ? at : at + 1, 0, draggedId);
								reorderMutation.mutate({ parentId: dragged.parentId ?? null, orderedIds: siblings });
							}}
							onAddChild={(node) => createMutation.mutate({ parentId: node.id, name: "新部门" })}
							onDelete={(node) => {
								selectNode(node);
								setDeleteOpen(true);
							}}
						/>
					</CardContent>
				</Card>

				<Card className="flex min-h-0 flex-col">
					<CardHeader>
						<CardTitle className="text-sm">部门详情</CardTitle>
					</CardHeader>
					<CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
						<SettingsDepartmentsForm
							node={selected}
							values={values ?? { name: "", parentId: null, status: true, remark: "" }}
							dirty={dirty}
							pending={pending}
							members={membersQuery.data ?? []}
							membersLoading={membersQuery.isFetching}
							userOptions={userOptions}
							onChange={setValues}
							onSave={() => {
								if (!selected || !values) return;
								updateMutation.mutate({
									id: selected.id,
									name: values.name,
									parentId: values.parentId,
									status: values.status,
									remark: values.remark.trim() || null,
								});
							}}
							onReset={() => selected && setValues(deptFormValues(selected))}
							onDelete={() => setDeleteOpen(true)}
							membersPending={memberMutation.isPending || removeMemberMutation.isPending}
							onAddMembers={(userIds) => {
								if (!selected) return;
								// 逐条提交(接口按人幂等);一次选多人时它们会并发跑完
								for (const userId of userIds) memberMutation.mutate({ departmentId: selected.id, userId });
							}}
							onRemoveMember={(userId) =>
								selected && removeMemberMutation.mutate({ departmentId: selected.id, userId })
							}
						/>
					</CardContent>
				</Card>
			</div>

			<ConfirmDialog
				open={deleteOpen}
				onOpenChange={(next) => {
					if (!next) setDeleteOpen(false);
				}}
				title="删除部门"
				description={`确认删除「${selected?.name ?? ""}」?如果它下面还有子部门、或部门里还有人,会先被拒绝 —— 请先处理完再来。`}
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
