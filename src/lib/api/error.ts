/**
 * 错误归一化工具:把任意形态的错误(TRPCClientError / Error / 字符串 / unknown)
 * 统一转成 ApiError,便于上层统一 toast / 表单回显。
 *
 * 注:旧项目 envelope 包装已去掉,这里保留 ApiError 结构供 toApiError 使用。
 */

/** 归一后的错误形态(code 为业务错误码,msg 可展示,data 透传 zodError 等) */
class ApiError extends Error {
	code: number;
	data: unknown;
	constructor(code: number, msg: string, data: unknown = null) {
		super(msg);
		this.name = "ApiError";
		this.code = code;
		this.data = data;
	}
}

const FALLBACK_CODE = 5000;
const FALLBACK_MSG = "未知错误";

/**
 * 「接口返回 HTML 而不是 JSON」的识别与翻译。
 *
 * 现场:走自定义域名(如 `https://xxx.localhost`,由本地代理/portless 之类转发)时,
 * `/api/trpc/*` 没被转发到应用,代理直接把它的 404/SPA 页面(HTML)返回给 fetch,
 * tRPC 解析 JSON 就抛 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` ——
 * 用户完全看不懂。这里翻译成「域名 / 代理没放行 POST /api/trpc」+ 具体怎么办。
 */
const HTML_RESPONSE_PATTERN = /unexpected token '<?'|is not valid json|<!doctype html/i;

/** 命中「拿到 HTML」时给出的可操作文案 */
const HTML_RESPONSE_HINT =
	"接口返回的是 HTML 而不是 JSON:当前访问的域名没有被转发到本应用(或代理没放行 POST /api/trpc)。本机开发请直接用 http://localhost:3000 打开;用自定义域名时,需把 /api/trpc 一并代理到 dev 服务。";

/** 任意错误 → ApiError */
export function toApiError(e: unknown): ApiError {
	if (e instanceof ApiError) return e;

	// tRPC client 错误:tRPCClientError.message + tRPCClientError.data
	if (e && typeof e === "object" && "data" in e) {
		const data = (e as { data?: unknown }).data;
		if (data && typeof data === "object") {
			const d = data as { code?: unknown; msg?: unknown; zodError?: unknown };
			if (typeof d.code === "number") {
				const msg = typeof d.msg === "string" ? d.msg : FALLBACK_MSG;
				return new ApiError(d.code, msg, d.zodError ?? null);
			}
		}
	}

	if (e instanceof Error) {
		// 拿到 HTML 的 JSON 解析错误:换成能照着做的提示
		if (HTML_RESPONSE_PATTERN.test(e.message)) return new ApiError(FALLBACK_CODE, HTML_RESPONSE_HINT);
		return new ApiError(FALLBACK_CODE, e.message || FALLBACK_MSG);
	}

	const text = String(e);
	if (HTML_RESPONSE_PATTERN.test(text)) return new ApiError(FALLBACK_CODE, HTML_RESPONSE_HINT);
	return new ApiError(FALLBACK_CODE, text);
}
