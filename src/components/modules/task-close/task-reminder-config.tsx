import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";
import { useTRPC } from "#/integrations/trpc/react";
import {
	CADENCE_LABELS,
	CHANNEL_LABELS,
	type ExecutorReminderRule,
	executorSummaryOf,
	MAX_DAYS_BEFORE,
	NODE_REMINDER_OPTIONS,
	type NodeReminderRule,
	nodeSummaryOf,
	REMINDER_CADENCES,
	REMINDER_CHANNELS,
	type ReminderCadence,
	type TaskReminderConfig,
} from "#/lib/task/reminder-spec";
import { formatLocalMinute } from "#/lib/time";

const CADENCE_ITEMS = REMINDER_CADENCES.map((value) => ({ value, label: CADENCE_LABELS[value] }));
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/** `提醒时间` 两侧的控件间距统一 8px,别让"频率 / 时间 / 天数"看着像三件不相关的事 */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
	return (
		<Label htmlFor={htmlFor} className="text-xs font-normal text-muted-foreground">
			{children}
		</Label>
	);
}

function ChannelPicker({
	idPrefix,
	value,
	onChange,
}: {
	idPrefix: string;
	value: TaskReminderConfig["node"]["channels"];
	onChange: (channels: TaskReminderConfig["node"]["channels"]) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-4 text-sm">
			<span className="text-xs text-muted-foreground">提醒方式</span>
			{REMINDER_CHANNELS.map((channel) => (
				<label key={channel} htmlFor={`${idPrefix}-${channel}`} className="flex items-center gap-1.5">
					<Checkbox
						id={`${idPrefix}-${channel}`}
						checked={value.includes(channel)}
						onCheckedChange={(checked) =>
							onChange(checked ? [...value, channel] : value.filter((item) => item !== channel))
						}
					/>
					{CHANNEL_LABELS[channel]}
				</label>
			))}
		</div>
	);
}

/**
 * 提醒日期预览:频率那一行右侧一颗图标,**悬停 / 键盘 focus** 出前 5 次提醒的具体日期。
 *
 * 计算走服务端(`reminderPreview`)—— 节假日数据(2011–2026)不进客户端包,也保证与真正排期同一份代码。
 * 提醒关闭 / 没填截止时间时,图标置灰但**照样能悬停**(用 `aria-disabled` 而不是 `disabled`,
 * 否则鼠标事件不触发,用户就看不到"为什么不能预览")。
 */
