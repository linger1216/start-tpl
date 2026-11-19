import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { lazy, Suspense } from "react";
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

const FileViewer = lazy(async () => {
	const mod = await import("@file-viewer/react-full");
	mod.setDefaultFullAssetBaseUrl("/file-viewer/");
	return { default: mod.FileViewer };
});

const LIGHT_OPTIONS = { theme: "light", toolbar: { download: false } } as const;
const DARK_OPTIONS = { theme: "dark", toolbar: { download: false } } as const;

/** Excel 模板上传后的在线预览；复用项目文件预览器的 XLSX 渲染链路。 */
export function TaskReportExcelTemplatePreview({
	fileId,
	fileName,
	open,
	onOpenChange,
}: {
	fileId: string;
	fileName: string;
	open: boolean;
	onOpenChange: (next: boolean) => void;
}) {
	const trpc = useTRPC();
	const urlQuery = useQuery({
		...trpc.file.url.queryOptions({ id: fileId }),
		enabled: open && Boolean(fileId),
	});
	const url = urlQuery.data?.url ?? null;
	const previewName = urlQuery.data?.originName ?? fileName;
	const viewerOptions =
		typeof document !== "undefined" && document.documentElement.classList.contains("dark")
			? DARK_OPTIONS
			: LIGHT_OPTIONS;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} h-[85vh] sm:max-w-3xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle className="wrap-break-word">{fileName}</DialogTitle>
					<DialogDescription>Excel 工作簿模板预览</DialogDescription>
				</DialogHeader>
				<DialogBody className="min-h-40">
					{!url ? (
						<p className="text-sm text-muted-foreground">
							{urlQuery.isError ? "无法获取文件预览地址。" : "正在加载预览…"}
						</p>
					) : (
						<Suspense fallback={<p className="text-sm text-muted-foreground">正在加载预览器…</p>}>
							<FileViewer
								key={fileId}
								url={url}
								name={previewName}
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
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
