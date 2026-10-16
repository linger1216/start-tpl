import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "#/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { JsonBlock } from "#/components/ui/json-block";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Spinner } from "#/components/ui/spinner";
import { Tag } from "#/components/ui/tag";
import { formatLocalDateTime } from "#/lib/time";

export const Route = createFileRoute("/(main)/demo/tanstack-query")({
	component: TanStackQueryDemo,
});

/** 模拟一次慢请求:模板没有后端,用延时 Promise 演示 query 的生命周期。 */
function fetchServerTime(): Promise<{ now: string; region: string }> {
	return new Promise((resolve) => {
		setTimeout(() => resolve({ now: new Date().toISOString(), region: "local" }), 800);
	});
}

function TanStackQueryDemo() {
	const { data, isPending, isFetching, refetch, dataUpdatedAt } = useQuery({
		queryKey: ["demo", "server-time"],
		queryFn: fetchServerTime,
		// 10 秒内视为新鲜,重复挂载不会重新请求 —— 用来演示缓存命中
		staleTime: 10_000,
	});

	const status = isPending ? "pending" : isFetching ? "fetching" : "success";

	return (
		<div className="mx-auto w-full max-w-3xl px-4 py-8">
			<PageHeader
				title="TanStack Query"
				description="用 useQuery 管理一次异步请求的加载、缓存与刷新状态。"
				actions={<RefreshButton busy={isFetching} onClick={() => void refetch()} />}
			/>

			<Card>
				<CardHeader>
					<CardTitle>请求状态</CardTitle>
					<CardDescription>staleTime 为 10 秒;窗口内重复读取直接命中缓存,不会重新发起请求。</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-wrap items-center gap-2">
						<Tag variant={status === "success" ? "default" : "secondary"}>{status}</Tag>
						{dataUpdatedAt > 0 && (
							<span className="text-sm text-muted-foreground">更新于 {formatLocalDateTime(dataUpdatedAt)}</span>
						)}
					</div>

					{isPending ? <Spinner label="加载中…" /> : <JsonBlock value={data} />}
				</CardContent>
			</Card>
		</div>
	);
}
