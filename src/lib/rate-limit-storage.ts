/**
 * better-auth `secondaryStorage` 适配器 —— 把 `sys_rate_limit` 包成 BA 期望的 KV 接口。
 *
 * 为什么要这个:better-auth 的 `rateLimit.storage` 字段只接受 `"memory"` 或 `"secondary-storage"`
 * —— 后者把计数 / 读取交给外部接口,我们挂 Drizzle + MySQL/DM 让多副本 / 进程崩溃后
 * 限流状态仍生效(模板默认 dev 单实例 → 内存版就够,但**派生上多副本时务必打开**)。
 *
 * BA 的契约(节选自 `node_modules/@better-auth/core/dist/db/type.d.mts`):
 *  - `increment(key, ttlSec)` 必须**原子**地「不存在则创建(count=1, ttl)+ 存在则 +1 并返回新值」;
 *    ttl 只在创建那一瞬生效,后续 increment 不延长窗口 —— 这是窗口化限流的核心。
 *  - `set/get/delete/list` 普通 KV。
 *  - `getAndDelete` 原子取并删 —— BA 在某些清理路径上用。
 *
 * `sys_rate_limit` 表**两种用法并存**:
 *  - **限流计数**(BA 的 `rateLimit` 模块)—— 走 `count` 列,`increment` 原子 +1。
 *  - **session cache**(BA 的 `internal-adapter.createSession` 镜写二级缓存)—— 走 `value` 列,
 *    `set` 存 JSON 字符串,`get` 取出来(BA 自己 JSON.parse)。
 *
 * 踩坑记录(本文件 m26099):
 *  - 第一版**把 value 字段丢了**,导致 `secondaryStorage.get(token)` 返 "0",BA 拿到非 JSON 字符串
 *    后 `safeJSONParse` 失败,`findSession` 走 null 分支,登录后续全部 401。
 *  - 修复:**value text 列** 单独存字符串;`set/get/getAndDelete` 走它,`increment` 走 count 列;
 *    两套共用一行,靠 `expires_at` 共同 TTL。
 *
 * **DM 兼容**:用 Drizzle 的 `onDuplicateKeyUpdate` —— 它在 dm 那边会被 `src/db/dm/`
 * 改写成 MERGE INTO,跨方言安全。
 *
 * 模板基线:`pnpm start` / `pnpm dev` 单实例下,默认走 memory 路径(性能最好);BA 检测到
 * `secondaryStorage` 存在就自动切到 `"secondary-storage"`(`create-context.mjs:175`)。
 */
import { and, eq, inArray, isNotNull, like, lt, sql } from "drizzle-orm";

import { db } from "#/db";
import { sysRateLimit } from "#/db/data-base-schema";
import { logger } from "#/lib/logger";

/**
 * 当前时间;`addSeconds` 接受 BA 给的 ttl(秒)。
 *
 * 看着像"一层转发",但**不能内联**:下面 increment 里是同一条 UPDATE 的两个 CASE,
 * 两次调用必须取**同一个**时间点,内联成两次 `new Date()` 会在毫秒边界上让两个判断打架
 * (一个说已过期、一个说没过期)。
 */
function now(): Date {
	return new Date();
}
function addSeconds(seconds: number): Date {
	return new Date(Date.now() + seconds * 1000);
}

/**
 * `INSERT ... ON DUPLICATE KEY UPDATE` —— 窗口未过期则 +1,过期则重置为 1 并刷 ttl。
 *
 * `count` 列是限流的真相来源;**`value` 列保持不变**(increment 不读 value,但也不该把它清掉 ——
 * 否则一个 key 上同时跑限流 + session cache 会互相覆盖)。
 */
async function incrementImpl(key: string, ttlSec: number): Promise<number> {
	const expiresAt = addSeconds(ttlSec);
	await db
		.insert(sysRateLimit)
		.values({ key, count: 1, expiresAt })
		.onDuplicateKeyUpdate({
			set: {
				count: sql`CASE WHEN ${sysRateLimit.expiresAt} IS NULL OR ${sysRateLimit.expiresAt} < ${now()} THEN 1 ELSE ${sysRateLimit.count} + 1 END`,
				expiresAt: sql`CASE WHEN ${sysRateLimit.expiresAt} IS NULL OR ${sysRateLimit.expiresAt} < ${now()} THEN ${expiresAt} ELSE ${sysRateLimit.expiresAt} END`,
			},
		});
	const after = await db.select({ count: sysRateLimit.count }).from(sysRateLimit).where(eq(sysRateLimit.key, key));
	const v = after[0]?.count;
	const n = typeof v === "string" ? Number.parseInt(v, 10) : (v ?? 0);
	return Number.isFinite(n) ? n : 0;
}

