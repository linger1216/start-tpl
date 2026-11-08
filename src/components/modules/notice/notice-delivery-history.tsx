import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "#/components/ui/button";
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
import { formatLocalMinute } from "#/lib/time";

const STATUS: Record<string, string> = {
	pending: "等待投递",
	processing: "投递中",
	sent: "已发送",
	failed: "失败",
	cancelled: "已取消",
};

export function NoticeDeliveryHistory({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const trpc = useTRPC();
	const [selected, setSelected] = useState<string | null>(null);
	const history = useQuery(
		trpc.notice.history.queryOptions({ limit: 100 }, { enabled: open, refetchInterval: open ? 10000 : false }),
	);
	const attempts = useQuery(
		trpc.notice.attempts.queryOptions({ id: selected ?? "" }, { enabled: open && selected !== null }),
	);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setSelected(null);
				onOpenChange(next);
			}}
		>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader>
					<DialogTitle>投递记录</DialogTitle>
					<DialogDescription>最近 100 条投递；可展开每次尝试和错误。</DialogDescription>
				</DialogHeader>
				<DialogBody className="grid gap-3">
					{history.isPending ? (
						<p>正在读取…</p>
					) : history.isError ? (
						<p className="text-destructive">读取失败，请重试。</p>
					) : !history.data?.length ? (
						<p className="text-muted-foreground">暂无投递记录。</p>
					) : (
						history.data.map((row) => (
							<div key={row.id} className="grid gap-1 border-b border-border pb-3 text-sm">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium">{row.title}</span>
									<Button variant="ghost" size="sm" onClick={() => setSelected(selected === row.id ? null : row.id)}>
										{selected === row.id ? "收起" : "尝试记录"}
									</Button>
								</div>
								<p className="text-muted-foreground">
									{row.recipientName ?? "已删除用户"} ·{" "}
									{row.channel === "in_app" ? "站内" : row.channel === "sms" ? "短信" : "邮件"} ·{" "}
									{row.status === "pending" && row.error ? "等待重试" : (STATUS[row.status] ?? row.status)} ·{" "}
									{formatLocalMinute(row.createdAt)}
								</p>
								{row.error ? <p className="break-words text-destructive">{row.error}</p> : null}
								{selected === row.id ? (
									attempts.isPending ? (
										<p>正在读取…</p>
									) : attempts.isError ? (
										<p className="text-destructive">读取失败。</p>
									) : !attempts.data?.length ? (
										<p className="text-muted-foreground">暂无外部投递尝试。</p>
									) : (
										<ul className="grid gap-1 pl-3">
											{attempts.data.map((attempt) => (
												<li key={attempt.id}>
													第 {attempt.number} 次 · {STATUS[attempt.status] ?? attempt.status} ·{" "}
													{attempt.provider ?? "未选择服务商"} · {formatLocalMinute(attempt.startedAt)}
													{attempt.error ? <p className="break-words text-destructive">{attempt.error}</p> : null}
												</li>
											))}
										</ul>
									)
								) : null}
							</div>
						))
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
