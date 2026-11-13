import { ExternalLink, FileQuestion, Link2 } from "lucide-react";
import { useState } from "react";

import { TaskLinkPreview } from "#/components/modules/task-close/task-link-preview";
import { ActionButton } from "#/components/ui/action-button";
import { useStableKeys } from "#/hooks/use-stable-keys";
import { isInternalUrl, parseBlock } from "#/lib/task-payload";
import { cn } from "#/lib/utils";

/**
 * 链接区只读渲染 —— 遍历 `payload.links`,站内 / 站外按 host 判定(见 `isInternalUrl`):
 * 站内走当前窗口,站外新开标签页并加 `noopener`。一行两条,卡片紧凑。
 *
 * 每条链接尾部有「预览」:**就地展开在链接下方**(不弹窗)—— iframe 打开同一地址
 * (站内同源必能嵌;站外看对方策略)。展开的那条占满整行,免得 iframe 挤在半列里。
 *
 * **容错**:认不出的块(老数据的文字 / 表格块、脏数据)渲染成占位,不抛错、也不吞掉其余链接。
 */
export function TaskLinkBlocks({ links }: { links: unknown }) {
	const items = Array.isArray(links) ? links : [];
	/** 展开预览的那条链接(同一时刻只展开一条,再点「收起」收回) */
	const [openUrl, setOpenUrl] = useState<string | null>(null);
	// 块没有 id;用「按位置稳定」的 key(内容变化不重建),别用下标(会被 noArrayIndexKey 拦下)
	const keys = useStableKeys(items.length, "tc-view");
	if (items.length === 0) {
		return <p className="text-sm text-muted-foreground">（没有链接）</p>;
	}
	return (
		<div className="grid gap-2 sm:grid-cols-2">
			{items.map((raw, index) => {
				const block = parseBlock(raw);
				if (!block) return <UnknownBlock key={keys[index]} raw={raw} />;
				const open = openUrl === block.url;
				return (
					<div key={keys[index]} className={cn("grid content-start gap-2", open && "sm:col-span-2")}>
						<LinkView url={block.url} open={open} onToggle={() => setOpenUrl(open ? null : block.url)} />
						{open ? <TaskLinkPreview url={block.url} onClose={() => setOpenUrl(null)} /> : null}
					</div>
				);
			})}
		</div>
	);
}

/** 一条链接 —— 站内用普通 `<a href>`(对任意路由都稳,不依赖类型化路由表),站外新开标签页 */
function LinkView({
	url,
	open,
	onToggle,
}: {
	url: string;
	/** 预览是否已展开 */
	open: boolean;
	onToggle: () => void;
}) {
	const internal = isInternalUrl(url);
	const Icon = internal ? Link2 : ExternalLink;
	return (
		<div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
			<a
				href={url}
				{...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
				title={url}
				className="flex min-w-0 flex-1 items-center gap-2 text-primary underline-offset-4 hover:underline"
			>
				<Icon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate font-mono text-xs">{url}</span>
			</a>
			<span className="shrink-0 text-xs text-muted-foreground">{internal ? "站内" : "站外"}</span>
			<ActionButton onClick={onToggle}>{open ? "收起" : "预览"}</ActionButton>
		</div>
	);
}

function UnknownBlock({ raw }: { raw: unknown }) {
	const kind = raw && typeof raw === "object" && "kind" in raw ? String((raw as { kind: unknown }).kind) : "未知";
	return (
		<div className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
			<FileQuestion className="size-3.5 shrink-0" />
			不支持的链接块（{kind}）
		</div>
	);
}
