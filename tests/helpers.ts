/**
 * 测试公共脚手架。
 *
 * 为什么直接调 tRPC procedure 而不是发 HTTP:
 *  `integrations/trpc/init.ts` 导出了 `createCallerFactory`,文档里写明用途就是「脚本 / 测试 /
 *  SSR loader 直接调 procedure,不走 HTTP」。于是测试不需要起服务、不需要端口、也不需要 mock fetch,
 *  测的就是真实的 procedure + 真实 SQL。
 *
 * ⚠️ 这些是**集成测试**,会真的读写 `.env.local` 指向的库。两条纪律:
 *  1. 测试数据一律用 `TEST_PREFIX` 打头的键 / 名称,结束必须清干净(tRPC 调用 `after` 里删);
 *  2. 测试之间不要依赖执行顺序 —— 每条用例自己建、自己删。
 */
import assert from "node:assert/strict";

import { db, dmPool } from "../src/db/index.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";

/** 测试数据统一前缀:方便一眼认出、也方便误留时清理 */
export const TEST_PREFIX = "__test__";

/** 测试数据用的纳秒级唯一后缀(避免并行 / 重复跑互相冲掉) */
export function uniqueSuffix(): string {
	return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 直调 procedure 的 caller(等价于服务端内部调用) */
export const caller = createCallerFactory(trpcRouter)({});

const NANOID_RE = /^[A-Za-z0-9_-]{21}$/;

/** 断言一个主键是 nanoid(21 位 URL 安全随机串) */
export function assertNanoid(value: unknown, label = "id"): void {
	assert.equal(typeof value, "string", `${label} 应为字符串`);
	assert.match(value as string, NANOID_RE, `${label} 应是 nanoid,实际是 ${String(value)}`);
}

/**
 * 关掉 MySQL 连接池。
 *
 * **每个测试文件都必须在最后一个 `after` 里调它**:node:test 会等事件循环里的空闲句柄,
 * 池不关进程就不退出 —— 症状是"测试跑完了但不返回",CI 里直接卡到超时。
 */
export async function closeDb(): Promise<void> {
	// 达梦分支没有 mysql2 那个 $client,用它自己的 pool.close();MySQL 分支照旧
	if (dmPool) {
		await dmPool.close();
		return;
	}
	await db.$client.end();
}

/** 断言 promise 以 tRPC 错误拒绝,并包含给定文案片段 */
export async function assertRejects(fn: () => Promise<unknown>, fragment: string): Promise<void> {
	let caught: unknown = null;
	try {
		await fn();
	} catch (error) {
		caught = error;
	}
	assert.ok(caught, `期望抛错(含「${fragment}」),但调用成功了`);
	const message = caught instanceof Error ? caught.message : String(caught);
	assert.ok(message.includes(fragment), `错误信息里应含「${fragment}」,实际是「${message}」`);
}
