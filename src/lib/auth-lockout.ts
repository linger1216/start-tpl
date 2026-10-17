/**
 * 登录风控的**业务逻辑层** —— 数据库读写 + 阈值决策,不管 HTTP。
 *
 * 设计:
 *  - **失败阈值 5** 次,锁定 **15 分钟**:实测「5 分钟太久,15 秒太短」之间的折衷,
 *    也是 GitHub / GitLab 的常见值。改阈值动这两个常量即可。
 *  - 计数用「滑动窗口」而非「固定累计」:5 分钟内累计 5 次才锁;超 5 分钟的旧失败清零。
 *    避免「半年前输错 5 次,今天被永久锁」的尴尬。
 *  - 表是 `sys_account_lockout`(见 `data-base-schema.ts`);**只在 better-auth 的 `hooks` 里调用**,
 *    不开放给 resolver(不要在用户表查询里塞 lock 状态)。
 *
 * 与 `auth.rateLimit` 是**两层**:那一层按 IP / 端点控速(1 分钟 5 次),
 * 这一层按账号累计失败次数(5 次锁 15 分钟)。两层一起兜才稳 —— 攻击者
 * 每次换 IP 也会累计到这一层。
 */
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";

import { db } from "#/db";
import { sysAccountLockout } from "#/db/data-base-schema";
import { logger } from "#/lib/logger";

/** 连续失败多少次就锁(模板默认 5) */
const LOCKOUT_THRESHOLD = 5;
/** 锁多久(模板默认 15 分钟) */
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
/** 滑动窗口多宽(模板默认 5 分钟内的失败才叠加) */
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

/**
 * 锁定的剩余秒数 —— `locked_until > now()` 时返回正数,否则 0。
 * 用来给客户端说「再过 X 秒才能再试」。
 */
export function lockoutRemainingMs(lockedUntil: Date | null): number {
	if (!lockedUntil) return 0;
	const diff = lockedUntil.getTime() - Date.now();
	return diff > 0 ? diff : 0;
}

/**
 * 该账号是否当前被锁定(以及剩余秒数)。
 * 给 `hooks.before` 用 —— 命中就抛 429。
 *
 * 注意:会顺手「清掉过期」的锁定记录(已过期的 `locked_until` 直接清零)、
 * 顺手「清掉 5 分钟前的旧失败计数」—— 这俩不维护会导致表无限长大。
 */
export async function isAccountLocked(
	email: string,
): Promise<{ locked: true; remainingMs: number } | { locked: false }> {
	const row = await db
		.select({
			failedAttempts: sysAccountLockout.failedAttempts,
			lockedUntil: sysAccountLockout.lockedUntil,
		})
		.from(sysAccountLockout)
		.where(eq(sysAccountLockout.email, email))
		.limit(1);
	const r = row[0];
	if (!r?.lockedUntil) return { locked: false };
	const remaining = lockoutRemainingMs(r.lockedUntil);
	if (remaining > 0) return { locked: true, remainingMs: remaining };
	// 过期锁定状态 → 解锁(顺手做)
	await db
		.update(sysAccountLockout)
		.set({ lockedUntil: null })
		.where(and(eq(sysAccountLockout.email, email), lte(sysAccountLockout.lockedUntil, new Date())));
	return { locked: false };
}

/**
 * 登录失败一次:`failed_attempts += 1`,超阈值则锁定。
 *
 * 返回新的 `failed_attempts` 与(若被锁的)`locked_until`,便于日志与告警。
 * `ip` 可为空 —— 直调 caller 没有请求头;传给 hooks 那条就有。
 */
