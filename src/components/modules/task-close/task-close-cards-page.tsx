import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarClock, ClipboardList, Plus, User } from "lucide-react";
import { useMemo, useState } from "react";

import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { PriorityBadge, StatusBadge } from "#/components/modules/task-close/task-close-badge";
import { TaskCloseForm, type TaskFormPayload } from "#/components/modules/task-close/task-close-form";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { writeError, writeSuccess } from "#/hooks/use-ledger-write";
import { PAGE_SIZE_KEY, useParaRaw } from "#/hooks/use-para-prefs";
import { useTRPC } from "#/integrations/trpc/react";
import { PAGE_SIZES } from "#/lib/constants";
import type { WorkflowStatus } from "#/lib/task-close-spec";
import { formatLocalMinute } from "#/lib/time";

/**
 * 「我的任务」卡片页。
 *
 * 与设置里那批台账页的区别:这里是**服务端分页**(`taskList` 回 `{items,total}`),
 * 所以分页/筛选的状态全在 query 入参上,不经过 `useLedgerTable` 那套客户端分页。
 */
export function TaskCloseCardsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [keyword, setKeyword] = useState("");
	const [status, setStatus] = useState("all");
	const [mineOnly, setMineOnly] = useState(true);
	const [page, setPage] = useState(1);
	// 读 `page.size` 参数 —— loader 已 prefetch,首帧就有;fallback 20 兜底。
	// 不复用 `usePageSize()`:它内部 useQuery + useMemo 在 React 19 + sonner dev 拦截下
	// 会误报 hook queue 错,直接 `useParaRaw` + 同步解析更稳。
	const pageSizeRaw = useParaRaw(PAGE_SIZE_KEY);
	const pageSize = useMemo(() => {
		const parsed = Number(pageSizeRaw);
		return Number.isFinite(parsed) && (PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : 20;
	}, [pageSizeRaw]);
	const [createOpen, setCreateOpen] = useState(false);

	const listQuery = useQuery(
		trpc.taskClose.taskList.queryOptions(
			{
				keyword: keyword.trim() || undefined,
				status: status === "all" ? undefined : status,
				mine: mineOnly,
				page,
				pageSize,
			},
			{ placeholderData: keepPreviousData },
		),
	);

	const workflowsQuery = useQuery(trpc.taskClose.workflowList.queryOptions());
	const usersQuery = useQuery({ ...trpc.user.list.queryOptions(), enabled: createOpen });

	const workflowOptions = (workflowsQuery.data ?? []).map((row) => ({ value: row.id, label: row.name }));
	const userOptions = (usersQuery.data ?? []).map((row) => ({ value: row.id, label: row.name }));

	/**
	 * 列表投影**不带状态图快照** —— 所以用**所有模板状态清单的并集**建 `value → label`,
	 * 给状态徽章与筛选项用(同一个 value 取第一个出现的中文名)。
	 */
	const statusLabels = useMemo(() => {
		const map = new Map<string, string>();
		for (const row of workflowsQuery.data ?? []) {
			const statuses = (row.payload as { statuses?: WorkflowStatus[] } | null)?.statuses ?? [];
			for (const item of statuses) if (!map.has(item.value)) map.set(item.value, item.label);
		}
		return map;
	}, [workflowsQuery.data]);
	const labelOf = (value: string) => statusLabels.get(value) ?? value;
	const statusOptions = useMemo(
		() => [{ value: "all", label: "全部状态" }, ...[...statusLabels].map(([value, label]) => ({ value, label }))],
		[statusLabels],
	);

	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());

	const createMutation = useMutation(
		trpc.taskClose.taskCreate.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setCreateOpen(false), message: () => "任务已创建" }),
			onError: writeError,
		}),
	);

	function submit(payload: TaskFormPayload) {
		createMutation.mutate({
			name: payload.name,
			description: payload.description,
			dueAt: payload.dueAt,
			priority: payload.priority,
			workflowId: payload.workflowId,
			payload: { content: payload.content, attachments: payload.attachments },
			members: payload.executorId
				? [{ userId: payload.executorId, role: "executor" as const, isPrimary: true }]
				: undefined,
		});
	}

	const items = listQuery.data?.items ?? [];
	const total = listQuery.data?.total ?? 0;

	return (
		<PageFrame>
			<PageHeader
				title="我的任务"
				description="我发起、我参与的任务。点卡片进详情走闭环:改状态 / 征询 / 答复 / 评论。"
				descriptionInline
				actions={
					<>
						<RefreshButton busy={listQuery.isFetching} onClick={() => listQuery.refetch()} />
						<Button onClick={() => setCreateOpen(true)}>
							<Plus className="size-4" />
							新建任务
						</Button>
					</>
				}
			/>

			<div className="flex flex-wrap items-center gap-2">
				<Input
					className="h-8 w-64 text-sm"
					placeholder="搜索任务名称"
					value={keyword}
					onChange={(e) => {
						setKeyword(e.target.value);
						setPage(1);
					}}
				/>
				<Select
					items={statusOptions}
					value={status}
					onValueChange={(next) => {
						setStatus(next ? String(next) : "all");
						setPage(1);
					}}
				>
					<SelectTrigger size="sm" className="w-32">
						<SelectValue placeholder="全部状态" />
					</SelectTrigger>
					<SelectContent>
						{statusOptions.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{/* `Switch` 不是原生 input(它是 button),所以这里不能用 `<label>` —— biome 会判它没有关联控件 */}
				<span className="flex items-center gap-2 text-sm text-muted-foreground">
					<Switch
						checked={mineOnly}
						onCheckedChange={(next) => {
							setMineOnly(next);
							setPage(1);
						}}
					/>
					只看与我相关
				</span>
			</div>

			{items.length === 0 ? (
				<Card>
					<div className="py-12 text-center text-sm text-muted-foreground">
						{listQuery.isPending ? "加载中…" : "没有任务。点右上角「新建任务」起一个。"}
					</div>
				</Card>
			) : (
				<div className="flex flex-wrap gap-3">
					{items.map((item) => (
						<Link
							key={item.id}
							to="/task-close/$taskId"
							params={{ taskId: item.id }}
							className="block w-full max-w-sm rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-ring/25"
						>
							<Card className="group flex h-full cursor-pointer flex-col gap-0 bg-background p-5 transition-[border-color] hover:border-primary/50">
								{/* 顶行:图标块(左) + 状态徽章(右) —— 与「流程模板」卡片同形 */}
								<div className="mb-4 flex items-start justify-between gap-2">
									<div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-primary">
										<ClipboardList className="size-[18px]" />
									</div>
									{/* 徽章顺序:优先级(分流)的最高频扫读 → 状态。优先级缺省时让出空间,不留空徽章 */}
									<div className="flex flex-wrap items-center justify-end gap-1.5">
										{item.priority ? <PriorityBadge priority={item.priority} /> : null}
										<StatusBadge status={item.status} label={labelOf(item.status)} />
									</div>
								</div>
								<h3 className="mb-1 line-clamp-1 text-base font-semibold text-foreground">{item.name}</h3>
								<p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
									{item.description?.trim() || "（无描述）"}
								</p>
								<div className="mt-auto flex flex-wrap items-center gap-1.5">
									<span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
										<User className="size-3" />
										{item.creatorName ?? "—"}
									</span>
									<span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
										<CalendarClock className="size-3" />
										{item.dueAt ? `截止 ${formatLocalMinute(item.dueAt)}` : `建于 ${formatLocalMinute(item.createdAt)}`}
									</span>
								</div>
							</Card>
						</Link>
					))}
				</div>
			)}

			<PaginationControl
				page={page}
				pageSize={pageSize}
				total={total}
				onPageChange={setPage}
				// `page.size` 是「参数管理」里的全局偏好,卡片页不直接改 —— 改完会跳参数页
				onPageSizeChange={() => undefined}
			/>

			<TaskCloseForm
				open={createOpen}
				onOpenChange={setCreateOpen}
				pending={createMutation.isPending}
				editing={null}
				workflowOptions={workflowOptions}
				userOptions={userOptions}
				onSubmit={submit}
			/>
		</PageFrame>
	);
}
