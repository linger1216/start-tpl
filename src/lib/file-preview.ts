/**
 * 文件内联预览 —— "这个文件能不能在弹窗里直接看"的判据,以及几档体积上限。
 *
 * 为什么单独抽成纯函数:分流逻辑(图片 / PDF / 文本 / 不支持)是纯的、能单测,
 * 而这个仓库没有 DOM 测试环境(组件测不了)。`settings-file-preview.tsx` 只负责按结果取字节 + 渲染。
 *
 * 判据为什么同时看 contentType 和后缀:上传是浏览器直传,`content_type` 是**客户端自己报的**
 * (`presign` 那一步),既可能空、也可能被报成 `application/octet-stream` —— 只认 MIME 会大量误判。
 */
export type FilePreviewKind = "image" | "pdf" | "text" | "none";

/** 文本预览最多读这么多字符:日志 / SQL 动辄几 MB,整段塞进 DOM 会卡 */
export const TEXT_PREVIEW_MAX_BYTES = 128 * 1024;

/** 超过这个体积干脆不取字节(不预览,直接给「打开」)—— 免得点一下详情就把几十 MB 拉下来 */
export const TEXT_PREVIEW_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const PDF_PREVIEW_FETCH_MAX_BYTES = 20 * 1024 * 1024;

/** 认后缀:这些类型即使 MIME 缺失(或报成 octet-stream)也当文本预览 */
const TEXT_EXT = new Set([
	"txt",
	"log",
	"md",
	"markdown",
	"json",
	"jsonc",
	"ndjson",
	"csv",
	"tsv",
	"xml",
	"yml",
	"yaml",
	"toml",
	"ini",
	"conf",
	"cfg",
	"properties",
	"env",
	"sql",
	"sh",
	"bash",
	"zsh",
	"ps1",
	"bat",
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"py",
	"java",
	"kt",
	"go",
	"rs",
	"rb",
	"php",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"swift",
	"css",
	"scss",
	"less",
	"html",
	"htm",
	"vue",
	"svelte",
	"diff",
	"patch",
]);

/** 认 MIME:`text/*` 之外还有一批"其实是文本但不在 text/ 下"的类型 */
const TEXT_MIME = new Set([
	"application/json",
	"application/ld+json",
	"application/x-ndjson",
	"application/xml",
	"application/xhtml+xml",
	"application/javascript",
	"application/x-javascript",
	"application/typescript",
	"application/x-yaml",
	"application/yaml",
	"application/toml",
	"application/sql",
	"application/graphql",
	"application/x-sh",
	"application/x-httpd-php",
]);

/**
 * 分类。**只认这几类**,别的类型一律 `none`(页面给「打开 / 下载」兜底)——
 * 宁可少预览,也不要为了"多支持一种格式"把二进制当文本塞进 DOM。
 */
export function filePreviewKind(file: { contentType?: string | null; ext?: string | null }): FilePreviewKind {
	const mime = (file.contentType ?? "").trim().toLowerCase();
	const ext = (file.ext ?? "").trim().toLowerCase().replace(/^\./, "");

	// svg 也算图片:`<img>` 里不执行脚本,和 PNG 一样安全
	if (mime.startsWith("image/")) return "image";
	if (mime === "application/pdf" || ext === "pdf") return "pdf";
	if (mime.startsWith("text/") || TEXT_MIME.has(mime) || TEXT_EXT.has(ext)) return "text";
	return "none";
}