export async function recordSignInFailure(
	email: string,
	ip: string | null,
): Promise<{
	failedAttempts: number;
	locked: boolean;
}> {
	const cfg = effectiveLockoutConfig();
	const now = new Date();
	const windowStart = new Date(Date.now() - cfg.windowMs);

	// 窗口外的旧失败清零(原子 SQL:5 分钟外的失败置 0)
	await db
		.update(sysAccountLockout)
		.set({ failedAttempts: 0, lockedUntil: null })
		.where(and(eq(sysAccountLockout.email, email), lte(sysAccountLockout.lastFailedAt, windowStart)));

	// 当前窗口内的失败数(可能刚被上面清零,所以再读一次)
	const cur = await db
		.select({ failedAttempts: sysAccountLockout.failedAttempts })
		.from(sysAccountLockout)
		.where(eq(sysAccountLockout.email, email))
		.limit(1);
	const prev = cur[0]?.failedAttempts ?? 0;
	const next = prev + 1;
	const willLock = next >= cfg.threshold;
	const lockedUntil = willLock ? new Date(Date.now() + cfg.durationMs) : null;

	// upsert 的**方言安全**两步式(rate-limit-storage 同款:update → 0 行则 insert → 撞键回轮):
	// 注:DM 线没有 ON DUPLICATE KEY UPDATE,这里绝不能走 drizzle 的 onDuplicateKeyUpdate。
	for (let attempt = 0; attempt < 2; attempt++) {
		const result = await db
			.update(sysAccountLockout)
			.set({
				failedAttempts: next,
				lockedUntil,
				lastFailedAt: now,
				lastFailedIp: ip ?? null,
			})
			.where(eq(sysAccountLockout.email, email));
		const header = Array.isArray(result) ? result[0] : result;
		if (header.affectedRows > 0) break;
		try {
			await db
				.insert(sysAccountLockout)
				.values({ email, failedAttempts: next, lockedUntil, lastFailedAt: now, lastFailedIp: ip ?? null });
			break;
		} catch {
			// 并发撞唯一键 → 回轮 update 分支
		}
	}

	if (willLock) {
		logger.warn("auth.lockout.triggered", {
			email,
			failedAttempts: next,
			durationMs: cfg.durationMs,
			ip,
		});
	}
	return { failedAttempts: next, locked: willLock };
}

/**
 * 登录成功 → 失败计数清零。锁定已过期的也会顺手清掉。
 */
export async function clearSignInFailures(email: string): Promise<void> {
	await db
		.update(sysAccountLockout)
		.set({ failedAttempts: 0, lockedUntil: null })
		.where(eq(sysAccountLockout.email, email));
}

/**
 * 管理员手动解锁(模板保留接口,UI 上目前没接 —— 派生新项目再加)。
 */
export async function manualUnlock(email: string): Promise<void> {
	await db.delete(sysAccountLockout).where(eq(sysAccountLockout.email, email));
}

/**
 * 查找所有「当前仍在锁」的账号 —— 运维 UI 用,模板未做 UI。
 */
export async function listCurrentlyLocked(): Promise<Array<{ email: string; lockedUntil: Date }>> {
	const now = new Date();
	const rows = await db
		.select({
			email: sysAccountLockout.email,
			lockedUntil: sysAccountLockout.lockedUntil,
		})
		.from(sysAccountLockout)
		.where(and(isNotNull(sysAccountLockout.lockedUntil), gte(sysAccountLockout.lockedUntil, now)));
	return rows.filter((r): r is { email: string; lockedUntil: Date } => r.lockedUntil !== null);
}

/** 让单测 / 脚本临时改阈值的口子 —— 测试用 `setLockoutConfig({ threshold: 2 })` 后再做断言 */
let overrideConfig: { threshold?: number; durationMs?: number; windowMs?: number } = {};
export function setLockoutConfig(overrides: { threshold?: number; durationMs?: number; windowMs?: number }): void {
	overrideConfig = { ...overrideConfig, ...overrides };
}
/** 仅测试用 —— 跑完断言后调一次恢复默认。 */
export function resetLockoutConfig(): void {
	overrideConfig = {};
}

/** 当前生效的阈值(给单测断言用;生产代码用上面的常量即可)。 */
export function effectiveLockoutConfig(): { threshold: number; durationMs: number; windowMs: number } {
	return {
		threshold: overrideConfig.threshold ?? LOCKOUT_THRESHOLD,
		durationMs: overrideConfig.durationMs ?? LOCKOUT_DURATION_MS,
		windowMs: overrideConfig.windowMs ?? FAILURE_WINDOW_MS,
	};
}
