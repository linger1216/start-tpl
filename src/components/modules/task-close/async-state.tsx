import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { toApiError } from "#/lib/api/error";
import { cn } from "#/lib/utils";

/**
 * 「加载中 / 出错 + 重试 / 空」三态块 —— 之前 5 处各写一遍(重试按钮的 size 已经漂移成 xs/sm 两种)。
 *
 * - 默认(块级):`py-12 text-center`,用于整块区域;
 * - `inline`(行内):一条细边框小条,用于评论区 / 动态流这类嵌在卡片里的列表。
 *
 * `empty` 传了才渲染空态;`children` 是有数据时的内容。
 */
export function AsyncState({
	pending,
	error,
	isFetching,
	onRetry,
	empty,
	inline,
	className,
	children,
}: {
	pending: boolean;
	error?: unknown;
	isFetching?: boolean;
	onRetry?: () => void;
	/** 没有数据时显示的内容(null / undefined = 不判定空态) */
	empty?: ReactNode;
	/** 行内小号(嵌在卡片里的列表用) */
	inline?: boolean;
	className?: string;
	children?: ReactNode;
}) {
	if (error) {
		const message = toApiError(error).message || "加载失败。";
		if (inline)
			return (
				<p
					role="alert"
					className={cn(
						"flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card py-3 pl-12 text-xs text-muted-foreground",
						className,
					)}
				>
					<span>{message}</span>
					{onRetry ? (
						<Button variant="outline" size="xs" disabled={isFetching} onClick={onRetry}>
							{isFetching ? "重试中…" : "重试"}
						</Button>
					) : null}
				</p>
			);
		return (
			<div className={cn("grid justify-items-center gap-3 py-12 text-center text-sm text-muted-foreground", className)}>
				<p>{message}</p>
				{onRetry ? (
					<Button variant="outline" size="sm" disabled={isFetching} onClick={onRetry}>
						{isFetching ? "重试中…" : "重试"}
					</Button>
				) : null}
			</div>
		);
	}
	if (pending)
		return (
			<p className={cn("py-12 text-center text-sm text-muted-foreground", inline && "py-3 text-xs", className)}>
				加载中…
			</p>
		);
	// `empty` 未传 / 传 null 都表示「不判空态」
	if (empty != null) return <>{empty}</>;
	return <>{children}</>;
}
