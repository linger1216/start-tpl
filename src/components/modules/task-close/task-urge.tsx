import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
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
import { formatLocalMinute } from "#/lib/time";

type Action = { id: string; assigneeName: string | null; lastUrgedAt: string | null; status: string };
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
	return (
		<>
			<section className="grid gap-2 border-t border-border p-3.5">
				<h2 className="text-base font-semibold text-foreground">动作记录</h2>
				<ul className="grid gap-2">
					{actions.map((action) => (
						<li key={action.id} className="flex items-center justify-between gap-2 text-sm">
							<span className="truncate">{action.assigneeName ?? "处理人"}</span>
							<div className="flex items-center gap-3">
								<ActionButton
									onClick={() => {
										setSelected(action);
									}}
								>
									历史催办
								</ActionButton>
								{action.status === "active" && (
									<ActionButton tone="danger" onClick={() => setWithdrawing(action)}>
										撤回
									</ActionButton>
								)}
							</div>
						</li>
					))}
				</ul>
			</section>
			<Dialog
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
			>
				<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
					<DialogHeader>
						<DialogTitle>历史催办 · {selected?.assigneeName ?? "处理人"}</DialogTitle>
						<DialogDescription>查看该动作的历史催办记录。</DialogDescription>
					</DialogHeader>
					<DialogBody className="grid gap-4">
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
											{item.error ? <p className="text-destructive">投递未成功，请查看任务提醒记录。</p> : null}
										</li>
									))}
								</ul>
							)}
						</div>
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" onClick={() => setSelected(null)}>
							关闭
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
