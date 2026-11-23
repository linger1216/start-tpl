import { useQuery } from "@tanstack/react-query";
import { Play, Video } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "#/components/layout/empty-state";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { HlsPlayer } from "#/components/modules/global-eye/player";
import { findGlobalEyeNode, GlobalEyeTree, type GlobalEyeTreeNode } from "#/components/modules/global-eye/tree";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { DetailRow } from "#/components/ui/detail-row";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Tag } from "#/components/ui/tag";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";

/** 常见字段的中文名;没登记的字段直接显示原始 key(展示"全部信息") */
const FIELD_LABELS: Record<string, string> = {
	id: "ID",
	channelId: "通道 ID",
	channelName: "通道名称",
	name: "名称",
	gbId: "国标编号",
	nodeType: "节点类型",
	orgCode: "所属组织",
	orgName: "所属组织名称",
	deviceCode: "设备编码",
	deviceName: "设备名称",
	deviceId: "设备 ID",
	parentId: "上级 ID",
	isOnline: "在线状态",
	status: "状态",
	address: "地址",
	longitude: "经度",
	latitude: "纬度",
	ptzType: "云台类型",
	channelType: "通道类型",
	createTime: "创建时间",
	updateTime: "更新时间",
};

function formatValue(key: string, value: unknown): string {
	if (key === "isOnline") return value ? "在线" : "离线";
	if (value === null || value === undefined || value === "") return "—";
	if (typeof value === "boolean") return value ? "是" : "否";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/**
 * 全球眼视频 —— 左侧通道树 + 右侧通道信息 / 实时预览。
 *
 * 数据(通道树 / 播放地址)全部来自服务端 `globalEye` 路由;凭据只在服务端使用,
 * 浏览器拿到的只有组织 / 通道的字段与最终播放地址。
 */
export function GlobalEyeVideoPage() {
	const trpc = useTRPC();
	const treeQuery = useQuery(trpc.globalEye.channelTree.queryOptions());
	const tree = useMemo<GlobalEyeTreeNode[]>(() => treeQuery.data?.tree ?? [], [treeQuery.data]);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [playing, setPlaying] = useState(false);
	const selected = selectedId ? findGlobalEyeNode(tree, selectedId) : null;
	const isChannel = selected?.kind === "channel";

	const streamQuery = useQuery(
		trpc.globalEye.streamUrl.queryOptions(
			{ channelId: selected?.id ?? "" },
			{ enabled: playing && isChannel && selected !== null },
		),
	);

	function selectNode(node: GlobalEyeTreeNode) {
		setSelectedId(node.id);
		setPlaying(false);
	}

	return (
		<PageFrame>
			<PageHeader
				title="全球眼视频"
				description="左侧是视频通道树(组织 → 设备 → 通道);点一个通道在右侧看全部信息并实时预览。"
				actions={<RefreshButton busy={treeQuery.isFetching} onClick={() => void treeQuery.refetch()} />}
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
						{treeQuery.isError ? (
							<p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-4 text-sm text-destructive">
								{toApiError(treeQuery.error).message}
							</p>
						) : (
							<GlobalEyeTree nodes={tree} selectedId={selectedId} onSelect={selectNode} />
						)}
					</CardContent>
				</Card>

				<Card className="flex min-h-0 flex-col">
					<CardHeader className="flex-row items-center justify-between gap-2">
						<CardTitle className="text-sm">{selected ? selected.name : "通道信息"}</CardTitle>
						{selected ? (
							<div className="flex items-center gap-2">
								{isChannel ? (
									selected.online ? (
										<Tag className="border-transparent bg-hue-teal-soft text-hue-teal-fg">在线</Tag>
									) : (
										<Tag variant="outline" className="text-muted-foreground">
											离线
										</Tag>
									)
								) : null}
								{isChannel ? (
									playing ? (
										<Button variant="outline" size="sm" onClick={() => setPlaying(false)}>
											停止
										</Button>
									) : (
										<Button size="sm" onClick={() => setPlaying(true)}>
											<Play className="size-3.5" />
											播放
										</Button>
									)
								) : null}
							</div>
						) : null}
					</CardHeader>
					<CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
						{playing && isChannel ? (
							<div className="aspect-video shrink-0 overflow-hidden rounded-lg bg-black">
								{streamQuery.isPending ? (
									<div className="grid h-full place-items-center text-sm text-muted-foreground">正在取流…</div>
								) : streamQuery.isError ? (
									<div className="grid h-full place-items-center px-4 text-center text-sm text-destructive">
										{toApiError(streamQuery.error).message}
									</div>
								) : streamQuery.data ? (
									<HlsPlayer url={streamQuery.data.url} />
								) : null}
							</div>
						) : null}

						{selected ? (
							<div>
								{Object.entries(selected.raw).map(([key, value]) => (
									<DetailRow key={key} label={FIELD_LABELS[key] ?? key}>
										{formatValue(key, value)}
									</DetailRow>
								))}
								{Object.keys(selected.raw).length === 0 ? (
									<p className="text-sm text-muted-foreground">该节点没有可展示的字段。</p>
								) : null}
							</div>
						) : (
							<EmptyState
								bare
								icon={<Video className="size-5" />}
								title="选择一个通道"
								description="在左侧展开组织与设备,点一个通道即可查看它的全部信息并播放。"
							/>
						)}
					</CardContent>
				</Card>
			</div>
		</PageFrame>
	);
}
