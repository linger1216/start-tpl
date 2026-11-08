import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Clock, PauseCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { LedgerCard } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { StatCards } from "#/components/modules/shared/stat-cards";
import { actionsColumn, timeColumn } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useLedgerTable } from "#/hooks/use-ledger-table";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { createAppColumnHelper, matchKeyword } from "#/lib/table";
import { formatLocalMinute } from "#/lib/time";

type Job = {
	id: string;
	name: string;
	handler: string;
	enabled: boolean;
	intervalSeconds: number;
	cronExpression: string | null;
	timezone: string;
	timeoutSeconds: number;
	nextRunAt: string;
	lockedUntil: string | null;
};
const column = createAppColumnHelper<Job>();

export function SettingsSchedulerPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const canManage = useHasPerm("sys:scheduler:manage");
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<Job | null>(null);
	const [editing, setEditing] = useState<Job | null>(null);
	const [mode, setMode] = useState<"interval" | "cron">("interval");
	const [intervalText, setIntervalText] = useState("60");
	const [cron, setCron] = useState("");
	const [timezone, setTimezone] = useState("UTC");
	const jobs = useQuery({ ...trpc.scheduler.list.queryOptions(), refetchInterval: 10_000 });
	const executions = useQuery(
		trpc.scheduler.executions.queryOptions(
			{ id: selected?.id ?? "" },
			{ enabled: selected !== null, refetchInterval: selected ? 5000 : false },
		),
	);
	const invalidate = () => queryClient.invalidateQueries(trpc.scheduler.pathFilter());
	const toggle = useMutation(
		trpc.scheduler.setEnabled.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("调度状态已更新");
			},
			onError: toastApiError,
		}),
	);
	const trigger = useMutation(
		trpc.scheduler.trigger.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("已安排执行", { description: "Worker 将在下一次检查时执行。" });
			},
			onError: toastApiError,
		}),
	);
	const configure = useMutation(
		trpc.scheduler.configure.mutationOptions({
			onSuccess: async () => {
				setEditing(null);
				await invalidate();
				toast.success("调度计划已保存");
			},
			onError: toastApiError,
		}),
	);
	const rows = jobs.data ?? [];
	const filtered = useMemo(() => rows.filter((job) => matchKeyword([job.name, job.handler], search)), [rows, search]);
	const columns = useMemo(
		() =>
			column.columns([
				column.accessor("name", { header: "任务", size: 220 }),
				column.accessor("handler", { header: "处理器", size: 200 }),
				column.accessor("enabled", { header: "状态", size: 90, cell: (ctx) => (ctx.getValue() ? "启用" : "停用") }),
				column.accessor("intervalSeconds", {
					header: "计划",
					size: 170,
					cell: (ctx) =>
						ctx.row.original.cronExpression
							? `${ctx.row.original.cronExpression} (${ctx.row.original.timezone})`
							: `${ctx.getValue()} 秒`,
				}),
				timeColumn<Job>("nextRunAt", { header: "下次执行" }),
				actionsColumn<Job>({
					size: 260,
					viewLabel: "执行记录",
					onView: setSelected,
					extra: (job) =>
						canManage ? (
							<>
								<ActionButton
									onClick={() => {
										setEditing(job);
										setMode(job.cronExpression ? "cron" : "interval");
										setIntervalText(String(job.intervalSeconds || 60));
										setCron(job.cronExpression ?? "");
										setTimezone(job.timezone);
									}}
								>
									计划
								</ActionButton>
								<ActionButton
									disabled={toggle.isPending}
									onClick={() => toggle.mutate({ id: job.id, enabled: !job.enabled })}
								>
									{job.enabled ? "停用" : "启用"}
								</ActionButton>
								<ActionButton
									disabled={!job.enabled || trigger.isPending}
									onClick={() => trigger.mutate({ id: job.id })}
								>
									执行
								</ActionButton>
							</>
						) : null,
				}),
			]),
		[canManage, toggle.isPending, trigger.isPending, toggle.mutate, trigger.mutate],
	);
	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		getRowId: (row) => row.id,
		prefKey: "settings.scheduler",
	});
	return (
		<PageFrame>
			<PageHeader
				title="调度管理"
				description="查看任务的运行计划与最近执行记录。手动执行由独立 Worker 领取。"
				actions={<RefreshButton busy={jobs.isFetching} onClick={() => void jobs.refetch()} />}
			/>
			<StatCards
				items={[
					{
						key: "total",
						label: "任务总数",
						value: rows.length,
						description: "已注册任务",
						Icon: Clock,
						tone: "bg-hue-blue-soft text-hue-blue-fg",
						unit: "项",
					},
					{
						key: "enabled",
						label: "已启用",
						value: rows.filter((job) => job.enabled).length,
						description: "按计划领取",
						Icon: CircleCheck,
						tone: "bg-hue-teal-soft text-hue-teal-fg",
						unit: "项",
					},
					{
						key: "disabled",
						label: "已停用",
						value: rows.filter((job) => !job.enabled).length,
						description: "不会自动领取",
						Icon: PauseCircle,
						tone: "bg-secondary text-foreground",
						unit: "项",
					},
				]}
			/>
			<LedgerToolbar
				search={search}
				onSearchChange={(value) => {
					setSearch(value);
					table.setPageIndex(0);
				}}
				searchPlaceholder="搜索任务或处理器"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>
			<LedgerCard
				title="调度任务"
				Icon={Clock}
				count={filtered.length}
				busy={jobs.isFetching}
				showSkeleton={jobs.isPending}
				emptyText="暂无调度任务"
				table={table}
			/>
			<Dialog
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
			>
				<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
					<DialogHeader>
						<DialogTitle>执行记录 · {selected?.name}</DialogTitle>
						<DialogDescription>最近 50 次执行；错误信息可用于排查 Worker。</DialogDescription>
					</DialogHeader>
					<DialogBody className="grid gap-3">
						{executions.isPending ? (
							<p>正在读取…</p>
						) : executions.isError ? (
							<p className="text-destructive">读取失败，请重试。</p>
						) : !executions.data?.length ? (
							<p className="text-muted-foreground">暂无执行记录。</p>
						) : (
							executions.data.map((row) => (
								<div key={row.id} className="border-b border-border pb-2 text-sm">
									<p>
										{formatLocalMinute(row.startedAt)} ·{" "}
										{row.status === "success" ? "成功" : row.status === "running" ? "执行中" : "失败"}
										{row.durationMs !== null ? ` · ${row.durationMs} ms` : ""}
									</p>
									{row.error ? <p className="mt-1 break-words text-destructive">{row.error}</p> : null}
								</div>
							))
						)}
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" onClick={() => setSelected(null)}>
							关闭
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open && !configure.isPending) setEditing(null);
				}}
			>
				<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
					<DialogHeader>
						<DialogTitle>调度计划 · {editing?.name}</DialogTitle>
						<DialogDescription>选择固定间隔或 Cron 表达式；修改后从当前时间计算下次执行。</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<DetailRow label="触发方式">
							<div className="flex gap-2">
								<Button
									size="sm"
									variant={mode === "interval" ? "default" : "outline"}
									onClick={() => setMode("interval")}
								>
									固定间隔
								</Button>
								<Button size="sm" variant={mode === "cron" ? "default" : "outline"} onClick={() => setMode("cron")}>
									Cron
								</Button>
							</div>
						</DetailRow>
						{mode === "interval" ? (
							<DetailRow label="间隔（秒）" htmlFor="schedule-interval">
								<Input
									id="schedule-interval"
									type="number"
									min={1}
									value={intervalText}
									onChange={(event) => setIntervalText(event.target.value)}
								/>
							</DetailRow>
						) : (
							<>
								<DetailRow label="Cron 表达式" htmlFor="schedule-cron">
									<Input
										id="schedule-cron"
										value={cron}
										placeholder="0 9 * * 1-5"
										onChange={(event) => setCron(event.target.value)}
									/>
								</DetailRow>
								<DetailRow label="时区" htmlFor="schedule-timezone">
									<Input
										id="schedule-timezone"
										value={timezone}
										placeholder="Asia/Shanghai"
										onChange={(event) => setTimezone(event.target.value)}
									/>
								</DetailRow>
							</>
						)}
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" onClick={() => setEditing(null)} disabled={configure.isPending}>
							取消
						</Button>
						<Button
							disabled={
								configure.isPending ||
								(mode === "interval"
									? !Number.isInteger(Number(intervalText)) || Number(intervalText) < 1
									: !cron.trim() || !timezone.trim())
							}
							onClick={() => {
								if (editing)
									configure.mutate({
										id: editing.id,
										mode,
										intervalSeconds: mode === "interval" ? Number(intervalText) : undefined,
										cronExpression: mode === "cron" ? cron : undefined,
										timezone,
									});
							}}
						>
							保存
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</PageFrame>
	);
}
