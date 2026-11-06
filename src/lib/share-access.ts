/**
 * 外链访客(share token)—— 免登只读访问的**核心判定**,纯服务端(import db)。
 *
 * 机制是三段接力(全文见 `doc/外链分享.md`):
 *  1. **路由守卫**(`routes/(main)/route.tsx`):URL 上 `?share=<token>` 与令牌表比对,
 *     命中则以「访客」身份放行白名单页面,把令牌写进 httpOnly cookie 后 307 回摘参地址;
 *  2. **数据层**(`lib/current-user.ts` 的访客兜底 + tRPC 权限中间件的访客特判):
 *     无会话时读同一颗 cookie 认人;访客只放行「令牌允许页面」的读接口,写一律拒绝;
 *  3. **管理**:`sys_share_token` 表 + 「用户管理 ▸ 访客管理」Tab(trpc.shareToken)。
 *
 * ⚠️ **本文件 import 了 `db`,只能在服务端用**(tRPC procedure / createServerFn 的动态 import)。
 * 客户端要校验或类型,从 `lib/share-token-spec.ts` 取 —— 那条界线与 `para-spec.ts` 相同。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "#/db";
import { sysShareToken } from "#/db/data-base-schema";

/** 访客身份(id 固定:tRPC 权限中间件靠它认访客;它不是 `sys_user` 里的行) */
export const SHARE_GUEST = { id: "share-guest", name: "访客" } as const;

/** 访客令牌的 cookie 名(httpOnly,前端 JS 摸不到) */
export const SHARE_COOKIE_NAME = "share_token";

/** cookie 有效期(秒):过期后重新打开外链即可(令牌未变就还能进) */
export const SHARE_COOKIE_MAX_AGE = 8 * 60 * 60;

/**
 * 访客**永不进入**的管理区前缀 —— 即使令牌的允许路径里写了 `/settings/*` 也按无效处理。
 * 访客是给业务页面用的;管理页的数据接口(如 `shareToken.list` 自己)不该被外链读到。
 */
export const SHARE_GUEST_BLOCKED_PREFIXES: readonly string[] = ["/settings"];

/**
 * 访客放行的**外壳级**读接口 —— `(main)` 布局自身要用的(侧边栏菜单 / 布局偏好),
 * 加上跨页面取值器与顶栏铃铛。除此之外,未在 `SHARE_GUEST_QUERY_PAGES` 登记的读接口
 * 对访客一律拒绝(「登录即可」≠「访客即可」,与 `UNMAPPED_QUERIES` 的语义刻意不同)。
 */
export const SHARE_GUEST_SHELL_QUERIES: readonly string[] = ["menu.mine", "para.byKey", "dict.byCode", "notice.list"];

/** 可分享页面的数据接口。登记实际路径,避免页面权限码折算后产生路径碰撞。 */
export const SHARE_GUEST_QUERY_PAGES: Readonly<Record<string, readonly string[]>> = {
	"demoGrid.list": ["/demo/grid"],
	"department.tree": ["/demo/grid"],
	"taskClose.workflowGet": ["/task-close/workflows"],
};

/** 访客可看的页面路径前缀清单(来自命中令牌的 `allowed_paths`) */
export type ShareGuestPaths = readonly string[];

type TokenRow = typeof sysShareToken.$inferSelect;

/** 库里的 `allowed_paths`(JSON 数组字符串)→ 路径清单;脏数据按"解析出几条算几条" */
export function parseStoredPaths(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is string => typeof item === "string" && item.startsWith("/") && !/\s/.test(item),
		);
	} catch {
		return [];
	}
}

const CACHE_TTL_MS = 30_000;
let cache: { at: number; rows: TokenRow[] } | null = null;

/** 「启用中」的令牌行(过期不算 —— 每次调用现判,这样改 `expires_at` 无需清缓存) */
async function activeRows(): Promise<TokenRow[]> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
	const rows = await db.select().from(sysShareToken).where(eq(sysShareToken.enabled, 1));
	cache = { at: Date.now(), rows };
	return rows;
}

/** 令牌增删改之后调用(router 里四个写口都调)—— 不然旧令牌还能再活 30 秒 */
export function clearShareTokenCache() {
	cache = null;
}

function sha256(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

/** 常数时间比较(防时序侧信道);先 sha256 把长度对齐,`timingSafeEqual` 才吃得下 */
function tokenEquals(a: string, b: string): boolean {
	return timingSafeEqual(sha256(a), sha256(b));
}

/**
 * 命中「启用 ∧ 未过期」的令牌;没命中返回 `null` —— 调用方一律按**未登录**处理。
 * 每个请求(守卫 + 数据层)都会走这里,行清单走 30 秒内存缓存(与 `getParaMap` 同思路)。
 */
export async function matchShareToken(
	token: string | null | undefined,
): Promise<{ token: string; allowedPaths: ShareGuestPaths } | null> {
	const candidate = token?.trim();
	if (!candidate) return null;
	for (const row of await activeRows()) {
		if (!tokenEquals(candidate, row.token)) continue;
		if (row.expires_at && row.expires_at.getTime() <= Date.now()) return null;
		return { token: row.token, allowedPaths: parseStoredPaths(row.allowed_paths) };
	}
	return null;
}

/** 路径前缀匹配:`/demo/grid` 放行它自己和它的子路径 */
export function isPathAllowedForToken(paths: ShareGuestPaths, path: string): boolean {
	return paths.some((p) => path === p || path.startsWith(`${p}/`));
}

/** 路径是否落进访客禁入的管理区(与守卫、数据层共用一份口径) */
function isBlockedPath(path: string): boolean {
	return SHARE_GUEST_BLOCKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 访客能不能**打开**这个页面(路由守卫用):不在管理区禁入清单 ∧ 在令牌允许清单里 */
export function guestMayView(paths: ShareGuestPaths, path: string): boolean {
	if (isBlockedPath(path)) return false;
	return isPathAllowedForToken(paths, path);
}

/** 只放行显式登记的页面查询,使用与路由守卫相同的路径前缀判定。 */
export function guestMayQuery(paths: ShareGuestPaths, procedure: string): boolean {
	return (SHARE_GUEST_QUERY_PAGES[procedure] ?? []).some((page) => guestMayView(paths, page));
}

/** 从 Cookie 头取访客令牌(只解析不校验);畸形片段按没有处理 */
export function readShareTokenFromHeaders(headers: Headers): string | null {
	const raw = headers.get("cookie");
	if (!raw) return null;
	for (const part of raw.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name !== SHARE_COOKIE_NAME) continue;
		try {
			return decodeURIComponent(rest.join("="));
		} catch {
			return null;
		}
	}
	return null;
}

/** Set-Cookie 值:HttpOnly(前端 JS 摸不到)+ SameSite=Lax */
export function shareCookieHeader(token: string): string {
	return `${SHARE_COOKIE_NAME}=${encodeURIComponent(token.trim())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SHARE_COOKIE_MAX_AGE}`;
}

/** 新令牌:32 位 hex(`openssl rand -hex 16` 同款) */
export function newShareToken(): string {
	return randomBytes(16).toString("hex");
}
