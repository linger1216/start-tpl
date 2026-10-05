/**
 * CaptchaKit 端点 —— `/api/captcha`。
 *
 * 为什么挂一个独立的 REST 端点、不走 tRPC:
 *  1. **AGENTS 「接口只有 tRPC」**的既有例外是 better-auth 的 `/api/auth/*` 与 SSE 的 `/api/sse/notice`。
 *     CaptchaKit 走 better-auth 的 `hooks.before` 拦截(见 `src/lib/auth.ts`),前端是认证钩子的反面
 *     客户端 SDK 形态 —— 与 `/api/auth/*` 同族。沿用「REST 例外」口径,不在 tRPC 加 query/mutation;
 *  2. **CaptchaKit 客户端 `<Captcha />` 默认 fetch `/api/captcha`**:端点 URL 写死,
 *     走 tRPC 要把 `<Captcha />` 的 props 全包一层,徒增一处薄封装;
 *  3. **CAPTCHA 验证是 stateless + 无会话**:不挂在 `protectedProcedure`(登录前调),
 *     与 dBA 路由(`/api/auth/*`)同口径独立成对。
 *
 * GET → createChallenge:浏览器打开 /login 时拉一道题(text/number/math/image + difficulty + locale)。
 * POST → verifyCaptcha:登录提交时把 proof token 带回,服务端消费一次,再用 BA `hooks.before` 在
 *  `/sign-in/email` 上做最终校验 —— 这一步**两条防线**:
 *   - 这里先验证明能力是否有效,返回 400 + 错误码 → 用户立刻看到反馈;
 *   - BA hooks.before 也验一遍 → 即使前端绕过这一层直接 POST /sign-in/email,服务端仍会拦截。
 *
 * 详见 `src/lib/auth.ts` 的 `hooks.before` 段。
 */
import { createFileRoute } from "@tanstack/react-router";

import { createCaptchaHandlers } from "captchakit/server";

// `secret` 走 CAPTCHAKIT_SECRET(最少 32 字节;captchakit 内部校验),dev 没设时返回 500。
// `.env.example` 与 `lib/auth.ts` 的 hooks.before 读同一份。
const { GET, POST } = createCaptchaHandlers();

// captchakit 的 handler 收裸 `Request`,TanStack 的 `server.handlers` 收 `{ request }` ctx ——
// 这里只做签名对齐,不包一层逻辑(同 `api.sse.notice.ts` 的 handler 写法)。
export const Route = createFileRoute("/api/captcha")({
	server: {
		handlers: {
			GET: ({ request }) => GET(request),
			POST: ({ request }) => POST(request),
		},
	},
});
