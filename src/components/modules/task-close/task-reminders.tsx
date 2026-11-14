import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
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
import { Tag } from "#/components/ui/tag";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { newId } from "#/lib/ids";
import { formatLocalMinute } from "#/lib/time";

const CHANNELS = [
	["in_app", "站内"],
	["email", "邮件"],
	["sms", "短信"],
] as const;
type Channel = (typeof CHANNELS)[number][0];
const channelLabelOf = (channel: string) => CHANNELS.find(([value]) => value === channel)?.[1] ?? channel;
const STATUS: Record<string, string> = {
	pending: "等待投递",
	processing: "投递中",
	sent: "已发送",
	failed: "投递失败",
	cancelled: "已取消",
};
type Recipient = { id: string; name: string };

/**
 * 任务提醒记录 —— **只列真正投递过的**(即时提醒 / 节点催办 / 到点发出去的定时提醒)。
 *
 * 定时提醒的排期(待发 / 已取消)是内部行为,不在页面上展示:没到点的东西列出来,
 * 会让人误以为"已经提醒过了";到点真发出去之后,它就以一条普通投递记录出现在这里。
 */
/**
 * 即将发生的提醒预览(右下角那个图标) —— 排期不在列表里展示,但用户要能预判"接下来会提醒谁、什么时候"。
 *
 * 取数走 `taskReminderPreview`(只给未来待发的,升序,前 5 条 + 总数 + 最后一次)。
 */
