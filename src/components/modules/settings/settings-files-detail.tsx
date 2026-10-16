import { useQuery } from "@tanstack/react-query";
import { SettingsFilePreview } from "#/components/modules/settings/settings-file-preview";
import { type FileRow, STATUS_META } from "#/components/modules/settings/settings-files-table";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { Tag } from "#/components/ui/tag";
import { useTRPC } from "#/integrations/trpc/react";
import { formatBytes } from "#/lib/format";

/**
 * 文件详情(只读 + 预览 + 重命名入口)。
 *
 * 地址**现签**:列表里只有公开桶给了直链,私有桶到这一步才 `file.url` 签一次(GET 5 分钟)。
 * 预览分图片 / PDF / 文本三类,判据与取字节都在 `settings-file-preview.tsx`(PDF 渲染器懒加载)。
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
	const status = STATUS_META[row?.status ?? 0] ?? STATUS_META[0];
	return (
		<DetailDialog
			open={open}
			meta={row ? { createdAt: row.createTime, updatedAt: row.updateTime } : null}
			onOpenChange={onOpenChange}
			title={`文件详情 · ${row?.originName ?? ""}`}
			tag={
				row ? (
					<>
						<Tag variant="outline" className="font-mono text-xs">
							{row.ext || "无后缀"}
						</Tag>
						<Tag variant={status.variant} className="text-xs">
							{status.label}
						</Tag>
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
					{/* 预览块:图片 / PDF / 文本直接看,其余给"打开"(私有桶的地址是现签的,不要缓存它) */}
					<SettingsFilePreview row={row} url={url} />
					{/* ⚠️ 创建 / 更新时间**不写在这里**:底部那行(`DetailDialog` 的 `meta`)已经渲染了,
					    再写两个 DetailRow 就是同一件事两个形态(与另外四个详情页不一致 —— 这里踩过) */}
					<div className="flex flex-col gap-0">
						<DetailRow label="ID">
							<span className="font-mono text-xs">{row.id}</span>
						</DetailRow>
						<DetailRow label="文件名">{row.originName}</DetailRow>
						<DetailRow label="后缀">{row.ext || "—"}</DetailRow>
						<DetailRow label="类型">
							<span className="font-mono text-xs">{row.contentType || "—"}</span>
						</DetailRow>
						<DetailRow label="大小">{formatBytes(row.size)}</DetailRow>
						<DetailRow label="状态">{status.label}</DetailRow>
						<DetailRow label="桶">
							<span className="font-mono text-xs">{row.bucket}</span>
						</DetailRow>
						<DetailRow label="对象键">
							<span className="font-mono text-xs break-all">{row.objectKey}</span>
						</DetailRow>
						<DetailRow label="sha256">
							<span className="font-mono text-xs break-all">{row.hash || "—"}</span>
						</DetailRow>
					</div>
				</>
			) : null}
		</DetailDialog>
	);
}
