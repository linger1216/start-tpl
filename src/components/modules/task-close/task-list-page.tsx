import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BellRing,
	CalendarClock,
	CalendarX,
	ClipboardList,
	Flag,
	Plus,
	RotateCcw,
	SearchX,
	Trash2,
	Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "#/components/layout/empty-state";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { FilterChipBar, type FilterChipGroup } from "#/components/modules/shared/filter-chips";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { AsyncState } from "#/components/modules/task-close/async-state";
import { TaskCard, TaskCardLink } from "#/components/modules/task-close/task-card";
import { type CreateTaskPayload, TaskForm } from "#/components/modules/task-close/task-form";
import { useConfirm } from "#/components/modules/task-close/use-confirm";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { DateRangePicker, type DateRangeValue } from "#/components/ui/date-range-picker";
import { Input } from "#/components/ui/input";
import { RefreshButton } from "#/components/ui/refresh-button";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { PAGE_SIZE_KEY, parsePageSize, useFilterPrefs, useParaRaw } from "#/hooks/use-para-prefs";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { priorityLabelOf, priorityToneOf, TASK_PRIORITIES } from "#/lib/task/close-spec";
import { localDateEndIso, localDateToIso } from "#/lib/time";

/**
 * 快速筛选的三组 —— 形态由 `shared/filter-chips` 统一,这里只给**语义**:
 * 组内单选还是多选、每个选项叫什么、选中时什么颜色。
 *
 * - 优先级:多选(P0/P1/P2 可同时开),颜色与任务卡片上的优先级徽章同色(同一哈希口径)
 * - 期限:单选(临期 / 超期 互斥),颜色走期限语义色
 * - 范围:多选(两个独立开关,可同时开)
 */
const QUICK_GROUPS: readonly FilterChipGroup[] = [
	{
		key: "priority",
		label: "优先级",
		Icon: Flag,
		multiple: true,
		options: TASK_PRIORITIES.map((value) => ({
			value: String(value),
			label: priorityLabelOf(value),
			activeClassName: priorityToneOf(value),
		})),
	},
	{
		key: "deadline",
		label: "期限",
		Icon: CalendarClock,
		options: [
			{ value: "soon", label: "临期", activeClassName: "bg-warn-soft text-warn-fg" },
			{ value: "overdue", label: "超期", activeClassName: "bg-danger-soft text-danger-fg" },
		],
	},
	{
		key: "scope",
		label: "范围",
		Icon: Users,
		multiple: true,
		options: [
			{ value: "pending", label: "待你处理" },
			{ value: "mine", label: "只看与我相关" },
		],
	},
];

/**
 * 「我的任务」卡片页。
 *
 * 与设置里那批台账页的区别:这里是**服务端分页**(`taskList` 回 `{items,total,stats}`),
 * 所以分页/筛选的状态全在 query 入参上,不经过 `useLedgerTable` 那套客户端分页。
 * 筛选是 关键字 / 流程模板 / 创建时间区间 —— 状态不做全局筛选:各模板的状态互不相同。
 */