function ReminderPreview({ rule, dueAt }: { rule: ExecutorReminderRule; dueAt: string | null }) {
	const trpc = useTRPC();
	const reason = rule.cadence === "off" ? "截止提醒已关闭,先选一个频率。" : dueAt ? null : "先填上截止时间。";
	const query = useQuery(
		trpc.taskClose.reminderPreview.queryOptions({ executor: rule, dueAt: dueAt ?? "" }, { enabled: !reason }),
	);
	const preview = query.data;
	return (
		<TooltipProvider delay={120}>
			<Tooltip>
				<TooltipTrigger
					aria-label="查看提醒日期"
					aria-disabled={reason ? true : undefined}
					className="text-muted-foreground transition-colors hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground/40 aria-disabled:hover:text-muted-foreground/40"
				>
					<CalendarClock className="size-4" />
				</TooltipTrigger>
				<TooltipContent side="top" align="end" className="block max-w-[19rem]">
					{reason ? (
						<span>{reason}</span>
					) : (
						<div className="grid gap-0.5 text-left">
							{query.isPending ? <span>正在算…</span> : null}
							{preview && preview.total === 0 ? <span>这个窗口里没有可提醒的工作日。</span> : null}
							{preview?.times.map((time) => (
								<span key={time} className="tabular-nums">
									{formatLocalMinute(time)}
									<span className="ml-1 text-background/70">{WEEKDAYS[new Date(time).getDay()]}</span>
								</span>
							))}
							{preview && preview.total > preview.times.length ? (
								<span className="text-background/70">
									…共 {preview.total} 次,最后一次 {preview.last ? formatLocalMinute(preview.last) : "—"}
								</span>
							) : null}
							{preview?.known === false ? (
								<span className="text-background/70">该日期已超出内置节假日数据,只按周末判断。</span>
							) : null}
							<span className="text-background/70">周末与法定节假日不提醒(调休上班日照常)。</span>
						</div>
					)}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

/**
 * 任务提醒设置 —— 两块,都是"一行设完 + 一句人话":
 *
 * - **执行人截止提醒**:频率(关闭 / 每天 / 每周)+ 时间点 + 提前几天(窗口),只在**工作日**提醒;
 * - **节点处理人未查看提醒**:未查看超过 X 时长提醒一次。
 *
 * 规则本身在 `lib/task/reminder-spec.ts`(含工作日展开),这里只做交互。
 */
export function TaskReminderConfigEditor({
	value,
	onChange,
	dueAt = null,
}: {
	value: TaskReminderConfig;
	onChange: (value: TaskReminderConfig) => void;
	/** 截止时间(ISO);预览要拿它算日期,没填就只能提示"先填截止时间" */
	dueAt?: string | null;
}) {
	const { executor, node } = value;
	const setExecutor = (next: Partial<ExecutorReminderRule>) =>
		onChange({ ...value, executor: { ...executor, ...next } });
	const setNode = (next: Partial<NodeReminderRule>) => onChange({ ...value, node: { ...node, ...next } });
	const executorOff = executor.cadence === "off";
	const nodeOff = node.afterMinutes === null;
	return (
		<div className="grid gap-5">
			<div className="grid gap-2">
				<div className="flex items-center justify-between gap-2">
					<Label className="text-sm">执行人截止提醒</Label>
					<ReminderPreview rule={executor} dueAt={dueAt} />
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Select
						value={executor.cadence}
						items={CADENCE_ITEMS}
						onValueChange={(next) => setExecutor({ cadence: next as ReminderCadence })}
					>
						<SelectTrigger className="h-8 w-32" aria-label="提醒频率">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CADENCE_ITEMS.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<FieldLabel htmlFor="reminder-executor-time">提醒时间</FieldLabel>
					<Input
						id="reminder-executor-time"
						type="time"
						aria-label="提醒时间"
						className="h-8 w-28"
						value={executor.time}
						disabled={executorOff}
						onChange={(event) => setExecutor({ time: event.target.value || "09:00" })}
					/>
					<FieldLabel htmlFor="reminder-executor-days">提前</FieldLabel>
					<Input
						id="reminder-executor-days"
						type="number"
						min={1}
						max={MAX_DAYS_BEFORE}
						aria-label="提前天数"
						className="h-8 w-20"
						value={executor.daysBefore}
						disabled={executorOff}
						onChange={(event) =>
							setExecutor({
								daysBefore: Math.min(MAX_DAYS_BEFORE, Math.max(1, Math.floor(Number(event.target.value) || 1))),
							})
						}
					/>
					<span className="text-xs text-muted-foreground">天</span>
				</div>
				<ChannelPicker
					idPrefix="reminder-executor"
					value={executor.channels}
					onChange={(channels) => setExecutor({ channels })}
				/>
				<p className="text-xs text-muted-foreground">{executorSummaryOf(executor)}</p>
				{!executorOff && executor.channels.length === 0 && (
					<p className="text-xs text-destructive">请至少选择一种提醒方式。</p>
				)}
			</div>

			<div className="grid gap-2 border-t border-dashed border-border pt-4">
				<Label className="text-sm">节点处理人未查看提醒</Label>
				<div className="flex flex-wrap items-center gap-2">
					<Select
						value={node.afterMinutes === null ? "" : String(node.afterMinutes)}
						items={NODE_REMINDER_OPTIONS}
						onValueChange={(next) => setNode({ afterMinutes: next ? Number(next) : null })}
					>
						<SelectTrigger className="h-8 w-32" aria-label="未查看时长">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{NODE_REMINDER_OPTIONS.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<span className="text-xs text-muted-foreground">未查看超过这个时长仍没动过 → 提醒一次</span>
				</div>
				<ChannelPicker idPrefix="reminder-node" value={node.channels} onChange={(channels) => setNode({ channels })} />
				<p className="text-xs text-muted-foreground">{nodeSummaryOf(node)}</p>
				{!nodeOff && node.channels.length === 0 && <p className="text-xs text-destructive">请至少选择一种提醒方式。</p>}
			</div>
		</div>
	);
}
