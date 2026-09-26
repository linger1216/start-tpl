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

import { eq, inArray, lt } from "drizzle-orm";

import {
	sysAccount,
	sysDept,
	sysUserDept,
	sysDict,
	sysMenu,
	sysPara,
	sysRole,
	sysRoleMenu,
	sysLog,
	sysSession,
	sysTag,
	sysUser,
	sysUserRole,
} from "../src/db/data-base-schema.ts";
import { db, dmPool } from "../src/db/index.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";

/** 测试数据统一前缀:方便一眼认出、也方便误留时清理 */
export const TEST_PREFIX = "__test__";

/** 测试数据用的纳秒级唯一后缀(避免并行 / 重复跑互相冲掉) */
export function uniqueSuffix(): string {
	return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * 直调 procedure 时**注入的用户**。
 *
 * 为什么必须注入:中间件要拿"当前用户",而直调 caller 压根没有请求上下文
 * (`getRequestHeaders()` 会抛)⇒ 不注入的话,加了登录校验之后**每个测试都会 401**。
 * `isSuper` 让它免去"造角色 + 授权"的样板 —— 这条注入路径**从网络不可达**
 * (HTTP 入口 `api.trpc.$.tsx` 没有 `createContext`),所以它不是后门。
 */
export const TEST_USER = { id: "test-admin", name: "测试管理员", isSuper: true };

/** 直调 procedure 的 caller(等价于服务端内部调用) */
export const caller = createCallerFactory(trpcRouter)({ user: TEST_USER });

/** **未登录**的 caller —— 用来断言"必须被拒"(在这之前根本没法测这一条) */
export const anonymousCaller = createCallerFactory(trpcRouter)({ user: null });

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

/**
 * 前缀判断**必须在 JS 里做**。
 *
 * ⚠️ 别写 `like(col, "__test__%")`:SQL 的 `LIKE` 里 **`_` 是单字符通配符**,
 * 那个模式等于"任意 8 个字符开头",会命中**几乎所有值** —— 实测连演示账号
 * `admin@example.com` 都被算作测试数据删掉过。查询只按时间筛,前缀用字面 `startsWith`。
 */
function startsWithPrefix(value: unknown): boolean {
	return String(value ?? "").startsWith(TEST_PREFIX);
}

/**
 * 兜底清扫:删掉**上一次跑残留**的 `__test__*` 数据。
 *
 * 为什么要有它:`after()` 只在用例正常跑完时执行 —— 文件**加载就失败**(import 报错、建表语句挂掉)
 * 或进程被杀时它根本不会被调用,数据就留在库里了。实测漏过一次:14 个测试用户 + 12 个角色 +
 * 2 个部门 + 14 个菜单,而残留会让后续用例的断言变飘(比如"列表里第一行"变成了测试用户)。
 *
 * **并行安全**:只删**超过 30 分钟**的。`node --test` 按文件并行跑,同一次运行建的数据只有几秒大,
 * 另一个文件不可能误删它;而"上一次残留"必然早就超龄。要更保守就调大 `olderThanMinutes`。
 */
export async function sweepStaleTestData(olderThanMinutes = 30): Promise<number> {
	const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
	let removed = 0;

	// ── 用户(先清引用它的会话 / 登录方式 / 角色分配 / 部门成员)──
	const staleUsers = (
		await db.select({ id: sysUser.id, email: sysUser.email }).from(sysUser).where(lt(sysUser.createdAt, cutoff))
	).filter((row) => startsWithPrefix(row.email));
	if (staleUsers.length > 0) {
		const ids = staleUsers.map((row) => row.id);
		await db.delete(sysSession).where(inArray(sysSession.userId, ids));
		await db.delete(sysAccount).where(inArray(sysAccount.userId, ids));
		await db.delete(sysUserRole).where(inArray(sysUserRole.user_id, ids));
		await db.delete(sysUserDept).where(inArray(sysUserDept.user_id, ids));
		await db.delete(sysUser).where(inArray(sysUser.id, ids));
		removed += ids.length;
	}

	// ── 角色(先清授权与分配:两张表的外键都是 restrict)──
	const staleRoles = (
		await db.select({ id: sysRole.id, code: sysRole.code }).from(sysRole).where(lt(sysRole.create_time, cutoff))
	).filter((row) => startsWithPrefix(row.code));
	if (staleRoles.length > 0) {
		const ids = staleRoles.map((row) => row.id);
		await db.delete(sysRoleMenu).where(inArray(sysRoleMenu.role_id, ids));
		await db.delete(sysUserRole).where(inArray(sysUserRole.role_id, ids));
		await db.delete(sysRole).where(inArray(sysRole.id, ids));
		removed += ids.length;
	}

	// ── 菜单(同样要先清授权行)──
	const staleMenus = (
		await db.select({ id: sysMenu.id, name: sysMenu.name }).from(sysMenu).where(lt(sysMenu.create_time, cutoff))
	).filter((row) => startsWithPrefix(row.name));
	if (staleMenus.length > 0) {
		const ids = staleMenus.map((row) => row.id);
		await db.delete(sysRoleMenu).where(inArray(sysRoleMenu.menu_id, ids));
		await db.delete(sysMenu).where(inArray(sysMenu.id, ids));
		removed += ids.length;
	}

	// ── 部门(带子节点,从深到浅删)──
	const staleDepts = (
		await db.select({ id: sysDept.id, name: sysDept.name }).from(sysDept).where(lt(sysDept.create_time, cutoff))
	).filter((row) => startsWithPrefix(row.name));
	if (staleDepts.length > 0) {
		const all = await db.select({ id: sysDept.id, parentId: sysDept.parent_id }).from(sysDept);
		const doomed = new Set(staleDepts.map((row) => row.id));
		let grew = true;
		while (grew) {
			grew = false;
			for (const row of all) {
				if (row.parentId && doomed.has(row.parentId) && !doomed.has(row.id)) {
					doomed.add(row.id);
					grew = true;
				}
			}
		}
		const list = [...doomed];
		await db.delete(sysUserDept).where(inArray(sysUserDept.department_id, list));
		for (let i = list.length - 1; i >= 0; i -= 1) {
			await db.delete(sysDept).where(eq(sysDept.id, list[i] as string));
		}
		removed += list.length;
	}

	// ── 审计日志:两类都要清 —— ① `operator_id = "test-admin"`(内部 caller 的标记,没有 __test__ 前缀);
	//     ② operator 是**测试自己建的账号**(`__test__u-…`,demo-grid / data-scope 那些用例用的 caller)。
	//     审计是只增不改的表,漏一类就会一直堆(实测每跑一轮漏 ~6 行)。
	const staleLogs = await db
		.select({ id: sysLog.id, operatorId: sysLog.operator_id })
		.from(sysLog)
		.where(lt(sysLog.create_time, cutoff));
	const logIds = staleLogs
		.filter((row) => row.operatorId === TEST_USER.id || startsWithPrefix(row.operatorId))
		.map((row) => row.id);
	if (logIds.length > 0) {
		await db.delete(sysLog).where(inArray(sysLog.id, logIds));
		removed += logIds.length;
	}

	// ── 三张「配置类」表(键 / 编码带前缀,清理它们没有引用问题)──
	const staleParas = (
		await db.select({ key: sysPara.para_key }).from(sysPara).where(lt(sysPara.create_time, cutoff))
	).filter((row) => startsWithPrefix(row.key));
	if (staleParas.length > 0) {
		await db.delete(sysPara).where(inArray(sysPara.para_key, staleParas.map((row) => row.key)));
		removed += staleParas.length;
	}

	const staleDicts = (
		await db
			.select({ code: sysDict.code, name: sysDict.name })
			.from(sysDict)
			.where(lt(sysDict.create_time, cutoff))
	).filter((row) => startsWithPrefix(row.name));
	if (staleDicts.length > 0) {
		await db.delete(sysDict).where(inArray(sysDict.code, staleDicts.map((row) => row.code)));
		removed += staleDicts.length;
	}

	const staleTags = (
		await db.select({ id: sysTag.id, label: sysTag.label }).from(sysTag).where(lt(sysTag.create_time, cutoff))
	).filter((row) => startsWithPrefix(row.label));
	if (staleTags.length > 0) {
		await db.delete(sysTag).where(inArray(sysTag.id, staleTags.map((row) => row.id)));
		removed += staleTags.length;
	}

	return removed;
}

/**
 * 每个测试文件 import 本文件时**自动**跑一次兜底清扫(见上)。
 *
 * 放在顶层 await 而不是 `before()` 里:单个文件的 `before()` 在**加载失败**时同样不会执行 ——
 * 而那正是残留的来源。失败不阻断测试(打一行警告就继续),否则清扫自己会成为新的"全挂"原因。
 */
try {
	const swept = await sweepStaleTestData();
	if (swept > 0) console.warn(`[tests] 兜底清扫:删掉了上次残留的 ${swept} 行测试数据`);
} catch (error) {
	console.warn(`[tests] 兜底清扫跳过:${(error as Error).message}`);
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