export function TaskListPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [keyword, setKeyword] = useState("");
	/** 创建时间筛选:区间(本地日期,空 = 不限);形态全站统一走 `ui/date-range-picker` */
	const [timeRange, setTimeRange] = useState<DateRangeValue>({});
	/**
	 * 快速筛选 —— 三组,统一成「每组一个选中值数组」(单选组最多一个,多选组可多个):
	 * `priority` 优先级(多选)· `deadline` 期限(临期 / 超期 互斥)· `scope` 范围(两个独立开关)。
	 * 形态全站统一走 `shared/filter-chips`,不再各页手写一排小按钮。
	 */
	const [quick, setQuick] = useState<Record<string, string[]>>({ priority: [], deadline: [], scope: ["mine"] });
	const [page, setPage] = useState(1);
	// 读 `page.size` 参数 —— loader 已 prefetch,首帧就有;`parsePageSize` 兜底 20
	const pageSize = parsePageSize(useParaRaw(PAGE_SIZE_KEY));
	/** 快速筛选条的展开态 —— 按页键记进参数(`page.filters`),下次进同一页保持 */
	const filterPrefs = useFilterPrefs("task-close");
	const [createOpen, setCreateOpen] = useState(false);
	const removeTask = useConfirm<{ id: string; name: string; childCount: number }>();

	// 时间筛选折成创建时间的下限 / 上限:开始取当天零点,结束取当天 23:59:59.999(本地)
	const startTime = useMemo(() => localDateToIso(timeRange.from) ?? undefined, [timeRange.from]);
	const endTime = useMemo(() => localDateEndIso(timeRange.to) ?? undefined, [timeRange.to]);

	const listQuery = useQuery(
		trpc.taskClose.taskList.queryOptions(
			{
				keyword: keyword.trim() || undefined,
				startTime,
				endTime,
				mine: quick.scope.includes("mine"),
				pending: quick.scope.includes("pending") || undefined,
				priority: quick.priority.length ? quick.priority.map(Number).sort() : undefined,
				deadline: (quick.deadline[0] as "soon" | "overdue" | undefined) ?? undefined,
				page,
				pageSize,
			},
			{ placeholderData: keepPreviousData },
		),
	);

	const workflowsQuery = useQuery(trpc.taskClose.workflowList.queryOptions());
	const usersQuery = useQuery({ ...trpc.user.list.queryOptions(), enabled: createOpen });
	const workflowOptions = useMemo(
		() => (workflowsQuery.data ?? []).map((row) => ({ value: row.id, label: row.name })),
		[workflowsQuery.data],
	);
	const userOptions = useMemo(
		() => (usersQuery.data ?? []).map((row) => ({ value: row.id, label: row.name })),
		[usersQuery.data],
	);

	/** 新建表单的默认值(截止日按工作日口径,服务端算) */
	const defaultsQuery = useQuery(trpc.taskClose.taskDefaults.queryOptions());

	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());

	const createMutation = useMutation(
		trpc.taskClose.taskCreate.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setCreateOpen(false), message: () => "任务已创建" }),
			onError: toastApiError,
		}),
	);
	const removeMutation = useMutation(
		trpc.taskClose.taskRemove.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: removeTask.dismiss,
				message: ({ deletedCount }) =>
					deletedCount > 1 ? `任务及其 ${deletedCount - 1} 条下级任务已删除` : "任务已删除",
			}),
			onError: toastApiError,
		}),
	);

	function submit(payload: CreateTaskPayload) {
		createMutation.mutate({
			name: payload.name,
			description: payload.description,
			dueAt: payload.dueAt,
			priority: payload.priority,
			reminderConfig: payload.reminderConfig,
			workflowId: payload.workflowId,
			report: payload.report
				? {
						reportId: payload.report.reportId,
						...(payload.report.rows?.length ? { rows: payload.report.rows } : {}),
						...(payload.reportFilter.length ? { filter: payload.reportFilter } : {}),
					}
				: undefined,
			payload: { links: payload.links, attachments: payload.attachments },
			members: payload.executors.length
				? payload.executors.map(({ userId, filter }) => ({
						userId,
						role: "executor" as const,
						...(filter.length ? { filter } : {}),
					}))
				: undefined,
		});
	}

	const items = listQuery.data?.items ?? [];
	const total = listQuery.data?.total ?? 0;

	/**
	 * 空态 —**两种情况必须分开说**,否则用户不知道该干哪件事:
	 * ① 真的没有任务 → 「还没有任务」+ 新增;
	 * ② 有任务但被筛没了 → 「没有符合条件的任务」+ 一键清空筛选(不是让他去新增)。
	 *
	 * 判据就是「除分页外还有没有任何筛选条件」:任一命中即算「正在筛」。
	 */
	const filtering =
		keyword.trim().length > 0 ||
		Boolean(timeRange.from || timeRange.to) ||
		QUICK_GROUPS.some((group) => (quick[group.key] ?? []).length > 0 && group.key !== "scope") ||
		!quick.scope.includes("mine") ||
		quick.scope.includes("pending");

	const clearFilters = () => {
		setKeyword("");
		setTimeRange({});
		setQuick({ priority: [], deadline: [], scope: ["mine"] });
		setPage(1);
	};

	const emptyProps = filtering
		? {
				icon: <SearchX className="size-5" />,
				title: "没有符合条件的任务",
				description: "当前筛选条件下一条都没命中。换个关键词,或者清空筛选看全部任务。",
				actions: (
					<Button variant="ghost" onClick={clearFilters}>
						<RotateCcw className="size-4" />
						清空筛选
					</Button>
				),
			}
		: {
				icon: <ClipboardList className="size-5" />,
				tone: "brand" as const,
				title: "还没有任务",
				description: "这里会列出你发起、你参与的任务。起一个任务,把要做的事派给自己或执行人。",
				actions: (
					<Button onClick={() => setCreateOpen(true)}>
						<Plus className="size-4" />
						新增任务
					</Button>
				),
			};

	/** 取不到数就写「—」而不是 0 —— 0 会说「无事可做」,把故障伪装成清空 */
	const statOf = (value: number | undefined) => (listQuery.isError || value === undefined ? "—" : value);

	/** 统计与列表**同一筛选口径**(不差分页);四个桶都与流程无关 —— 各模板状态互不相同,不按状态分桶 */
	const stats: StatItem[] = [
		{
			key: "pending",
			label: "待我处理",
			value: statOf(listQuery.data?.stats.pendingMine),
			description: "有审批 / 征询正轮到我的任务(不受下方筛选影响)",
			Icon: BellRing,
			tone: "bg-hue-amber-soft text-hue-amber-fg",
			unit: "个",
		},
		{
			key: "total",
			label: "任务总数",
			value: statOf(total),
			description: "当前筛选命中多少条(与分页的总数一致)",
			Icon: ClipboardList,
			tone: "bg-hue-blue-soft text-hue-blue-fg",
			unit: "个",
		},
		{
			key: "dueSoon",
			label: "7 天内到期",
			value: statOf(listQuery.data?.stats.dueSoon),
			description: "设了截止时间,且在未来 7 天内到期",
			Icon: CalendarClock,
			tone: "bg-hue-teal-soft text-hue-teal-fg",
			unit: "个",
		},
		{
			key: "overdue",
			label: "已到期",
			value: statOf(listQuery.data?.stats.overdue),
			description: "截止时间已过(只要设了截止,不限当前状态)",
			Icon: CalendarX,
			tone: "bg-hue-rose-soft text-hue-rose-fg",
			unit: "个",
		},
	];

	return (
		<PageFrame>
			<PageHeader
				title="我的任务"
				description="我发起、我参与的任务。有子任务的卡片进去后,在详情页里能直接看到子任务。"
				actions={
					<>
						<RefreshButton busy={listQuery.isFetching} onClick={() => listQuery.refetch()} />
						<Button onClick={() => setCreateOpen(true)}>
							<Plus className="size-4" />
							新增任务
						</Button>
					</>
				}
			/>

			<StatCards items={stats} />

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
				{/* 创建时间区间:全站唯一形态 —— `ui/date-range-picker`(快捷范围在浮层里,不再另做一套) */}
				<DateRangePicker
					value={timeRange}
					onChange={(next) => {
						setTimeRange(next);
						setPage(1);
					}}
					placeholder="时间区间"
				/>
			</div>

			<FilterChipBar
				title="快速筛选"
				collapsible
				initialExpanded={filterPrefs.initialExpanded}
				onExpandedChange={filterPrefs.persist}
				groups={QUICK_GROUPS}
				active={quick}
				onChange={(groupKey, next) => {
					setQuick((prev) => ({ ...prev, [groupKey]: [...next] }));
					setPage(1);
				}}
			/>

			{/* 三态分开:加载 / 出错 / 真的没有 —— 把「取不到」说成「没有」会让人以为工作被清空了。
			   有数据时卡片**直接铺在页面上**,不再套外层 Card(白底套白底会糊成一整块通栏宽面板)。 */}
			{listQuery.isPending || listQuery.isError || items.length === 0 ? (
				<Card>
					<AsyncState
						pending={listQuery.isPending}
						error={listQuery.isError ? listQuery.error : undefined}
						isFetching={listQuery.isFetching}
						onRetry={() => listQuery.refetch()}
						empty={items.length === 0 ? <EmptyState {...emptyProps} /> : null}
					/>
				</Card>
			) : (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(min(24rem,100%),1fr))] gap-3">
					{items.map((item) => (
						<div key={item.id} className="h-48 min-w-0">
							{item.canRemove ? (
								<TaskCard
									task={item}
									action={
										<Button
											variant="ghost"
											size="icon-sm"
											className="size-7 text-muted-foreground hover:text-destructive"
											aria-label={`删除任务：${item.name}`}
											title="删除任务"
											onClick={() => removeTask.ask(item)}
										>
											<Trash2 className="size-3.5" aria-hidden />
										</Button>
									}
								/>
							) : (
								<TaskCardLink task={item} className="block h-full">
									<TaskCard task={item} />
								</TaskCardLink>
							)}
						</div>
					))}
				</div>
			)}

			<PaginationControl
				page={page}
				pageSize={pageSize}
				total={total}
				onPageChange={setPage}
				// `page.size` 是「参数管理」里的全局偏好,卡片页不直接改 —— 所以不给这一组,
				// 免得放出点了没反应的按钮(要去参数页改)
			/>

			{createOpen ? (
				<TaskForm
					open={createOpen}
					onOpenChange={setCreateOpen}
					pending={createMutation.isPending}
					editing={null}
					workflowOptions={workflowOptions}
					userOptions={userOptions}
					defaultDueAt={defaultsQuery.data?.dueAt}
					onCreate={submit}
				/>
			) : null}

			<removeTask.Dialog
				title="删除任务"
				description={(task) =>
					task.childCount > 0
						? `「${task.name}」及其 ${task.childCount} 条下级任务会被删除,相关动作与评论一并不可见。`
						: `「${task.name}」会被软删,相关动作与评论一并不可见。`
				}
				isPending={removeMutation.isPending}
				confirmText="删除任务"
				pendingText="删除中…"
				confirmVariant="destructive"
				onConfirm={(task) => removeMutation.mutate({ id: task.id })}
			/>
		</PageFrame>
	);
}
