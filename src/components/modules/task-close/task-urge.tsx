import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
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
import { TASK_URGE_COOLDOWN_MINUTES } from "#/lib/task/close-spec";
import { formatLocalMinute } from "#/lib/time";

type Action = { id: string; assigneeName: string | null; lastUrgedAt: string | null };
type Channel = "sms" | "email";
const STATUS: Record<string, string> = {
	pending: "等待投递",
	processing: "投递中",
	sent: "已发送",
	failed: "投递失败",
	cancelled: "已取消",
};

/** 催办选择和投递记录共用同一动作入口。 */
export function TaskUrge({ actions }: { actions: readonly Action[] }) {
	const trpc = useTRPC();
	const client = useQueryClient();
	const [selected, setSelected] = useState<Action | null>(null);
	const [channels, setChannels] = useState<Channel[]>(["email"]);
	const [requestId, setRequestId] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const [withdrawing, setWithdrawing] = useState<Action | null>(null);
	const history = useQuery(
		trpc.taskClose.actionUrgeHistory.queryOptions(
			{ id: selected?.id ?? "" },
			{
				enabled: selected !== null,
				refetchInterval: selected ? 5000 : false,
			},
		),
	);
	const send = useMutation(
		trpc.taskClose.actionUrge.mutationOptions({
			onSuccess: async () => {
				setSubmitted(true);
				toast.success("催办已加入投递队列", { description: "实际发送结果见下方投递记录。" });
				await Promise.all([client.invalidateQueries(trpc.taskClose.pathFilter()), history.refetch()]);
			},
			onError: toastApiError,
		}),
	);
	const withdraw = useMutation(
		trpc.taskClose.actionWithdraw.mutationOptions({
			onSuccess: async () => {
				setWithdrawing(null);
				await client.invalidateQueries(trpc.taskClose.pathFilter());
				toast.success("动作已撤回");
			},
			onError: toastApiError,
		}),
	);
	if (!actions.length) return null;
	function toggle(channel: Channel, checked: boolean) {
		setChannels((current) =>
			checked ? [...new Set([...current, channel])] : current.filter((item) => item !== channel),
		);
	}
	return (
		<>
			<section className="grid gap-2 border-t border-border p-3.5">
				<h2 className="text-base font-semibold text-foreground">待处理动作</h2>
				<ul className="grid gap-2">
					{actions.map((action) => (
						<li key={action.id} className="flex items-center justify-between gap-2 text-sm">
							<span className="truncate">{action.assigneeName ?? "处理人"}</span>
							<div className="flex items-center gap-3">
								<ActionButton
									onClick={() => {
										setSelected(action);
										setChannels(["email"]);
										setRequestId(newId());
										setSubmitted(false);
									}}
								>
									催办
								</ActionButton>
								<ActionButton tone="danger" onClick={() => setWithdrawing(action)}>
									撤回
								</ActionButton>
							</div>
						</li>
					))}
				</ul>
			</section>
			<Dialog
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open && !send.isPending) setSelected(null);
				}}
			>
				<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
					<DialogHeader>
						<DialogTitle>催办 {selected?.assigneeName ?? "处理人"}</DialogTitle>
						<DialogDescription>
							选择投递渠道；同一动作每 {TASK_URGE_COOLDOWN_MINUTES} 分钟最多催办一次。
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="grid gap-4">
						<fieldset className="grid gap-3">
							<legend className="mb-2 text-sm font-medium">投递渠道</legend>
							{(
								[
									["email", "邮件"],
									["sms", "短信"],
								] as const
							).map(([channel, label]) => (
								<label key={channel} htmlFor={`urge-${channel}`} className="flex items-center gap-2 text-sm">
									<Checkbox
										id={`urge-${channel}`}
										checked={channels.includes(channel)}
										onCheckedChange={(checked) => toggle(channel, checked)}
										disabled={submitted || send.isPending}
									/>
									{label}
								</label>
							))}
						</fieldset>
						{selected?.lastUrgedAt ? (
							<p className="text-sm text-muted-foreground">上次催办：{formatLocalMinute(selected.lastUrgedAt)}</p>
						) : null}
						<div className="grid gap-2">
							<h3 className="text-sm font-medium">投递记录</h3>
							{history.isPending ? (
								<p className="text-sm text-muted-foreground">正在读取…</p>
							) : history.isError ? (
								<p className="text-sm text-destructive">无法读取投递记录，请重试。</p>
							) : !history.data?.length ? (
								<p className="text-sm text-muted-foreground">暂无催办记录。</p>
							) : (
								<ul className="grid gap-2">
									{history.data.map((item) => (
										<li key={item.id} className="text-sm">
											<span>
												{item.channel === "sms" ? "短信" : "邮件"} ·{" "}
												{item.status === "pending" && item.error ? "等待重试" : (STATUS[item.status] ?? item.status)} ·{" "}
												{formatLocalMinute(item.createdAt)}
											</span>
											{item.error ? <p className="text-destructive">{item.error}</p> : null}
										</li>
									))}
								</ul>
							)}
						</div>
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" disabled={send.isPending} onClick={() => setSelected(null)}>
							关闭
						</Button>
						<Button
							disabled={submitted || send.isPending || !channels.length}
							onClick={() => {
								if (selected) send.mutate({ id: selected.id, requestId, channels });
							}}
						>
							{submitted ? "已提交" : send.isPending ? "提交中…" : "发送催办"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={withdrawing !== null}
				onOpenChange={(open) => {
					if (!open) setWithdrawing(null);
				}}
				title="撤回动作"
				description="撤回后动作不能继续答复，尚未发送的催办将取消。"
				isPending={withdraw.isPending}
				onConfirm={() => {
					if (withdrawing) withdraw.mutate({ id: withdrawing.id });
				}}
			/>
		</>
	);
}
