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
import { createHash } from "node:crypto";

import { and, eq, inArray, lt } from "drizzle-orm";

import {
	casbinRule,
	sysAccount,
	sysDataPolicy,
	sysDept,
	sysUserDept,
	sysDict,
	sysMenu,
	sysPara,
	sysRole,
	sysLog,
	sysSession,
	sysTag,
	sysUser,
} from "../src/db/data-base-schema.ts";
import { db, dmPool } from "../src/db/index.ts";
import { flushAuditWrites } from "../src/lib/audit.ts";
import { clearCasbinCache } from "../src/lib/casbin.ts";
import { clearDataPolicyCache } from "../src/lib/data-policy.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";

/** 测试数据统一前缀:方便一眼认出、也方便误留时清理 */
export const TEST_PREFIX = "__test__";

/**
 * 测试数据用的唯一后缀 —— **固定 10 字符**(毫秒戳 8 + 随机 2)。
 *
 * 为什么定长:`testId` 按列宽算「中间留多少字符给业务标签」,尾段必须是定长才能算预算。
 * `Date.now().toString(36)` 已 8 位,随机段补 0 到 2 位,合起来恰好 10。冲突概率:
 * 同毫秒内撞上同一随机段 ≈ 1/1296,作为 fixture 标识够用了 —— 实测重复跑不会撞。
 */
export function uniqueSuffix(): string {
	const t = Date.now().toString(36).padStart(8, "0").slice(-8);
	const r = Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
	return t + r;
}

/**
 * 测试主键(`sys_dept.id`/`sys_user.id`/`sys_user_dept.id` …)。
 *
 * ⚠️ **必须守住列宽**:模板里这些 id 列多为 `varchar(32)`(`sys_user.*` 是 36)。
 * 直接拼 `${TEST_PREFIX}${kind}-${label}-${suffix}` 会在 `label` 是中文长名(`角色规则-甲镇网格组`)
 * 时超长,MySQL 报 `ER_DATA_TOO_LONG` ⇒ 这条 fixture 插不进库,整条用例就挂。
 * 达梦上之所以"看起来过得了",只是因为那台库是早期更宽的字段版本 —— 不应该让测试依赖**库**的宽松。
 *
 * 策略:算清预算,中间段塞得下就用原文(读性好),塞不下就**截 + 短散列**(确定性去重,
 * 同一个 label 在同一文件里截出来的结果一致)。
 */