function ReminderPlanPreview({ taskId }: { taskId: string }) {
	const trpc = useTRPC();
	const query = useQuery(trpc.taskClose.taskReminderPreview.queryOptions({ taskId }));
	const plan = query.data;
	return (
		<TooltipProvider delay={120}>
			<Tooltip>
				<TooltipTrigger
					aria-label="预览即将发生的提醒"
					className="text-muted-foreground transition-colors hover:text-foreground"
				>
					<CalendarClock className="size-4" />
				</TooltipTrigger>
				<TooltipContent side="top" align="end" className="block max-w-[21rem]">
					{query.isPending ? (
						<span>正在算…</span>
					) : !plan || plan.items.length === 0 ? (
						<span>没有待发的提醒。</span>
					) : (
						<div className="grid gap-0.5 text-left">
							<span className="font-medium">即将发生的提醒(共 {plan.total} 次)</span>
							{plan.items.map((item) => (
								<span key={item.id} className="tabular-nums">
									{formatLocalMinute(item.scheduledAt)} · {item.reminder === "executor" ? "截止提醒" : "未查看提醒"} →{" "}
									{item.recipientName}
								</span>
							))}
							{plan.total > plan.items.length && plan.last ? (
								<span className="text-background/70">…最后一次 {formatLocalMinute(plan.last)}</span>
							) : null}
							<span className="text-background/70">周末与法定节假日不提醒(调休上班日照常)。</span>
						</div>
					)}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

export function TaskReminders({
	taskId,
	recipient,
	onClose,
}: {
	taskId: string;
	recipient: Recipient | null;
	onClose: () => void;
}) {
	const trpc = useTRPC();
	const history = useQuery({ ...trpc.taskClose.reminderHistory.queryOptions({ taskId }), refetchInterval: 15000 });
	const planned = history.data?.planned ?? [];
	const records = history.data?.records ?? [];
	const plannedTotal = history.data?.plannedTotal ?? 0;
	const empty = planned.length === 0 && records.length === 0;
	return (
		<>
			<section className="grid gap-2 border-t border-border p-3.5">
				<div className="flex items-center justify-between gap-2">
					<h2 className="text-base font-semibold">任务提醒</h2>
					<ReminderPlanPreview taskId={taskId} />
				</div>
				{history.isPending ? (
					<p className="text-sm text-muted-foreground">正在读取提醒记录…</p>
				) : history.isError ? (
					<p className="text-sm text-destructive">无法读取提醒记录。</p>
				) : empty ? (
					<p className="text-sm text-muted-foreground">暂无提醒记录。</p>
				) : (
					<ul className="grid gap-2">
						{/* 计划:还没到点的排期(标「计划」,绝不冒充"已送达") */}
						{planned.map((item) => (
							<li key={`p-${item.id}`} className="text-sm">
								<p className="flex flex-wrap items-center gap-1.5">
									<Tag variant="outline">计划</Tag>
									<span>{item.reminder === "executor" ? "截止提醒" : "未查看提醒"}</span>
									<span className="text-muted-foreground">→ {item.recipientName}</span>
									<span className="text-muted-foreground">
										· {item.channels.map((channel) => channelLabelOf(channel)).join("、")}
									</span>
								</p>
								<p className="text-xs text-muted-foreground tabular-nums">{formatLocalMinute(item.scheduledAt)}</p>
							</li>
						))}
						{/* 已送达 / 投递中的记录 */}
						{records.map((item) => (
							<li key={`d-${item.id}`} className="text-sm">
								<p className="flex flex-wrap items-center gap-1.5">
									<Tag
										variant={
											item.status === "sent" ? "secondary" : item.status === "failed" ? "destructive" : "outline"
										}
									>
										{STATUS[item.status] ?? item.status}
									</Tag>
									<span>
										{item.senderName ?? "系统"} → {item.recipientName ?? "接收人"}
									</span>
									<span className="text-muted-foreground">· {channelLabelOf(item.channel)}</span>
								</p>
								<p className="text-xs text-muted-foreground">{formatLocalMinute(item.createdAt)}</p>
								{item.error && <p className="text-xs text-destructive">{item.error}</p>}
							</li>
						))}
					</ul>
				)}
				<p className="text-xs text-muted-foreground">
					{plannedTotal > planned.length
						? `计划 ${plannedTotal} 条,这里只列最近的 ${planned.length} 条(完整计划看右上角预览);下面是最近 200 条投递记录。`
						: "「计划」是还没到点的提醒,到了点真发出去才会变成投递记录。"}
				</p>
			</section>
			{recipient && <ReminderDialog taskId={taskId} recipient={recipient} onClose={onClose} />}
		</>
	);
}

function ReminderDialog({ taskId, recipient, onClose }: { taskId: string; recipient: Recipient; onClose: () => void }) {
	const trpc = useTRPC();
	const client = useQueryClient();
	const [channels, setChannels] = useState<Channel[]>(["in_app"]);
	const [requestId] = useState(() => newId());
	const [submitted, setSubmitted] = useState(false);
	const [result, setResult] = useState<"sent" | "cooldown" | "reused" | null>(null);
	const send = useMutation(
		trpc.taskClose.reminderSend.mutationOptions({
			onSuccess: async (response) => {
				const status = response.results[0]?.status ?? "sent";
				setResult(status);
				if (status === "cooldown") toast.info("该参与人处于 30 分钟冷却期，已跳过提醒。");
				else toast.success("提醒已提交", { description: "投递情况可在提醒记录中查看。" });
				await client.invalidateQueries(trpc.taskClose.reminderHistory.queryFilter({ taskId }));
			},
			onError: toastApiError,
		}),
	);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !send.isPending) onClose();
			}}
		>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader>
					<DialogTitle>提醒 {recipient.name}</DialogTitle>
					<DialogDescription>选择提醒方式。同一收件人在 30 分钟内只接收一次即时提醒。</DialogDescription>
				</DialogHeader>
				<DialogBody className="grid gap-4">
					<fieldset>
						<legend className="mb-2 text-sm font-medium">提醒方式</legend>
						<div className="flex flex-wrap gap-4">
							{CHANNELS.map(([channel, label]) => (
								<label key={channel} htmlFor={`instant-${channel}`} className="flex items-center gap-2 text-sm">
									<Checkbox
										id={`instant-${channel}`}
										disabled={submitted || send.isPending}
										checked={channels.includes(channel)}
										onCheckedChange={(checked) =>
											setChannels((current) =>
												checked ? [...current, channel] : current.filter((item) => item !== channel),
											)
										}
									/>
									{label}
								</label>
							))}
						</div>
					</fieldset>
					{result && (
						<p className="text-sm">
							{result === "cooldown" ? "冷却中，已跳过" : result === "reused" ? "已提交过" : "已提交"}
						</p>
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" disabled={send.isPending} onClick={onClose}>
						{result ? "关闭" : "取消"}
					</Button>
					<Button
						disabled={result !== null || send.isPending || !channels.length}
						onClick={() => {
							setSubmitted(true);
							send.mutate({ taskId, recipientIds: [recipient.id], channels, requestId });
						}}
					>
						{result ? "已提交" : send.isPending ? "发送中…" : submitted ? "重试发送" : "发送提醒"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
