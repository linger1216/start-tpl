import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, GitBranch, Layers, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "#/components/layout/empty-state";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import {
	TaskCloseWorkflowDetail,
	type WorkflowDetail,
} from "#/components/modules/task-close/task-close-workflow-detail";
import {
	TaskCloseWorkflowForm,
	type WorkflowEditing,
	type WorkflowFormPayload,
} from "#/components/modules/task-close/task-close-workflow-form";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { writeError, writeSuccess } from "#/hooks/use-ledger-write";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/** 卡片页用到的模板投影(`workflowList` 的一行;`payload` 是 JSON,解出来才好看状态 / 边数) */
type ListItem = {
	id: string;
	name: string;
	payload: unknown;
	builtin: boolean;
	createdAt: string | null;
	updatedAt: string | null;
};

/** 把 `payload` 解成"模板定义"(`workflowList` 的 `payload` 是 JSON 列,类型是 unknown) */
function parsed(item: ListItem): WorkflowFormPayload {
	const payload = (item.payload ?? {}) as Partial<WorkflowFormPayload>;
	const statuses = payload.statuses ?? [];
	return {
		name: payload.name ?? item.name,
		statuses,
		initial: payload.initial ?? statuses[0]?.value ?? "",
		edges: payload.edges ?? [],
	};
}

function toEditing(item: ListItem): WorkflowEditing {
	return { id: item.id, ...parsed(item) };
}

/**
 * 「流程模板」卡片页 —— `tc_workflow` 的增删改查。
 *
 * 模板是**全局配置**:改模板不影响已建任务(它们在创建时复制了状态图快照)。
 * 授权走按钮权限点(`sys:tcWorkflow:add/edit/remove`),按钮只是可见性投影,真正拦截在服务端。
 */
export function TaskCloseWorkflowsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const canAdd = useHasPerm("sys:tcWorkflow:add");
	const canEdit = useHasPerm("sys:tcWorkflow:edit");
	const canRemove = useHasPerm("sys:tcWorkflow:remove");

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<WorkflowEditing | null>(null);
	const [detailId, setDetailId] = useState<string | null>(null);
	const [pendingDelete, setPendingDelete] = useState<ListItem | null>(null);

	const listQuery = useQuery(trpc.taskClose.workflowList.queryOptions());
	const detailQuery = useQuery({
		...trpc.taskClose.workflowGet.queryOptions({ id: detailId ?? "" }),
		enabled: detailId !== null,
	});

	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());

	const createMutation = useMutation(
		trpc.taskClose.workflowCreate.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setFormOpen(false), message: () => "流程模板已创建" }),
			onError: writeError,
		}),
	);

	const updateMutation = useMutation(
		trpc.taskClose.workflowUpdate.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => {
					setFormOpen(false);
					setEditing(null);
				},
				message: () => "流程模板已保存",
			}),
			onError: writeError,
		}),
	);

	const removeMutation = useMutation(
		trpc.taskClose.workflowRemove.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setPendingDelete(null), message: () => "流程模板已删除" }),
			onError: writeError,
		}),
	);

	const items = useMemo(() => (listQuery.data ?? []) as ListItem[], [listQuery.data]);

	const stats = useMemo<StatItem[]>(() => {
		const sums = items.reduce(
			(acc, item) => {
				const def = parsed(item);
				return { statuses: acc.statuses + def.statuses.length, edges: acc.edges + def.edges.length };
			},
			{ statuses: 0, edges: 0 },
		);
		return [
			{
				key: "templates",
				label: "流程模板",
				value: items.length,
				Icon: Workflow,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
			},
			{
				key: "statuses",
				label: "状态",
				value: sums.statuses,
				Icon: Layers,
				tone: "bg-hue-violet-soft text-hue-violet-fg",
			},
			{
				key: "edges",
				label: "转移边",
				value: sums.edges,
				Icon: GitBranch,
				tone: "bg-hue-amber-soft text-hue-amber-fg",
			},
		];
	}, [items]);

	function openCreate() {
		setEditing(null);
		setFormOpen(true);
	}

	function openEdit(item: ListItem) {
		setEditing(toEditing(item));
		setFormOpen(true);
	}

	function submit(payload: WorkflowFormPayload) {
		if (editing) updateMutation.mutate({ id: editing.id, ...payload });
		else createMutation.mutate(payload);
	}

	return (
		<PageFrame>
			<PageHeader
				title="流程模板"
				description="任务闭环的状态图模板：状态集合、初始态、状态转移边。建任务时按模板复制一份快照,之后改模板不影响已建任务。"
				descriptionInline
				actions={
					<>
						<RefreshButton busy={listQuery.isFetching} onClick={() => listQuery.refetch()} />
						{canAdd ? (
							<Button onClick={openCreate}>
								<Plus className="size-4" />
								新增模板
							</Button>
						) : null}
					</>
				}
			/>

			<StatCards items={stats} />

			{items.length === 0 ? (
				listQuery.isPending ? (
					<Card>
						<div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>
					</Card>
				) : (
					<EmptyState
						icon={<Workflow className="size-6" />}
						title="还没有流程模板"
						description="流程模板定义任务的状态集合、初始态与状态转移边。建任务时选一个模板,它的定义会复制成任务快照。"
						actions={
							canAdd ? (
								<Button onClick={openCreate}>
									<Plus className="size-4" />
									新增模板
								</Button>
							) : undefined
						}
					/>
				)
			) : (
				<div className="flex flex-wrap gap-3">
					{items.map((item) => (
						<WorkflowCard
							key={item.id}
							item={item}
							canEdit={canEdit}
							canRemove={canRemove}
							onView={() => setDetailId(item.id)}
							onEdit={() => openEdit(item)}
							onDelete={() => setPendingDelete(item)}
						/>
					))}
				</div>
			)}

			<TaskCloseWorkflowForm
				open={formOpen}
				onOpenChange={(next) => {
					setFormOpen(next);
					if (!next) setEditing(null);
				}}
				pending={createMutation.isPending || updateMutation.isPending}
				editing={editing}
				onSubmit={submit}
			/>

			<TaskCloseWorkflowDetail
				open={detailId !== null}
				onOpenChange={(next) => {
					if (!next) setDetailId(null);
				}}
				detail={(detailQuery.data as WorkflowDetail | undefined) ?? null}
				isPending={detailQuery.isPending}
				onEdit={
					canEdit && detailQuery.data
						? () => {
								const row = items.find((item) => item.id === detailId);
								if (row) openEdit(row);
							}
						: undefined
				}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除流程模板"
				description={`「${pendingDelete?.name ?? ""}」会被软删,列表里不再出现;已建任务的状态图是快照,不受影响。`}
				isPending={removeMutation.isPending}
				onConfirm={() => pendingDelete && removeMutation.mutate({ id: pendingDelete.id })}
			/>
		</PageFrame>
	);
}

