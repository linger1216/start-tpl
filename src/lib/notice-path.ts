/**
 * 站内跳转路径的**白名单** —— 写侧(发送时消毒)与读侧(解析历史数据)共用这一份。
 *
 * 为什么要白名单而不是黑名单:`path` 会被拼进 `router.navigate()` / `<a href>`,
 * 黑名单永远漏一个协议(`javascript:` / `data:` / `vbscript:` …)。
 * 这里只放行「以单个 `/` 开头、后面是 URL 里常见的可见字符」——
 * 因此 `//evil.example`(协议相对外链)、`http://…`、`javascript:…` 全部落空。
 *
 * 之前同一个正则写了两遍(`lib/notice.ts` 写侧 / `routers/notice.ts` 读侧),
 * 改一处必漏另一处 —— 现在只有这一处。
 */
const NOTICE_PATH_RE = /^\/(?!\/)[A-Za-z0-9\-/_.[\]]*$/;

/** 路径长度上限 —— 与 `sys_notification.path` 的 `varchar(255)` 对齐 */
export const NOTICE_PATH_MAX = 255;

/**
 * 一个值能不能当通知的跳转路径 —— 能就给规范化后的路径,不能就给 `null`。
 *
 * 读侧拿它对**历史数据**再过一遍(库里可能留着旧版本写进去的脏值);
 * 写侧拿它挡下非法输入。两侧同一个判据,不会出现「写进去能过、读出来被拦」。
 */
export function safeNoticePath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const path = value.trim();
	return path.length <= NOTICE_PATH_MAX && NOTICE_PATH_RE.test(path) ? path : null;
}