export function testId(kind: string, label: string, suffix: string, maxLength = 32): string {
	const head = `${TEST_PREFIX}${kind}-`;
	const tail = `-${suffix}`;
	const room = maxLength - head.length - tail.length;
	if (label.length <= room) return `${head}${label}${tail}`;
	// 截中间:`head + 截 label + 分隔 + 短散列 + tail`
	const hashLen = 6;
	const keep = Math.max(1, room - 1 - hashLen);
	const hash = createHash("sha1").update(`${kind}|${label}|${suffix}`).digest("base64url").slice(0, hashLen);
	return `${head}${label.slice(0, keep)}-${hash}${tail}`;
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

/**
 * 直接往 `sys_data_policy` 插一行策略(测试用)。
 *
 * 业务代码写策略只走 `lib/data-policy.ts` 的 `grantRow` / `grantOrg`(它们会清缓存);
 * 这里是为了造"迁移脚本写出来的那种行"(角色规则 / 部门规则),并顺手清掉 30 秒缓存 ——
 * 不清的话测试要等缓存过期才能看到效果。
 */
export async function putPolicyRow(v0: string, v1: string, v2 = "*", v3 = "allow", status = 1): Promise<string> {
	const policyId = `${TEST_PREFIX}p-${uniqueSuffix()}`;
	await db.insert(sysDataPolicy).values({ id: policyId, ptype: "p", v0, v1, v2, v3, status, remark: TEST_PREFIX, create_time: new Date(), update_time: new Date() });
	clearDataPolicyCache();
	return policyId;
}

/**
 * 清掉测试留下的策略行 —— 三种写法都要清:按 id(`putPolicyRow` 返回的)、
 * 按主体(测试账号)、按资源(测试网格,`grantRow` 写的是这种)。
 */
export async function deleteTestPolicies(ids: readonly string[], userIds: readonly string[] = [], gridIds: readonly string[] = []): Promise<void> {
	if (ids.length > 0) await db.delete(sysDataPolicy).where(inArray(sysDataPolicy.id, [...ids]));
	if (userIds.length > 0) await db.delete(sysDataPolicy).where(inArray(sysDataPolicy.v0, userIds.map((userId) => `user:${userId}`)));
	if (gridIds.length > 0) await db.delete(sysDataPolicy).where(inArray(sysDataPolicy.v1, gridIds.map((gridId) => `demo_grid@${gridId}`)));
}

/**
 * 清掉**这些操作人**留下的审计行(测试身份写的那些)。
 *
 * 必须先 `await flushAuditWrites()`:审计是 fire-and-forget,`after()` 常常比写库还快 ——
 * 不先等它落地,删的时候一行都查不到,然后就永久留在库里(实测漏过 14 行,
 * `operator_id` 是 `__test__u-队员A-…`,`path` 是 `demoGrid.update/remove/assign`)。
 * 按**精确 id** 删,不做模糊匹配:测试用户的 id 带唯一后缀,不可能撞到真实数据。
 */
export async function purgeTestAuditRows(operatorIds: readonly string[]): Promise<number> {
	await flushAuditWrites();
	const ids = [...operatorIds];
	if (ids.length === 0) return 0;
	const rows = await db.select({ id: sysLog.id }).from(sysLog).where(inArray(sysLog.operator_id, ids));
	if (rows.length === 0) return 0;
	await db.delete(sysLog).where(
		inArray(
			sysLog.id,
			rows.map((row) => row.id),
		),
	);
	return rows.length;
}

/**
 * 给**合成的**管理员身份(`TEST_USER.id` 这个人在库里不存在)补一条无限制策略行。
 *
 * 为什么需要:策略表一旦「已启用」(库里真有启用中的行),引擎就是**失败关闭**的 —— 认不出的主体
 * 一条数据都看不到 ⇒ 测试里 `(await caller.user.list()).find(...)` 这种取行的老写法会拿到 undefined。
 * 引擎不校验主体里的人是否存在,所以给 `user:test-admin` 一条 `*` 恰好等于"不过滤"(与表空时一致)。
 *
 * 幂等:并行跑的文件可能同时走到这里,唯一键会挡下第二次插入 —— 确认行还在就当作成功。
 */
export async function ensureTestAdminPolicy(): Promise<void> {
	const subject = `user:${TEST_USER.id}`;
	const found = async (): Promise<boolean> => {
		const [row] = await db
			.select({ id: sysDataPolicy.id })
			.from(sysDataPolicy)
			.where(and(eq(sysDataPolicy.v0, subject), eq(sysDataPolicy.v1, "*"), eq(sysDataPolicy.status, 1)));
		return row !== undefined;
	};
	if (await found()) return;
	try {
		await db.insert(sysDataPolicy).values({
			id: "test-admin-policy",
			ptype: "p",
			v0: subject,
			v1: "*",
			v2: "*",
			v3: "allow",
			status: 1,
			remark: "测试直调用注入的合成身份(见 tests/helpers.ts)",
			create_time: new Date(),
			update_time: new Date(),
		});
	} catch (error) {
		if (!(await found())) throw error;
	}
	clearDataPolicyCache();
}

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
async function sweepStaleTestData(olderThanMinutes = 30): Promise<number> {
	const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
	let removed = 0;

	// ── 数据权限策略行:测试写的两种都指向测试数据(按人授权的 `user:__test__…` / 资源 `demo_grid@__test__…`
	//     或者是前缀打头的角色 code)⇒ 主体或资源里带前缀的就是测试留下的,先删(没有外键,顺序随便)──
	const stalePolicies = (
		await db
			.select({ id: sysDataPolicy.id, v0: sysDataPolicy.v0, v1: sysDataPolicy.v1 })
			.from(sysDataPolicy)
			.where(lt(sysDataPolicy.create_time, cutoff))
	).filter((row) => row.v0.includes(TEST_PREFIX) || row.v1.includes(TEST_PREFIX));
	if (stalePolicies.length > 0) {
		await db.delete(sysDataPolicy).where(inArray(sysDataPolicy.id, stalePolicies.map((row) => row.id)));
		removed += stalePolicies.length;
	}

	// ── 用户(先清引用它的会话 / 登录方式 / 角色分配 / 部门成员)──
	const staleUsers = (
		await db.select({ id: sysUser.id, email: sysUser.email }).from(sysUser).where(lt(sysUser.createdAt, cutoff))
	).filter((row) => startsWithPrefix(row.email));
	if (staleUsers.length > 0) {
		const ids = staleUsers.map((row) => row.id);
		await db.delete(sysSession).where(inArray(sysSession.userId, ids));
		await db.delete(sysAccount).where(inArray(sysAccount.userId, ids));
		await db.delete(casbinRule).where(
			and(eq(casbinRule.ptype, "g"), inArray(casbinRule.v0, ids.map((id) => `user:${id}`))),
		);
		await db.delete(sysUserDept).where(inArray(sysUserDept.user_id, ids));
		await db.delete(sysUser).where(inArray(sysUser.id, ids));
		removed += ids.length;
	}

	// ── 角色(先清策略表里指向它的行:授权是 `p` 行的 v0,成员关系与角色继承是 `g` 行的 v1 / v0)──
	const staleRoles = (
		await db.select({ id: sysRole.id, code: sysRole.code }).from(sysRole).where(lt(sysRole.create_time, cutoff))
	).filter((row) => startsWithPrefix(row.code));
	if (staleRoles.length > 0) {
		const ids = staleRoles.map((row) => row.id);
		const subjects = staleRoles.map((row) => `role:${row.code}`);
		await db.delete(casbinRule).where(and(eq(casbinRule.ptype, "p"), inArray(casbinRule.v0, subjects)));
		await db.delete(casbinRule).where(and(eq(casbinRule.ptype, "g"), inArray(casbinRule.v1, subjects)));
		await db.delete(casbinRule).where(and(eq(casbinRule.ptype, "g"), inArray(casbinRule.v0, subjects)));
		await db.delete(sysRole).where(inArray(sysRole.id, ids));
		removed += ids.length;
	}

	// ── 菜单(同样要先清授权行)──
	const staleMenus = (
		await db.select({ id: sysMenu.id, name: sysMenu.name }).from(sysMenu).where(lt(sysMenu.create_time, cutoff))
	).filter((row) => startsWithPrefix(row.name));
	if (staleMenus.length > 0) {
		const ids = staleMenus.map((row) => row.id);
		await db.delete(casbinRule).where(
			and(eq(casbinRule.ptype, "p"), inArray(casbinRule.v1, ids.map((id) => `menu:${id}`))),
		);
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
	//     ② operator 是**测试自己建的账号**(`__test__u-…`,demo-grid / data-policy 那些用例用的 caller)。
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

	// 上面删的都是**裸 SQL 或直接删表**,绕过了 `lib/casbin.ts` 的领域函数 ⇒ 判定缓存可能还留着旧策略
	if (removed > 0) clearCasbinCache();
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
