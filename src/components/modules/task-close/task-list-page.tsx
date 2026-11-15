import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarClock, CalendarX, ClipboardList, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { AsyncState } from "#/components/modules/task-close/async-state";
import { TaskCard, TaskCardLink } from "#/components/modules/task-close/task-card";
import { type CreateTaskPayload, TaskForm } from "#/components/modules/task-close/task-form";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { PAGE_SIZE_KEY, parsePageSize, useParaRaw } from "#/hooks/use-para-prefs";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { priorityLabelOf, statusesOf, TASK_PRIORITIES } from "#/lib/task/close-spec";
import { formatLocalDate } from "#/lib/time";
import { cn } from "#/lib/utils";

/** 快捷区间 → 往回推的天数(含今天):今天 0 天 / 近 7 天 6 天 / 近 30 天 29 天 */
const PRESET_DAYS: Record<string, number> = { today: 0, "7d": 6, "30d": 29 };

/** 当前时刻按天平移(本地);日期筛选与快捷区间共用 */
function shiftDays(days: number): Date {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return date;
}

/** 快捷筛选的文字按钮:静置是次级文字,选中时淡底 + 主色(同一排里一眼看出哪些生效) */
function QuickFilter({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
	return (
		<ActionButton
			aria-pressed={active}
			onClick={onClick}
			className={cn("rounded-full px-2 py-0.5", active && "bg-brand-soft font-medium text-primary hover:no-underline")}
		>
			{children}
		</ActionButton>
	);
}

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
	const [workflowId, setWorkflowId] = useState("all");
	/** 创建时间筛选:独立的开始 / 结束(本地日期,留空 = 不限);快捷按钮只是帮忙填这两个值 */
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [mineOnly, setMineOnly] = useState(true);
	/** 只看「有动作正轮到我处理」的 —— 与卡面「待你处理」同一判据 */
	const [pendingOnly, setPendingOnly] = useState(false);
	/** 快捷筛选:优先级(可多选)与期限(临期 / 超期,互斥) */
	const [priorities, setPriorities] = useState<number[]>([]);
	const [deadline, setDeadline] = useState<"" | "soon" | "overdue">("");
	const [page, setPage] = useState(1);
	// 读 `page.size` 参数 —— loader 已 prefetch,首帧就有;`parsePageSize` 兜底 20
	const pageSize = parsePageSize(useParaRaw(PAGE_SIZE_KEY));
	const [createOpen, setCreateOpen] = useState(false);

	// 时间筛选折成创建时间的下限 / 上限:开始取当天零点,结束取当天 23:59:59.999(本地)
	const createdAfter = useMemo(() => (startDate ? new Date(`${startDate}T00:00:00`) : undefined), [startDate]);
	const createdBefore = useMemo(() => (endDate ? new Date(`${endDate}T23:59:59.999`) : undefined), [endDate]);

	/** 快捷区间:把对应天数填进开始 / 结束(days 含今天,0 = 今天) */
	function applyPreset(days: number) {
		setStartDate(formatLocalDate(shiftDays(-days)));
		setEndDate(formatLocalDate(new Date()));
		setPage(1);
	}

	/** 当前日期组合命中的快捷区间;手动改过日期 = 自定义,三段都不亮 */
	const activePreset = useMemo(() => {
		const today = formatLocalDate(new Date());
		for (const [preset, days] of Object.entries(PRESET_DAYS)) {
			if (startDate === formatLocalDate(shiftDays(-days)) && endDate === today) return preset;
		}
		return "";
	}, [startDate, endDate]);

	const listQuery = useQuery(
		trpc.taskClose.taskList.queryOptions(
			{
				keyword: keyword.trim() || undefined,
				workflowId: workflowId === "all" ? undefined : workflowId,
				createdAfter,
				createdBefore,
				mine: mineOnly,
				pending: pendingOnly || undefined,
				priority: priorities.length ? [...priorities].sort() : undefined,
				deadline: deadline || undefined,
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

	/**
	 * 列表投影**不带状态图快照** —— 所以用**所有模板状态清单的并集**建 `value → label`,
	 * 给卡片上的状态徽章用(同一个 value 取第一个出现的中文名)。筛选已改按流程模板:
	 * 各模板的状态互不相同,全局状态筛选没有意义。
	 */
	const statusLabels = useMemo(() => {
		const map = new Map<string, string>();
		for (const row of workflowsQuery.data ?? []) {
			const statuses = statusesOf(row.payload);
			for (const item of statuses) if (!map.has(item.value)) map.set(item.value, item.label);
		}
		return map;
	}, [workflowsQuery.data]);
	const labelOf = (value: string) => statusLabels.get(value) ?? value;

	const workflowFilterOptions = useMemo(
		() => [{ value: "all", label: "全部流程" }, ...workflowOptions],
		[workflowOptions],
	);

	const invalidate = () => queryClient.invalidateQueries(trpc.taskClose.pathFilter());

	const createMutation = useMutation(
		trpc.taskClose.taskCreate.mutationOptions({
			onSuccess: writeSuccess(invalidate, { close: () => setCreateOpen(false), message: () => "任务已创建" }),
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
				<Select
					items={workflowFilterOptions}
					value={workflowId}
					onValueChange={(next) => {
						setWorkflowId(next ? String(next) : "all");
						setPage(1);
					}}
				>
					<SelectTrigger size="sm" className="w-64">
						<SelectValue placeholder="全部流程" />
					</SelectTrigger>
					<SelectContent>
						{workflowFilterOptions.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<span className="flex items-center gap-1.5">
					<Input
						type="date"
						aria-label="创建开始日期"
						value={startDate}
						className="h-8 w-64 text-sm"
						onChange={(e) => {
							const next = e.target.value;
							setStartDate(next);
							// 倒挂时把结束拨齐到开始,免得区间为空还看不出来
							if (next && endDate && next > endDate) setEndDate(next);
							setPage(1);
						}}
					/>
					<span className="text-xs text-muted-foreground">至</span>
					<Input
						type="date"
						aria-label="创建结束日期"
						value={endDate}
						className="h-8 w-64 text-sm"
						onChange={(e) => {
							const next = e.target.value;
							setEndDate(next);
							if (next && startDate && next < startDate) setStartDate(next);
							setPage(1);
						}}
					/>
					<ActionButton
						onClick={() => {
							setStartDate("");
							setEndDate("");
							setPage(1);
						}}
					>
						清除
					</ActionButton>
				</span>
				{/* 快捷区间(分段控件):只是帮上面两个日期填值 —— 手动改过日期后三段都不亮,即「自定义」 */}
				<Tabs
					variant="segmented"
					value={activePreset}
					onValueChange={(next) => applyPreset(PRESET_DAYS[String(next)] ?? 0)}
				>
					<TabsList>
						<TabsTrigger value="today">今天</TabsTrigger>
						<TabsTrigger value="7d">近 7 天</TabsTrigger>
						<TabsTrigger value="30d">近 30 天</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			{/*
			  快捷筛选:一排**文字按钮**,点一下就过滤(再点取消)。
			  — 优先级可多选(P0/P1/P2);临期 / 超期 互斥(都是"期限压力",同时成立没有意义);
			  — 待我处理 / 只看与我相关 原来是开关,改成同一排文字按钮,保持一致。
			*/}
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<span className="text-xs text-muted-foreground">快捷筛选</span>
				{TASK_PRIORITIES.map((value) => (
					<QuickFilter
						key={value}
						active={priorities.includes(value)}
						onClick={() => {
							setPriorities((prev) =>
								prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
							);
							setPage(1);
						}}
					>
						{priorityLabelOf(value)}
					</QuickFilter>
				))}
				<span className="h-3 w-px bg-border" />
				<QuickFilter
					active={deadline === "soon"}
					onClick={() => {
						setDeadline((prev) => (prev === "soon" ? "" : "soon"));
						setPage(1);
					}}
				>
					临期
				</QuickFilter>
				<QuickFilter
					active={deadline === "overdue"}
					onClick={() => {
						setDeadline((prev) => (prev === "overdue" ? "" : "overdue"));
						setPage(1);
					}}
				>
					超期
				</QuickFilter>
				<span className="h-3 w-px bg-border" />
				<QuickFilter
					active={pendingOnly}
					onClick={() => {
						setPendingOnly((prev) => !prev);
						setPage(1);
					}}
				>
					待我处理
				</QuickFilter>
				<QuickFilter
					active={mineOnly}
					onClick={() => {
						setMineOnly((prev) => !prev);
						setPage(1);
					}}
				>
					只看与我相关
				</QuickFilter>
			</div>

			{/* 三态分开:加载 / 出错 / 真的没有 —— 把「取不到」说成「没有」会让人以为工作被清空了。
			   有数据时卡片**直接铺在页面上**,不再套外层 Card(白底套白底会糊成一整块通栏宽面板)。 */}
			{listQuery.isPending || listQuery.isError || items.length === 0 ? (
				<Card>
					<AsyncState
						pending={listQuery.isPending}
						error={listQuery.isError ? listQuery.error : undefined}
						isFetching={listQuery.isFetching}
						onRetry={() => listQuery.refetch()}
						empty={
							items.length === 0
								? pendingOnly
									? "没有轮到你处理的事。关掉「只看待我处理」看全部任务。"
									: "没有任务。点右上角「新增任务」起一个。"
								: null
						}
					/>
				</Card>
			) : (
				<div className="flex flex-wrap gap-3">
					{items.map((item) => (
						<TaskCardLink key={item.id} task={item} className="block w-full h-48 max-w-sm">
							<TaskCard task={item} statusLabel={labelOf} />
						</TaskCardLink>
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

			<TaskForm
				open={createOpen}
				onOpenChange={setCreateOpen}
				pending={createMutation.isPending}
				editing={null}
				workflowOptions={workflowOptions}
				userOptions={userOptions}
				onCreate={submit}
			/>
		</PageFrame>
	);
}
