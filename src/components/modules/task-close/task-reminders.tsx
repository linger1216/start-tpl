import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
const STATUS: Record<string, string> = {
	pending: "等待投递",
	processing: "投递中",
	sent: "已发送",
	failed: "投递失败",
	cancelled: "已取消",
};
type Recipient = { id: string; name: string };

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
	return (
		<>
			<section className="grid gap-2 border-t border-border p-3.5">
				<h2 className="text-base font-semibold">任务提醒</h2>
				{history.isPending ? (
					<p className="text-sm text-muted-foreground">正在读取提醒记录…</p>
				) : history.isError ? (
					<p className="text-sm text-destructive">无法读取提醒记录。</p>
				) : !history.data?.length ? (
					<p className="text-sm text-muted-foreground">暂无提醒记录。</p>
				) : (
					<ul className="grid gap-2">
						{history.data.map((item) => (
							<li key={item.id} className="text-sm">
								<p>
									{item.senderName ?? "系统"} → {item.recipientName ?? "接收人"} ·{" "}
									{CHANNELS.find(([value]) => value === item.channel)?.[1] ?? item.channel} ·{" "}
									{STATUS[item.status] ?? item.status}
								</p>
								<p className="text-xs text-muted-foreground">{formatLocalMinute(item.createdAt)}</p>
								{item.error && <p className="text-xs text-destructive">{item.error}</p>}
							</li>
						))}
					</ul>
				)}
				<p className="text-xs text-muted-foreground">展示最近 200 条提醒事件的投递记录。</p>
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
