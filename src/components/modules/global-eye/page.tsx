import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Video } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "#/components/layout/empty-state";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { GlobalEyePlayer } from "#/components/modules/global-eye/player";
import { findGlobalEyeNode, GlobalEyeTree, type GlobalEyeTreeNode } from "#/components/modules/global-eye/tree";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { DetailRow } from "#/components/ui/detail-row";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Spinner } from "#/components/ui/spinner";
import { Tag } from "#/components/ui/tag";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError, toastApiError } from "#/lib/api/error";

/** 常见字段的中文名;没登记的字段直接显示原始 key */
const FIELD_LABELS: Record<string, string> = {
	channelName: "通道名称",
	name: "名称",
	channelId: "通道 ID",
	isOnline: "在线状态",
	status: "状态",
	gbId: "国标编号",
	channelType: "通道类型",
	ptzType: "云台类型",
	orgName: "所属组织",
	orgCode: "组织编码",
	deviceName: "所属设备",
	deviceCode: "设备编码",
	deviceId: "设备 ID",
	address: "安装地址",
	longitude: "经度",
	latitude: "纬度",
	nodeType: "节点类型",
	parentId: "上级 ID",
	id: "ID",
	createTime: "创建时间",
	updateTime: "更新时间",
};

/** 展示顺序:重要的在前,其余按平台原顺序 */
const FIELD_ORDER = [
	"channelName",
	"name",
	"channelId",
	"isOnline",
	"status",
	"gbId",
	"channelType",
	"ptzType",
	"orgName",
	"orgCode",
	"deviceName",
	"deviceCode",
	"deviceId",
	"address",
	"longitude",
	"latitude",
	"nodeType",
	"parentId",
	"id",
	"createTime",
	"updateTime",
];

const KIND_LABEL = { org: "组织", device: "设备", channel: "通道" } as const;

/** 取有内容的字段,按展示顺序排好 */
function describeFields(raw: Record<string, unknown>) {
	const keys = Object.keys(raw);
	const ordered = [...FIELD_ORDER.filter((key) => key in raw), ...keys.filter((key) => !FIELD_ORDER.includes(key))];
	return ordered
		.filter((key) => {
			const value = raw[key];
			if (value === null || value === undefined || value === "") return false;
			if (Array.isArray(value) && value.length === 0) return false;
			if (typeof value === "object" && value && Object.keys(value).length === 0) return false;
			return true;
		})
		.map((key) => ({ key, label: FIELD_LABELS[key] ?? key, value: raw[key] }));
}

function FieldValue({ name, value }: { name: string; value: unknown }) {
	if (name === "isOnline") {
		const online = value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
		return online ? (
			<Tag className="border-transparent bg-hue-teal-soft text-hue-teal-fg">在线</Tag>
		) : (
			<Tag variant="outline" className="text-muted-foreground">
				离线
			</Tag>
		);
	}
	if (typeof value === "boolean") return <>{value ? "是" : "否"}</>;
	if (typeof value === "object") return <span className="break-all font-mono text-xs">{JSON.stringify(value)}</span>;
	const text = String(value);
	return <span className={/(id|code)$/i.test(name) ? "break-all font-mono text-xs" : "break-all"}>{text}</span>;
}

/**
 * 全球眼视频 —— 左侧通道树,点通道后右侧看信息并播放(HLS 直连)。
 * 树重建很慢,服务端有缓存;页头「刷新」会绕过缓存并重新登录。
 */
