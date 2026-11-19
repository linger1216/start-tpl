import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";
import { lazy, Suspense, useState } from "react";
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
import { toastApiError } from "#/lib/api/error";
import { formatBytes } from "#/lib/format";
import type { TaskAttachment } from "#/lib/task/payload";

/**
 * 文件预览器走 `React.lazy`:它把 Office / PDF / CAD 等 20 多条渲染链路打包在一起,
 * 静态引入会把整包拖进每个用到本弹窗的页面(和 `settings-file-pdf.tsx` 同一个理由)。
 * Worker / WASM 由 `pnpm file-viewer:assets` 复制到 `public/file-viewer/`,默认基址正好对上。
 */
const FileViewer = lazy(async () => {
	const mod = await import("@file-viewer/react-full");
	// **必须显式指定**:自动探测是拿页面上主脚本的目录推的,dev 下是 `/@vite/client`、生产下是
	// `/assets/`,都会推成站点根 —— Worker / WASM 于是 404,Excel 之类只有主线程兜底甚至直接空白。
	mod.setDefaultFullAssetBaseUrl("/file-viewer/");
	return { default: mod.FileViewer };
});

/**
 * 工具栏只留缩放 / 搜索;下载走底部的「下载」(那样才带原始文件名)。
 * 两个常量固定引用 —— 预览器把 `options` 的新对象当成「换文件」重载。
 */
const LIGHT_OPTIONS = { theme: "light", toolbar: { download: false } } as const;
const DARK_OPTIONS = { theme: "dark", toolbar: { download: false } } as const;

/**
 * 任务附件的预览 / 下载弹窗。
 *
 * 地址**现签**(`taskClose.attachmentUrl`,只放行挂在本任务上的文件),拿到地址后
 * 一律交给 FileViewer 按后缀分流(Office / PDF / 图片 / 文本 / 压缩包……),
 * 不支持的类型它自己给提示,这里再兜一层「新标签打开 / 下载」。
 * 下载走 `download:true` 的预签名地址(带 `Content-Disposition`,按原始文件名存盘)。
 */
function TaskAttachmentPreview({
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
	const urlOptions = (next: { fileId: string; download?: boolean }) =>
		trpc.taskClose.attachmentUrl.queryOptions({ taskId, ...next });

	const urlQuery = useQuery({
		...urlOptions({ fileId }),
		enabled: open && Boolean(attachment),
	});
	const url = urlQuery.data?.url ?? null;
	// 预览器把 `options` 换个对象就当「换文件」重载 —— 只在这两个常量之间选,不做内联字面量
	const viewerOptions =
		typeof document !== "undefined" && document.documentElement.classList.contains("dark")
			? DARK_OPTIONS
			: LIGHT_OPTIONS;

	async function download() {
		if (!attachment) return;
		setDownloading(true);
		try {
			const result = await queryClient.fetchQuery(urlOptions({ fileId: attachment.id, download: true }));
			const anchor = document.createElement("a");
			anchor.href = result.url;
			anchor.rel = "noreferrer";
			anchor.click();
		} catch (error) {
			toastApiError(error);
		} finally {
			setDownloading(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/* 高度**必须定死**:预览器根节点自带 `height:100%`,百分比只能挂到有确定高度的父级上。
			    `max-h` 撑开的父级高度仍是 auto → 预览器塌成 0 高(看着就是"高度不对")。 */}
			<DialogContent className={`${DIALOG_FIT} h-[85vh] sm:max-w-3xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle className="wrap-break-word">{attachment?.name ?? "附件"}</DialogTitle>
					<DialogDescription>
						{attachment && Number.isFinite(attachment.size) ? formatBytes(attachment.size) : ""}
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="min-h-40">
					{!attachment ? null : !url ? (
						<p className="text-sm text-muted-foreground">{urlQuery.isError ? "取不到地址。" : "正在取地址…"}</p>
					) : (
						<Suspense fallback={<p className="text-sm text-muted-foreground">正在加载预览器…</p>}>
							<FileViewer
								key={attachment.id}
								url={url}
								name={attachment.name}
								style={{ height: "100%" }}
								options={viewerOptions}
							/>
						</Suspense>
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

/**
 * 附件预览弹窗的**成套件** —— 状态机 + 弹窗本身,一处给全。
 *
 * 之前只收编了状态机(`value` / `open` / `preview` / `onOpenChange`),弹窗还得每个调用点各写一遍
 * `taskId` / `attachment` / `open` / `onOpenChange` 四个 prop(5 处逐字相同)。现在 hook 直接吐出
 * 可渲染的 `dialog`,调用点只写 `{preview.dialog}`。
 *
 * `taskId` 为空 → 不渲染弹窗(只读预览签不出地址,也没有可点的附件)。
 */
export function useAttachmentPreview<T extends TaskAttachment>(taskId?: string) {
	const [value, setValue] = useState<T | null>(null);
	const open = value !== null;
	const onOpenChange = (next: boolean) => {
		if (!next) setValue(null);
	};
	return {
		/** 正在预览的附件(`null` = 没开) */
		value,
		/** 打开某个附件的预览 */
		preview: (next: T) => setValue(next),
		/** 预览弹窗 —— 直接渲染它 */
		dialog: taskId ? (
			<TaskAttachmentPreview taskId={taskId} attachment={value} open={open} onOpenChange={onOpenChange} />
		) : null,
	};
}
