import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useTRPC } from "#/integrations/trpc/react";
import { noticeLevelStyle } from "#/lib/notice-levels";
import { formatLocalMinute } from "#/lib/time";
import { useNoticeSse } from "#/lib/use-notice-sse";

/**
 * 顶栏通知铃铛 —— 未读数 + 点开看最近 10 条 + **点一条就标记已读并跳到它指的页面**。
 *
 * 三条刻意的精简:
 *  · **不做独立通知页**:面板里就是全部(最近 10 条),要更多再加;
 *  · **一次请求拿列表和未读数**(`notice.list` 同时返回两样),铃铛不需要两个往返;
 *  · **点击先标已读再跳**,所以数字立刻减 1;`path` 失效时给一句提示而不是白屏。
 *
 * 形态与右端的用户菜单**同一个组件、同一个 `align="end"`** —— 顶栏的两个下拉天然同形;
 * 触发器用 `render={<Button/>}` 复用标准按钮样式(`user-switcher` 同款写法)。
 */

export function NotificationBell() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [open, setOpen] = useState(false);

	// 60 秒轮询就够:这是站内通知,不是聊天(真需要实时再上 SSE)
	const listQuery = useQuery({ ...trpc.notice.list.queryOptions(), refetchInterval: 60_000 });

	// 订阅 SSE:有新通知就直接 invalidate 缓存,轮询周期里也能秒级收到。
	useNoticeSse();

	const readMutation = useMutation(
		trpc.notice.read.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.notice.pathFilter());
			},
		}),
	);
	const readAllMutation = useMutation(
		trpc.notice.readAll.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.notice.pathFilter());
				if (outcome.updated > 0) toast.success(`已把 ${outcome.updated} 条标为已读`);
			},
		}),
	);

	const items = listQuery.data?.items ?? [];
	const unread = listQuery.data?.unread ?? 0;
	const pending = readMutation.isPending || readAllMutation.isPending;

	/** 点一条:先标已读,再按 `path` 跳转(没有 path 的就只标已读) */
	async function handleClick(item: (typeof items)[number]) {
		setOpen(false);
		if (!item.read) await readMutation.mutateAsync({ id: item.id }).catch(() => {});
		if (!item.path) return;
		try {
			await router.navigate({ to: item.path as never });
		} catch {
			// `path` 是可以被数据携带的:校验在写入时就做了,这里只是兜底,别白屏
			toast.error("这条通知的跳转地址已失效", { description: item.path });
		}
	}

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger
				render={<Button variant="ghost" size="icon" aria-label="通知" title="通知" className="relative size-8" />}
			>
				<Bell className="size-4" />
				{unread > 0 ? (
					// 未读用**品牌色**而不是告警红:未读不是告警(告警语义只留给 success/warn/danger)
					<span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs leading-none font-medium text-primary-foreground tabular-nums">
						{unread > 9 ? "9+" : unread}
					</span>
				) : null}
			</DropdownMenuTrigger>

			<DropdownMenuContent align="end" className="w-80 p-0">
				<div className="flex items-center justify-between border-b border-border px-3 py-2">
					<span className="text-sm font-medium text-foreground">通知</span>
					{/* ⚠️ **常驻**:以前只在有未读时渲染,结果"全部已读"会突然消失 —— 用户以为没这个功能(实测反馈) */}
					<ActionButton disabled={pending || unread === 0} onClick={() => readAllMutation.mutate()}>
						全部已读
					</ActionButton>
				</div>

				{items.length === 0 ? (
					<div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无通知</div>
				) : (
					<div className="max-h-[60vh] overflow-auto py-1">
						{items.map((item) => {
							const { Icon, tone } = noticeLevelStyle(item.level);
							return (
								<DropdownMenuItem
									key={item.id}
									onClick={() => void handleClick(item)}
									className="flex cursor-pointer items-start gap-2.5 px-3 py-2"
								>
									{/* 未读左侧一根品牌色竖条;已读留同样宽度的空位,免得两行文字不齐 */}
									<span
										className={
											item.read
												? "w-0.5 shrink-0 rounded-full bg-transparent"
												: "w-0.5 shrink-0 rounded-full bg-primary"
										}
									/>
									<Icon className={`mt-0.5 size-3.5 shrink-0 ${tone}`} />
									<span className="min-w-0 flex-1">
										<span
											className={
												item.read
													? "block truncate text-xs text-muted-foreground"
													: "block truncate text-xs font-medium text-foreground"
											}
										>
											{item.title}
										</span>
										{item.body ? (
											<span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.body}</span>
										) : null}
										<span className="mt-0.5 block text-xs text-muted-foreground/70 tabular-nums">
											{formatLocalMinute(item.createTime)}
											{item.path ? " · 点击跳转" : ""}
										</span>
									</span>
								</DropdownMenuItem>
							);
						})}
					</div>
				)}

				<DropdownMenuSeparator className="my-0" />
				<div className="px-3 py-1.5 text-xs text-muted-foreground/70">只显示最近 10 条</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
