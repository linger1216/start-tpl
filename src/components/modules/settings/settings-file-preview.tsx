import { Download, FileText, Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import type { FileRow } from "#/components/modules/settings/settings-files-table";
import { buttonVariants } from "#/components/ui/button";
import {
	filePreviewKind,
	PDF_PREVIEW_FETCH_MAX_BYTES,
	TEXT_PREVIEW_FETCH_MAX_BYTES,
	TEXT_PREVIEW_MAX_BYTES,
} from "#/lib/file-preview";
import { formatBytes } from "#/lib/format";

/**
 * PDF 渲染器(`react-pdf` + pdfjs)只在**真要渲染 PDF 时**才下载 —— 它比别的页面代码重得多,
 * 静态引入会把 pdfjs 拖进页面主 chunk(和 `xlsx` 那组一个问题,见 `doc/界面约定.md` 的懒加载一节)。
 */
const SettingsFilePdf = lazy(() => import("#/components/modules/settings/settings-file-pdf"));

type PreviewState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "text"; text: string; truncated: boolean }
	| { status: "pdf"; data: Uint8Array };

/**
 * 文件内联预览 —— 图片 / PDF / 文本三类直接看,其余给「打开」。
 *
 * 字节怎么拿:**浏览器直接 `fetch` 预签名地址**(和上传一样是浏览器 ↔ 对象存储的直传),
 * 不经 tRPC 转一手 —— 图片 / PDF 动辄几 MB,过服务端纯属浪费。代价是桶要允许 GET 的 CORS,
 * 于是失败路径必须给出可行动的提示(见下面的 `CORS_HINT`)。
 */
export function SettingsFilePreview({ row, url, live }: { row: FileRow; url: string | null; live: boolean }) {
	const kind = filePreviewKind(row);
	const tooBig =
		kind === "pdf"
			? row.size > PDF_PREVIEW_FETCH_MAX_BYTES
			: kind === "text" && row.size > TEXT_PREVIEW_FETCH_MAX_BYTES;
	const [state, setState] = useState<PreviewState>({ status: "idle" });

	useEffect(() => {
		if ((kind !== "pdf" && kind !== "text") || !url || tooBig) {
			setState({ status: "idle" });
			return;
		}
		const abort = new AbortController();
		setState({ status: "loading" });
		void (async () => {
			try {
				const response = await fetch(url, { signal: abort.signal });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				if (kind === "pdf") {
					setState({ status: "pdf", data: new Uint8Array(await response.arrayBuffer()) });
					return;
				}
				const buffer = await response.arrayBuffer();
				const truncated = buffer.byteLength > TEXT_PREVIEW_MAX_BYTES;
				const decoder = new TextDecoder("utf-8");
				setState({
					status: "text",
					// 按 UTF-8 解:非 UTF-8(GBK 之类)的老文件会出现替换字符,这是取舍 ——
					// 认编码要额外依赖,而"能大概看一眼"已经够用
					text: decoder.decode(truncated ? buffer.slice(0, TEXT_PREVIEW_MAX_BYTES) : buffer),
					truncated,
				});
			} catch (error) {
				if (abort.signal.aborted) return;
				setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
			}
		})();
		return () => abort.abort();
	}, [kind, url, tooBig]);

	return (
		<div className="space-y-1.5">
			<div className="text-xs font-medium text-muted-foreground">预览</div>
			{renderBody({ row, url, live, kind, tooBig, state })}
		</div>
	);
}

const CORS_HINT = "取不到内容 —— 若是私有桶,检查对象存储的 CORS 是否允许 GET(见 doc/文件管理.md)";

function renderBody({
	row,
	url,
	live,
	kind,
	tooBig,
	state,
}: {
	row: FileRow;
	url: string | null;
	live: boolean;
	kind: ReturnType<typeof filePreviewKind>;
	tooBig: boolean;
	state: PreviewState;
}) {
	if (row.status === 2) return <Fallback url={null} message="已删除,对象已清掉" />;
	if (!live || !url) return <Fallback url={null} message="正在取地址…" />;

	if (kind === "image") {
		return (
			<img
				src={url}
				alt={row.originName}
				className="max-h-64 w-auto rounded-lg border border-border bg-muted object-contain"
			/>
		);
	}

	if (tooBig) {
		return <Fallback url={url} message={`${formatBytes(row.size)} 太大了,不内联预览`} />;
	}

	if (kind === "pdf") {
		if (state.status === "loading") return <Loading label="正在取 PDF…" />;
		if (state.status === "error") return <Fallback url={url} message={CORS_HINT} />;
		if (state.status === "pdf") {
			return (
				<Suspense fallback={<Loading label="正在加载 PDF 渲染器…" />}>
					<SettingsFilePdf data={state.data} />
				</Suspense>
			);
		}
		return <Fallback url={url} message="正在取地址…" />;
	}

	if (kind === "text") {
		if (state.status === "loading") return <Loading label="正在取文本…" />;
		if (state.status === "error") return <Fallback url={url} message={CORS_HINT} />;
		if (state.status === "text") {
			return (
				<div className="space-y-1.5">
					<pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">
						{state.text}
					</pre>
					{state.truncated ? (
						<div className="text-xs text-muted-foreground">
							只显示前 {formatBytes(TEXT_PREVIEW_MAX_BYTES)},完整内容点「打开」
						</div>
					) : null}
				</div>
			);
		}
		return <Fallback url={url} message="正在取地址…" />;
	}

	return <Fallback url={url} message="这个类型没有内联预览" />;
}

/** 取不到字节 / 不支持的类型 —— 统一给一行提示 + 「打开」 */
function Fallback({ url, message }: { url: string | null; message: string }) {
	return (
		<div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4">
			<FileText className="size-4 shrink-0 text-muted-foreground" />
			<span className="text-xs text-muted-foreground">{message}</span>
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
	);
}

function Loading({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4">
			<Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
			<span className="text-xs text-muted-foreground">{label}</span>
		</div>
	);
}
