import { ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "#/components/ui/button";
import { isInternalUrl } from "#/lib/task-payload";

/**
 * 任务链接的内嵌预览 —— **直接铺在链接下方**(不再弹窗):一个 iframe。
 *
 * 只预览「点开就能看」的页面:站内链接同源,一定嵌得进来;站外能不能嵌取决于对方
 * 的 `X-Frame-Options` / `frame-ancestors`,嵌不进来时给一行说明,并保留「新标签打开」。
 * 链接本身仍在 `TaskLinkBlocks` 里可以直接点(站内同页跳转、站外新标签)。
 *
 * 高度:固定一屏多一点(`60vh`),**iframe 内部自己滚** —— 页面本身不出滚动条。
 */
export function TaskLinkPreview({ url, onClose }: { url: string; onClose: () => void }) {
	return (
		<div className="grid gap-2 rounded-lg border border-border bg-card p-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{url}</span>
				{!isInternalUrl(url) ? (
					<span className="text-xs text-muted-foreground">站外页面若不允许嵌入会显示空白</span>
				) : null}
				<Button variant="ghost" size="sm" onClick={onClose}>
					收起
				</Button>
				<a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
					<ExternalLink className="size-3.5" />
					新标签打开
				</a>
			</div>
			<iframe src={url} title={url} className="h-[60vh] min-h-80 w-full rounded-md border border-border" />
		</div>
	);
}
