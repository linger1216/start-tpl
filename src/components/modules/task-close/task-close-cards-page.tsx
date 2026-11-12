import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarPlus, CalendarX, ClipboardList, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { PaginationControl } from "#/components/modules/shared/pagination-control";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { TaskCloseForm, type TaskFormPayload } from "#/components/modules/task-close/task-close-form";
import { TaskCardLink, TaskCloseTaskCard } from "#/components/modules/task-close/task-close-task-card";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { PAGE_SIZE_KEY, useParaRaw } from "#/hooks/use-para-prefs";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { PAGE_SIZES } from "#/lib/constants";
import type { WorkflowStatus } from "#/lib/task-close-spec";
import { formatLocalDate } from "#/lib/time";

/** 快捷区间 → 往回推的天数(含今天):今天 0 天 / 近 7 天 6 天 / 近 30 天 29 天 */
const PRESET_DAYS: Record<string, number> = { today: 0, "7d": 6, "30d": 29 };

/** 当前时刻按天平移(本地);日期筛选与快捷区间共用 */
function shiftDays(days: number): Date {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return date;
}

/**
 * 「我的任务」卡片页。
 *
 * 与设置里那批台账页的区别:这里是**服务端分页**(`taskList` 回 `{items,total,stats}`),
 * 所以分页/筛选的状态全在 query 入参上,不经过 `useLedgerTable` 那套客户端分页。
 * 筛选是 关键字 / 流程模板 / 创建时间区间 —— 状态不做全局筛选:各模板的状态互不相同。
 */
export function TaskCloseCardsPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [keyword, setKeyword] = useState("");
	const [workflowId, setWorkflowId] = useState("all");
	/** 创建时间筛选:独立的开始 / 结束(本地日期,留空 = 不限);快捷按钮只是帮忙填这两个值 */
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
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
	 * 给卡片上的状态徽章用(同一个 value 取第一个出现的中文名)。筛选已改按流程模板:
	 * 各模板的状态互不相同,全局状态筛选没有意义。
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

	function submit(payload: TaskFormPayload) {
		createMutation.mutate({
			name: payload.name,
			description: payload.description,
			dueAt: payload.dueAt,
			priority: payload.priority,
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
						isPrimary: true,
						...(filter.length ? { filter } : {}),
					}))
				: undefined,
		});
	}

	const items = listQuery.data?.items ?? [];
	const total = listQuery.data?.total ?? 0;

	/** 统计与列表**同一筛选口径**(不差分页);四个桶都与流程无关 —— 各模板状态互不相同,不按状态分桶 */
	const stats: StatItem[] = [
		{
			key: "total",
			label: "任务总数",
			value: total,
			description: "当前筛选命中多少条(与分页的总数一致)",
			Icon: ClipboardList,
			tone: "bg-hue-blue-soft text-hue-blue-fg",
			unit: "个",
		},
		{
			key: "recent",
			label: "近 7 天新建",
			value: listQuery.data?.stats.recentCreated ?? 0,
			description: "最近 7 天创建的任务",
			Icon: CalendarPlus,
			tone: "bg-hue-teal-soft text-hue-teal-fg",
			unit: "个",
		},
		{
			key: "dueSoon",
			label: "7 天内到期",
			value: listQuery.data?.stats.dueSoon ?? 0,
			description: "设了截止时间,且在未来 7 天内到期",
			Icon: CalendarClock,
			tone: "bg-hue-amber-soft text-hue-amber-fg",
			unit: "个",
		},
		{
			key: "overdue",
			label: "已到期",
			value: listQuery.data?.stats.overdue ?? 0,
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
				description="我发起、我参与的任务。点卡片进详情走闭环:改状态 / 征询 / 答复 / 评论。"
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
				{/* `Switch` 不是原生 input(它是 button),所以这里不能用 `<label>` —— biome 会判它没有关联控件 */}
				<span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
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
						<TaskCardLink key={item.id} task={item} className="block w-full max-w-sm">
							<TaskCloseTaskCard task={item} statusLabel={labelOf} />
						</TaskCardLink>
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
