import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import type { FileRow } from "#/components/modules/settings/settings-files-table";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { Badge } from "#/components/ui/badge";
import { Button, buttonVariants } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { useTRPC } from "#/integrations/trpc/react";
import { formatBytes } from "#/lib/format";

const STATUS_LABEL: Record<number, { label: string; variant: "secondary" | "outline" | "destructive" }> = {
	0: { label: "待确认", variant: "outline" },
	1: { label: "正常", variant: "secondary" },
	2: { label: "已删除", variant: "destructive" },
};

/**
 * 文件详情(只读 + 预览 + 重命名入口)。
 *
 * 地址**现签**:列表里只有公开桶给了直链,私有桶到这一步才 `file.url` 签一次(GET 5 分钟)。
 * 展示字段与 `sys_file` 一一对应,不派生。
 */
export function SettingsFilesDetail({
	row,
	open,
	onOpenChange,
	onEdit,
	onDownload,
}: {
	row: FileRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: FileRow) => void;
	/**
	 * 下载:由页面调 `file.url({ id, download: true })` **现签**一个带 `Content-Disposition` 的地址。
	 * 为什么不在这儿直接拼 URL:要下载就必须走预签名(直链带不了响应头),而签名是服务端的事。
	 */
	onDownload: (row: FileRow) => void;
}) {
	const trpc = useTRPC();
	const live = open && row !== null && row.status !== 2;
	const urlQuery = useQuery({ ...trpc.file.url.queryOptions({ id: row?.id ?? "" }), enabled: live });

	const url = urlQuery.data?.url ?? null;
	const isImage = (row?.contentType ?? "").startsWith("image/");
	const status = STATUS_LABEL[row?.status ?? 0] ?? STATUS_LABEL[0];

	return (
		<DetailDialog
			open={open}
			meta={row ? { createdAt: row.createTime, updatedAt: row.updateTime } : null}
			onOpenChange={onOpenChange}
			title={`文件详情 · ${row?.originName ?? ""}`}
			badge={
				row ? (
					<>
						<Badge variant="outline" className="font-mono text-[11px]">
							{row.ext || "无后缀"}
						</Badge>
						<Badge variant={status.variant} className="text-[11px]">
							{status.label}
						</Badge>
					</>
				) : null
			}
			onEdit={() => row && onEdit(row)}
			editLabel="重命名"
			editDisabled={!row || row.status === 2}
			footerExtra={
				<Button disabled={!row || row.status === 2} onClick={() => row && onDownload(row)}>
					下载
				</Button>
			}
		>
			{row ? (
				<>
					{/* 预览块:图片直接看,其余给"打开 / 下载"(私有桶的地址是现签的,不要缓存它) */}
					<div className="space-y-1.5">
						<div className="text-[12px] font-medium text-muted-foreground">预览</div>
						{live && isImage && url ? (
							<img
								src={url}
								alt={row.originName}
								className="max-h-64 w-auto rounded-lg border border-border bg-muted object-contain"
							/>
						) : (
							<div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4">
								<FileText className="size-4 shrink-0 text-muted-foreground" />
								<span className="text-[12.5px] text-muted-foreground">
									{row.status === 2 ? "已删除,对象已清掉" : live && url ? "这个类型没有内联预览" : "正在取地址…"}
								</span>
								{url ? (
									// 用真 `<a>` + `buttonVariants` 的样式,而不是 `Button render={<a/>}`:
									// 后者 biome 判不出锚点内容(`useAnchorContent`),而内容其实在被渲染的元素上
									<a
										href={url}
										target="_blank"
										rel="noreferrer"
										className={buttonVariants({ size: "sm", variant: "outline", className: "ml-auto" })}
									>
										<Download className="size-3.5" />
										打开
									</a>
								) : null}
							</div>
						)}
					</div>

					{/* ⚠️ 创建 / 更新时间**不写在这里**:底部那行(`DetailDialog` 的 `meta`)已经渲染了,
					    再写两个 DetailRow 就是同一件事两个形态(与另外四个详情页不一致 —— 这里踩过) */}
					<div className="flex flex-col gap-0">
						<DetailRow label="ID">
							<span className="font-mono text-[12px]">{row.id}</span>
						</DetailRow>
						<DetailRow label="文件名">{row.originName}</DetailRow>
						<DetailRow label="后缀">{row.ext || "—"}</DetailRow>
						<DetailRow label="类型">
							<span className="font-mono text-[12px]">{row.contentType || "—"}</span>
						</DetailRow>
						<DetailRow label="大小">{formatBytes(row.size)}</DetailRow>
						<DetailRow label="状态">{status.label}</DetailRow>
						<DetailRow label="桶">
							<span className="font-mono text-[12px]">{row.bucket}</span>
						</DetailRow>
						<DetailRow label="对象键">
							<span className="font-mono text-[11.5px] break-all">{row.objectKey}</span>
						</DetailRow>
						<DetailRow label="sha256">
							<span className="font-mono text-[11.5px] break-all">{row.hash || "—"}</span>
						</DetailRow>
					</div>
				</>
			) : null}
		</DetailDialog>
	);
}