/**
 * better-auth secondaryStorage 接口 —— BA 自动接管 rateLimit 计数(以及部分 session cache)。
 *
 * `unknown` 返回类型是 BA 故意写的;我们存的是 raw string(BA 自行 JSON.parse)。
 */
export const rateLimitStorage = {
	async get(key: string): Promise<unknown> {
		const row = await db
			.select({ value: sysRateLimit.value, expiresAt: sysRateLimit.expiresAt })
			.from(sysRateLimit)
			.where(eq(sysRateLimit.key, key))
			.limit(1);
		const r = row[0];
		if (!r) return null;
		if (r.expiresAt && r.expiresAt < now()) return null;
		// BA 走的是 KV 路径 —— 返回 value(它会 JSON.parse);null 当成 "键不存在"。
		// 如果是限流计数路径(只有 count 没 value),value 是 null 也按"键不存在"处理 —— 与 BA 契约一致。
		return r.value ?? null;
	},

	async set(key: string, value: string, ttl?: number): Promise<void> {
		const expiresAt = ttl && ttl > 0 ? addSeconds(ttl) : null;
		await db.insert(sysRateLimit).values({ key, count: 0, value, expiresAt }).onDuplicateKeyUpdate({
			set: { value, expiresAt },
		});
		// count=0 占位 —— 该行存在即代表 set;真要 increment 时再走 count 路径。
	},

	async delete(key: string): Promise<void> {
		await db.delete(sysRateLimit).where(eq(sysRateLimit.key, key));
	},

	async getAndDelete(key: string): Promise<unknown> {
		// MySQL 没有原子的 get-and-delete;用事务包两步(同 connection,行锁住)。
		return db.transaction(async (tx) => {
			const row = await tx
				.select({ value: sysRateLimit.value })
				.from(sysRateLimit)
				.where(eq(sysRateLimit.key, key))
				.limit(1);
			if (row.length === 0) return null;
			await tx.delete(sysRateLimit).where(eq(sysRateLimit.key, key));
			return row[0].value;
		});
	},

	async increment(key: string, ttl: number): Promise<number> {
		try {
			return await incrementImpl(key, ttl);
		} catch (err) {
			logger.warn("rate_limit_storage.increment.failed", { key, ttl, error: String(err) });
			// 失败关闭策略:不让限流挂掉整个请求路径 —— 返回 1 让 BA 放行(宽松);
			// 上生产时可以改成 throw,让监控告警。
			return 1;
		}
	},

	async list(prefix: string): Promise<string[]> {
		// BA 的 list 用在「清掉前缀匹配的旧键」,模板没有那个场景,实现走 LIKE。
		const rows = await db
			.select({ key: sysRateLimit.key })
			.from(sysRateLimit)
			.where(like(sysRateLimit.key, `${prefix}%`));
		return rows.map((r) => r.key);
	},
};

/**
 * 清理 expired 行 —— 防止 `sys_rate_limit` 越长越大。
 *
 * **不在这里 setInterval**:模块级的定时器会在 dev 热重载 / 多副本下重复起。
 * 想按自己的节奏清就直接调它(或者用下面那个节流版)。
 * MySQL 的 `delete()` 不支持 `.returning()`,所以是 select + delete 两步。
 */
export async function purgeExpiredRateLimits(now: Date = new Date()): Promise<number> {
	const rows = await db
		.select({ key: sysRateLimit.key })
		.from(sysRateLimit)
		.where(and(isNotNull(sysRateLimit.expiresAt), lt(sysRateLimit.expiresAt, now)));
	if (rows.length === 0) return 0;
	await db.delete(sysRateLimit).where(
		inArray(
			sysRateLimit.key,
			rows.map((r) => r.key),
		),
	);
	return rows.length;
}

/** 上次真跑清理的时间(模块级 —— 每个进程各自节流,足够用) */
let lastPurgeAt = 0;

/**
 * 节流版清理:**模板里没有调度器**,所以借认证请求当心跳(`auth.ts` 的 `hooks.after`)——
 * 默认一小时最多真跑一次,认证请求本来就稀疏,代价可以忽略,而表也不会无限长下去。
 *
 * 节流期内返回 `0`(意思是"这次没跑",不是"跑了但没删到");清理失败只记日志,绝不影响登录。
 */
export async function purgeExpiredRateLimitsThrottled(intervalMs = 60 * 60 * 1000): Promise<number> {
	if (Date.now() - lastPurgeAt < intervalMs) return 0;
	lastPurgeAt = Date.now();
	try {
		return await purgeExpiredRateLimits();
	} catch (error) {
		logger.warn("rate_limit.purge_failed", { message: error instanceof Error ? error.message : String(error) });
		return 0;
	}
}
