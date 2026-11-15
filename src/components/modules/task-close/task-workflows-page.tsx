import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, GitBranch, Layers, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import type { StatItem } from "#/components/modules/shared/stat-cards";
import { TaskWorkflowDetail } from "#/components/modules/task-close/task-workflow-detail";
import {
	TaskWorkflowForm,
	type WorkflowEditing,
	type WorkflowFormPayload,
} from "#/components/modules/task-close/task-workflow-form";
import { TemplateCard, TemplateCardPageShell } from "#/components/modules/task-close/template-card";
import { useConfirm } from "#/components/modules/task-close/use-confirm";

import { Tag } from "#/components/ui/tag";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
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
export function TaskWorkflowsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const canAdd = useHasPerm("sys:tcWorkflow:add");
	const canEdit = useHasPerm("sys:tcWorkflow:edit");
	const canRemove = useHasPerm("sys:tcWorkflow:remove");

	const [form, setForm] = useState<"create" | WorkflowEditing | null>(null);
	const [detailId, setDetailId] = useState<string | null>(null);
	const del = useConfirm<ListItem>();

	const listQuery = useQuery(trpc.taskClose.workflowList.queryOptions());

	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());

	const createMutation = useMutation(
		trpc.taskClose.workflowCreate.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setForm(null), message: () => "流程模板已创建" }),
			onError: toastApiError,
		}),
	);

	const updateMutation = useMutation(
		trpc.taskClose.workflowUpdate.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => setForm(null),
				message: () => "流程模板已保存",
			}),
			onError: toastApiError,
		}),
	);

	const removeMutation = useMutation(
		trpc.taskClose.workflowRemove.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: del.dismiss, message: () => "流程模板已删除" }),
			onError: toastApiError,
		}),
	);

	const items = useMemo(() => (listQuery.data ?? []) as ListItem[], [listQuery.data]);
	const detailItem = items.find((item) => item.id === detailId);

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
				value: listQuery.isError ? "—" : items.length,
				Icon: Workflow,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
			},
			{
				key: "statuses",
				label: "状态",
				value: listQuery.isError ? "—" : sums.statuses,
				Icon: Layers,
				tone: "bg-hue-violet-soft text-hue-violet-fg",
			},
			{
				key: "edges",
				label: "转移边",
				value: listQuery.isError ? "—" : sums.edges,
				Icon: GitBranch,
				tone: "bg-hue-amber-soft text-hue-amber-fg",
			},
		];
	}, [items, listQuery.isError]);

	function openCreate() {
		setForm("create");
	}

	function openEdit(item: ListItem) {
		setForm(toEditing(item));
	}

	function submit(payload: WorkflowFormPayload) {
		if (form && form !== "create") updateMutation.mutate({ id: form.id, ...payload });
		else createMutation.mutate(payload);
	}

	return (
		<TemplateCardPageShell
			title="流程模板"
			description="任务闭环的状态图模板：状态集合、初始态、状态转移边。建任务时按模板复制一份快照,之后改模板不影响已建任务。"
			stats={stats}
			emptyIcon={<Workflow className="size-6" />}
			emptyDescription="流程模板定义任务的状态集合、初始态与状态转移边。建任务时选一个模板,它的定义会复制成任务快照。"
			isEmpty={items.length === 0}
			isPending={listQuery.isPending}
			isError={listQuery.isError}
			isFetching={listQuery.isFetching}
			canAdd={canAdd}
			onCreate={openCreate}
			onRefresh={() => void listQuery.refetch()}
			cards={items.map((item) => (
				<WorkflowCard
					key={item.id}
					item={item}
					canEdit={canEdit}
					canRemove={canRemove}
					onView={() => setDetailId(item.id)}
					onEdit={() => openEdit(item)}
					onDelete={() => del.ask(item)}
				/>
			))}
		>
			<TaskWorkflowForm
				open={form !== null}
				onOpenChange={(next) => {
					if (!next) setForm(null);
				}}
				pending={createMutation.isPending || updateMutation.isPending}
				editing={form === "create" ? null : form}
				onSubmit={submit}
			/>

			<TaskWorkflowDetail
				open={detailId !== null}
				onOpenChange={(next) => {
					if (!next) setDetailId(null);
				}}
				detail={detailItem ? { ...detailItem, ...parsed(detailItem) } : null}
				onEdit={canEdit && detailItem ? () => openEdit(detailItem) : undefined}
			/>

			<del.Dialog
				title="删除流程模板"
				description={(t) => `「${t.name}」会被软删,列表里不再出现;已建任务的状态图是快照,不受影响。`}
				isPending={removeMutation.isPending}
				onConfirm={(t) => removeMutation.mutate({ id: t.id })}
			/>
		</TemplateCardPageShell>
	);
}

/**
 * 一张模板卡片 —— 版式对齐「资源卡」:图标 + 状态/动作在同一行、标题 + 一行说明、
 * 一块浅底预览(状态集合)、底部 meta 胶囊。**整卡可点开详情**,行内动作 `stopPropagation`。
 *
 * 白底(`bg-card`,与表格 / dialog 同一档纸白)+ flex 纵向;`max-w-sm` 限宽、预览区 `max-h-24` 限高,配合外层 `flex flex-wrap` 换行。
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
		<TemplateCard
			name={item.name}
			viewLabel={`查看流程模板 ${item.name}`}
			icon={<Workflow className="size-4.5" />}
			badge={
				item.builtin ? (
					<Tag variant="secondary" className="h-7 gap-1 px-2 text-xs">
						<span aria-hidden className="size-1.5 rounded-full bg-hue-emerald" />
						内置
					</Tag>
				) : (
					<span className="flex h-7 items-center px-2 text-xs text-muted-foreground">自建</span>
				)
			}
			description={
				<>
					{def.statuses.length} 个状态 · {def.edges.length} 条转移边
				</>
			}
			preview={
				def.statuses.length ? (
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
				)
			}
			meta={
				<span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
					<Clock className="size-3" />
					{item.updatedAt ? `更新于 ${formatLocalMinute(item.updatedAt)}` : PLACEHOLDER_EMPTY}
				</span>
			}
			canEdit={canEdit}
			canRemove={canRemove && !item.builtin}
			onView={onView}
			onEdit={onEdit}
			onDelete={onDelete}
		/>
	);
}
