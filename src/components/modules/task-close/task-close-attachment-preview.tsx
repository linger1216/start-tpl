import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "#/components/ui/button";
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
import { toApiError } from "#/lib/api/error";
import { filePreviewKind, TEXT_PREVIEW_MAX_BYTES } from "#/lib/file-preview";
import { formatBytes } from "#/lib/format";
import type { TaskAttachment } from "#/lib/task-content";

/** 从文件名取小写后缀 */
function extOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * 任务附件的预览 / 下载弹窗。
 *
 * 地址**现签**(`taskClose.attachmentUrl`,只放行挂在本任务上的文件):图片直接 `<img>`、PDF 用 `<iframe>`
 * 交给浏览器内置预览、文本 `fetch` 后按上限截断展示,其余类型给「新标签打开 / 下载」兜底。
 * 下载走 `download:true` 的预签名地址(带 `Content-Disposition`,按原始文件名存盘)。
 */
export function TaskAttachmentPreview({
	taskId,
	attachment,
	open,
	onOpenChange,
}: {
	taskId: string;
	attachment: TaskAttachment | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [downloading, setDownloading] = useState(false);
	const fileId = attachment?.id ?? "";

	const urlQuery = useQuery({
		...trpc.taskClose.attachmentUrl.queryOptions({ taskId, fileId }),
		enabled: open && Boolean(attachment),
	});
	const url = urlQuery.data?.url ?? null;
	const kind = attachment
		? filePreviewKind({ contentType: attachment.contentType, ext: extOf(attachment.name) })
		: "none";

	async function download() {
		if (!attachment) return;
		setDownloading(true);
		try {
			const result = await queryClient.fetchQuery(
				trpc.taskClose.attachmentUrl.queryOptions({ taskId, fileId: attachment.id, download: true }),
			);
			const anchor = document.createElement("a");
			anchor.href = result.url;
			anchor.rel = "noreferrer";
			anchor.click();
		} catch (error) {
			toast.error(toApiError(error).message);
		} finally {
			setDownloading(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-3xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle className="wrap-break-word">{attachment?.name ?? "附件"}</DialogTitle>
					<DialogDescription>
						{attachment && Number.isFinite(attachment.size) ? formatBytes(attachment.size) : ""}
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="min-h-40">
					{!attachment ? null : !url ? (
						<p className="text-sm text-muted-foreground">{urlQuery.isError ? "取不到地址。" : "正在取地址…"}</p>
					) : kind === "image" ? (
						<img
							src={url}
							alt={attachment.name}
							className="mx-auto max-h-[70vh] w-auto rounded-lg border border-border object-contain"
						/>
					) : kind === "pdf" ? (
						<iframe src={url} title={attachment.name} className="h-[70vh] w-full rounded-lg border border-border" />
					) : kind === "text" ? (
						<TextPreview url={url} />
					) : (
						<p className="text-sm text-muted-foreground">这个类型不支持内联预览 —— 点「新标签打开」或「下载」。</p>
					)}
				</DialogBody>
				<DialogFooter className="gap-2">
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
					{url ? (
						<a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
							<ExternalLink className="size-3.5" />
							新标签打开
						</a>
					) : null}
					<Button disabled={downloading || !attachment} onClick={() => void download()}>
						<Download className="size-3.5" />
						{downloading ? "准备中…" : "下载"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type TextState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; text: string; truncated: boolean };

/** 文本预览:浏览器直取字节(与文件管理页同一套路),按 `TEXT_PREVIEW_MAX_BYTES` 截断 */
function TextPreview({ url }: { url: string }) {
	const [state, setState] = useState<TextState>({ status: "loading" });

	useEffect(() => {
		const abort = new AbortController();
		setState({ status: "loading" });
		void (async () => {
			try {
				const response = await fetch(url, { signal: abort.signal });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const buffer = await response.arrayBuffer();
				const truncated = buffer.byteLength > TEXT_PREVIEW_MAX_BYTES;
				setState({
					status: "ready",
					text: new TextDecoder("utf-8").decode(truncated ? buffer.slice(0, TEXT_PREVIEW_MAX_BYTES - 3) : buffer),
					truncated,
				});
			} catch (error) {
				if (abort.signal.aborted) return;
				setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
			}
		})();
		return () => abort.abort();
	}, [url]);

	if (state.status === "loading") return <p className="text-sm text-muted-foreground">正在取内容…</p>;
	if (state.status === "error") {
		return <p className="text-sm text-destructive">取不到内容({state.message}),点「下载」或「新标签打开」。</p>;
	}
	return (
		<div className="space-y-1.5">
			<pre className="code-block max-h-[70vh] overflow-auto rounded-lg bg-muted/40 p-3 break-words text-xs">
				{state.text}
			</pre>
			{state.truncated ? (
				<div className="text-xs text-muted-foreground">
					只显示前 {formatBytes(TEXT_PREVIEW_MAX_BYTES)},完整内容点「下载」
				</div>
			) : null}
		</div>
	);
}