export function GlobalEyeVideoPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const treeQuery = useQuery(trpc.globalEye.channelTree.queryOptions({}, { retry: 1, staleTime: 30_000 }));
	const tree = useMemo<GlobalEyeTreeNode[]>(() => treeQuery.data ?? [], [treeQuery.data]);

	const [refreshing, setRefreshing] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [playing, setPlaying] = useState(false);
	const selected = selectedId ? findGlobalEyeNode(tree, selectedId) : null;
	const isChannel = selected?.kind === "channel";
	const fields = useMemo(() => (selected ? describeFields(selected.raw) : []), [selected]);

	const streamQuery = useQuery(
		trpc.globalEye.streamUrl.queryOptions(
			{ channelId: selected?.id ?? "" },
			{ enabled: playing && isChannel, retry: 1 },
		),
	);

	async function refresh() {
		setRefreshing(true);
		try {
			const data = await queryClient.fetchQuery(trpc.globalEye.channelTree.queryOptions({ refresh: true }));
			queryClient.setQueryData(trpc.globalEye.channelTree.queryOptions({}).queryKey, data);
		} catch (error) {
			toastApiError(error);
		} finally {
			setRefreshing(false);
		}
	}

	return (
		<PageFrame>
			<PageHeader
				title="全球眼视频"
				description="左侧是视频通道树(组织 → 设备 → 通道);点一个通道在右侧看信息并播放。"
				actions={<RefreshButton busy={refreshing} onClick={() => void refresh()} />}
			/>

			<div className="grid min-h-96 flex-1 gap-4 lg:grid-cols-[30rem_minmax(0,1fr)]">
				<Card className="flex min-h-0 flex-col gap-3">
					<CardHeader className="flex-row items-center justify-between gap-2">
						<CardTitle className="flex items-center gap-2">
							<Video className="size-4 text-muted-foreground" />
							通道树
						</CardTitle>
					</CardHeader>
					<CardContent className="flex min-h-0 flex-1 flex-col gap-2">
						{treeQuery.isPending ? (
							<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
								<Spinner size="lg" />
								<p className="text-xs text-muted-foreground">正在加载通道树…(首次较慢,请稍候)</p>
							</div>
						) : treeQuery.isError ? (
							<div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-4">
								<p className="text-sm text-destructive">{toApiError(treeQuery.error).message}</p>
								<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
									强制刷新
								</Button>
							</div>
						) : (
							<GlobalEyeTree
								nodes={tree}
								selectedId={selectedId}
								onSelect={(node) => {
									setSelectedId(node.id);
									setPlaying(false);
								}}
							/>
						)}
					</CardContent>
				</Card>

				<Card className="flex min-h-0 flex-col">
					<CardHeader className="flex-row items-center justify-between gap-3 border-b border-border">
						<div className="min-w-0">
							<CardTitle className="truncate text-base">{selected ? selected.name : "通道信息"}</CardTitle>
							<p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
								{selected ? `${KIND_LABEL[selected.kind]} · ${selected.id}` : "从左侧选择一个通道"}
							</p>
						</div>
						{isChannel ? (
							<div className="flex shrink-0 items-center gap-2">
								{selected?.online ? (
									<Tag className="border-transparent bg-hue-teal-soft text-hue-teal-fg">在线</Tag>
								) : (
									<Tag variant="outline" className="text-muted-foreground">
										离线
									</Tag>
								)}
								{playing ? (
									<Button variant="outline" size="sm" onClick={() => setPlaying(false)}>
										停止
									</Button>
								) : (
									<Button size="sm" onClick={() => setPlaying(true)}>
										<Play className="size-3.5" />
										播放
									</Button>
								)}
							</div>
						) : null}
					</CardHeader>

					<CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-4">
						{playing && isChannel ? (
							<div className="aspect-video shrink-0 overflow-hidden rounded-lg border border-border bg-black">
								{streamQuery.isPending ? (
									<div className="grid h-full place-items-center text-sm text-muted-foreground">正在取流…</div>
								) : streamQuery.isError ? (
									<div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
										<p className="text-sm text-destructive">{toApiError(streamQuery.error).message}</p>
										<Button size="sm" variant="outline" onClick={() => void streamQuery.refetch()}>
											重试
										</Button>
									</div>
								) : streamQuery.data ? (
									<GlobalEyePlayer
										url={streamQuery.data.url}
										httpPlayerUrl={streamQuery.data.httpPlayerUrl}
										onRetry={() => void streamQuery.refetch()}
									/>
								) : null}
							</div>
						) : null}

						{selected ? (
							<div className="overflow-hidden rounded-lg border border-border">
								{fields.map((field, index) => (
									<DetailRow
										key={field.key}
										label={field.label}
										className={index > 0 ? "border-t border-border px-3" : "px-3"}
									>
										<FieldValue name={field.key} value={field.value} />
									</DetailRow>
								))}
							</div>
						) : (
							<EmptyState
								bare
								icon={<Video className="size-5" />}
								title="选择一个通道"
								description="在左侧展开组织与设备,点一个通道即可查看信息并播放。"
							/>
						)}
					</CardContent>
				</Card>
			</div>
		</PageFrame>
	);
}
