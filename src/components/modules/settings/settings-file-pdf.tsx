import workerUrl from "pdfjs-worker?url";
import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

/**
 * PDF 内联预览 —— 这个文件**只在浏览器里、被打开时**才加载。
 *
 * 三条为什么:
 * 1. `react-pdf`(社区包,内含 pdfjs)整个走 `React.lazy` 动态引入,页面主 chunk 与 SSR 里
 *    都不会出现它 —— pdfjs 在 import 时就摸 `window` / `document`,进 SSR 会当场炸;
 * 2. worker 用 `pdfjs-worker?url` 指到 react-pdf 自带的那份 pdfjs-dist(见 `vite.config.ts` 的别名);
 *    不给 worker 的话 pdfjs 会退回主线程渲染,几十页的 PDF 会把界面卡住;
 * 3. 字节**由调用方取好**传进来(`data`),不是把 URL 交给 pdfjs 去拉:同一份取数逻辑
 *    (见 `settings-file-preview.tsx`)既能喂 PDF 也能喂文本,失败时还能给出可读的报错。
 *
 * ⚠️ 已知限制:CJK 的 CID 字体 PDF 需要 pdfjs 的 cMap 表(`pdfjs-dist/cmaps`),这里没配
 * (`cMapUrl`),所以**没内嵌字体的中文 PDF 可能显示空白/方块**,控制台会有
 * "The CMap … was not found" 之类的提示。真要支持,就把那份 cmaps 目录作为静态资源发出去,
 * 再给下面的 `options` 补 `cMapUrl` + `cMapPacked: true`。
 */

/** 单页渲染宽度(px):弹窗内宽约 600,留一点余量;窗口更窄时靠外层横向滚动 */
const PAGE_WIDTH = 540;

// 不给 worker 的话 pdfjs 会退回主线程渲染(fake worker),几十页的 PDF 会把界面卡住
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** 最多渲染前这么多页:预览用不着全渲染,完整内容给「打开」 */
const PAGE_MAX = 10;

export function SettingsFilePdf({ data }: { data: Uint8Array }) {
	const [numPages, setNumPages] = useState(0);

	return (
		<div className="space-y-1.5">
			<div className="max-h-[55vh] overflow-auto rounded-lg border border-border bg-muted/40 p-2">
				<Document
					file={{ data }}
					onLoadSuccess={({ numPages: total }) => setNumPages(total)}
					loading={<div className="p-3 text-xs text-muted-foreground">正在解析 PDF…</div>}
					error={<div className="p-3 text-xs text-destructive">PDF 解析失败(文件可能损坏或加密)</div>}
				>
					{Array.from({ length: Math.min(numPages, PAGE_MAX) }, (_, index) => (
						<Page
							// biome-ignore lint/suspicious/noArrayIndexKey: 页码就是稳定的标识
							key={index}
							pageNumber={index + 1}
							width={PAGE_WIDTH}
							className="mx-auto mb-2 shadow-sm last:mb-0"
						/>
					))}
				</Document>
			</div>
			<div className="text-xs text-muted-foreground">
				{numPages > PAGE_MAX
					? `共 ${numPages} 页,这里只渲染了前 ${PAGE_MAX} 页 —— 完整内容点「打开」`
					: numPages > 0
						? `共 ${numPages} 页`
						: "正在读取…"}
			</div>
		</div>
	);
}