/**
 * 一张模板卡片 —— 版式对齐「资源卡」:图标 + 状态/动作在同一行、标题 + 一行说明、
 * 一块浅底预览(状态集合)、底部 meta 胶囊。**整卡可点开详情**,行内动作 `stopPropagation`。
 *
 * 白底(`bg-background`)+ flex 纵向;`max-w-sm` 限宽、预览区 `max-h-24` 限高,配合外层 `flex flex-wrap` 换行。
 */
function WorkflowCard({
	item,
	canEdit,
	canRemove,
	onView,
	onEdit,
	onDelete,
}: {
	item: ListItem;
	canEdit: boolean;
	canRemove: boolean;
	onView: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const def = parsed(item);
	return (
		<Card
			role="button"
			tabIndex={0}
			aria-label={`查看流程模板 ${item.name}`}
			onClick={onView}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onView();
				}
			}}
			className="group flex h-full w-full max-w-sm cursor-pointer flex-col gap-0 bg-background p-5 outline-none transition-[border-color] hover:border-primary/50 focus-visible:ring-1 focus-visible:ring-ring/25"
		>
			{/* 顶行:图标块(左) + 状态徽章 / 行内动作(右) */}
			<div className="mb-4 flex items-start justify-between gap-2">
				<div className="flex size-9 items-center justify-center rounded-sm bg-primary/10 text-primary">
					<Workflow className="size-[18px]" />
				</div>
				<div className="flex items-center gap-1.5">
					{item.builtin ? (
						<Badge variant="secondary" className="h-7 gap-1 px-2 text-xs">
							<span aria-hidden className="size-1.5 rounded-full bg-hue-emerald" />
							内置
						</Badge>
					) : (
						<span className="flex h-7 items-center px-2 text-xs text-muted-foreground">自建</span>
					)}
					<div className="flex items-center gap-1">
						{canEdit ? (
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="编辑"
								onClick={(event) => {
									event.stopPropagation();
									onEdit();
								}}
							>
								<Pencil className="size-4" />
							</Button>
						) : null}
						{canRemove && !item.builtin ? (
							<Button
								variant="ghost"
								size="icon-sm"
								className="text-destructive"
								aria-label="删除"
								onClick={(event) => {
									event.stopPropagation();
									onDelete();
								}}
							>
								<Trash2 className="size-4" />
							</Button>
						) : null}
					</div>
				</div>
			</div>

			<h3 className="mb-1 line-clamp-1 text-base font-semibold text-foreground">{item.name}</h3>
			<p className="mb-3 text-xs leading-relaxed text-muted-foreground">
				{def.statuses.length} 个状态 · {def.edges.length} 条转移边
			</p>

			{/* 预览区(浅底,限高):状态集合,初始态带圆点 + 高亮 */}
			<div className="mb-3 max-h-24 overflow-hidden rounded-md bg-muted/50 p-3">
				{def.statuses.length > 0 ? (
					<div className="flex flex-wrap items-center gap-1.5">
						{def.statuses.map((status) => {
							const isInitial = status.value === def.initial;
							return (
								<span
									key={status.value}
									title={isInitial ? "初始态" : undefined}
									className={cn(
										"inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium",
										isInitial
											? "bg-hue-blue-soft text-hue-blue-fg ring-1 ring-hue-blue-line"
											: "bg-background text-muted-foreground",
									)}
								>
									{isInitial ? <span aria-hidden className="size-1.5 rounded-full bg-hue-blue" /> : null}
									{status.label}
								</span>
							);
						})}
					</div>
				) : (
					<span className="text-xs text-muted-foreground">未定义状态</span>
				)}
			</div>

			{/* 底部 meta(推到最低) */}
			<div className="mt-auto flex flex-wrap items-center gap-1.5">
				<span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
					<Clock className="size-3" />
					{item.updatedAt ? `更新于 ${formatLocalMinute(item.updatedAt)}` : "—"}
				</span>
			</div>
		</Card>
	);
}
