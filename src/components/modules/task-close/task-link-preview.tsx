import { ExternalLink } from "lucide-react";
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
import { isInternalUrl } from "#/lib/task-payload";

/**
 * 任务链接的内嵌预览 —— 弹窗里一个 iframe。
 *
 * 只预览「点开就能看」的页面:站内链接同源,一定嵌得进来;站外能不能嵌取决于对方
 * 的 `X-Frame-Options` / `frame-ancestors`,嵌不进来时给一行说明,并保留「新标签打开」。
 * 链接本身仍在 `TaskLinkBlocks` 里可以直接点(站内同页跳转、站外新标签)。
 */
export function TaskLinkPreview({
	url,
	open,
	onOpenChange,
}: {
	url: string | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} h-[85vh] sm:max-w-4xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle>链接预览</DialogTitle>
					<DialogDescription className="truncate font-mono text-xs">{url ?? ""}</DialogDescription>
				</DialogHeader>
				<DialogBody className="min-h-40">
					{url ? (
						<iframe src={url} title={url} className="h-full min-h-40 w-full rounded-md border border-border" />
					) : null}
				</DialogBody>
				<DialogFooter className="gap-2">
					<p className="mr-auto text-xs text-muted-foreground">
						{url && !isInternalUrl(url) ? "站外页面若不允许嵌入会显示空白，改用新标签打开。" : ""}
					</p>
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
