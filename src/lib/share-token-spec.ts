/**
 * 外链访客令牌的**规格**:允许页面的录入校验与状态折算。
 *
 * ⚠️ **这个文件里不允许出现 `db` / `drizzle` / 任何服务端依赖** —— 它是要进浏览器包的
 * (与 `para-spec.ts` 同一条界线:从客户端 import 服务端那个文件会把 mysql2 打进浏览器包)。
 *
 * 「允许页面」是**路径前缀**清单(`/demo/grid` 放行它自己和它的子路径),
 * 表单里每行一条;落库成 JSON 数组字符串,解析在服务端 `lib/share-access.ts`。
 */

/** 一条令牌最多允许多少个页面 —— 外链是给"看一个页面"用的,不是发遍历许可 */
export const SHARE_PATHS_MAX = 10;

/** 单条路径前缀的长度上限 */
export const SHARE_PATH_MAX = 200;

/** 备注长度上限(与 `sys_share_token.remark` 列宽一致) */
export const SHARE_REMARK_MAX = 255;

/** 有效期录入格式(`Input type="date"` 的原样值) */
export const SHARE_EXPIRES_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 解析「允许页面」多行文本:**每行一条、必须 `/` 开头、行内不能有空白、去重、限条数**。
 * 表单保存前与服务端入参校验共用这一个口径(码 ↔ 校验只有这一份)。
 */
export function parseAllowedPaths(text: string): { paths: string[]; problem: string | null } {
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (!line.startsWith("/")) return { paths: [], problem: `「${line}」要以 / 开头(路径前缀)` };
		if (/\s/.test(line)) return { paths: [], problem: `「${line}」里不能有空白` };
		if (line.length > SHARE_PATH_MAX) {
			return { paths: [], problem: `路径太长(最多 ${SHARE_PATH_MAX} 字符)` };
		}
		if (seen.has(line)) continue;
		seen.add(line);
		paths.push(line);
	}
	if (paths.length === 0) return { paths: [], problem: "至少填一条允许页面" };
	if (paths.length > SHARE_PATHS_MAX) return { paths: [], problem: `最多 ${SHARE_PATHS_MAX} 条允许页面` };
	return { paths, problem: null };
}

/** 令牌是否已过期(null = 长期有效,永不过期)—— 表格 / 详情的状态徽章用它 */
export function isShareTokenExpired(expiresAt: string | null): boolean {
	if (!expiresAt) return false;
	const at = new Date(expiresAt).getTime();
	return Number.isFinite(at) && at <= Date.now();
}
