import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";
import { sysLog, sysMenu } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { PERM_BY_PATH, pagePermOf, UNMAPPED_MUTATIONS, UNMAPPED_QUERIES } from "../src/lib/rbac.ts";
import { anonymousCaller, assertRejects, caller, closeDb, TEST_PREFIX, TEST_USER, uniqueSuffix } from "./helpers.ts";

/**
 * 服务端鉴权 + 审计。
 *
 * 这组用例的存在本身就是这批改造的产物:`anonymousCaller` 能直接断言"未登录必须被拒" ——
 * 在那之前测试直调没有请求上下文,根本没法测硬校验。
 */
const SUFFIX = uniqueSuffix();
const createdLogIds: string[] = [];

const def = (trpcRouter as unknown as { _def: { procedures: Record<string, { _def?: { type?: string } }> } })._def;
const PROCEDURES = Object.keys(def.procedures ?? {});
const typeOf = (path: string) => (def.procedures[path] as { _def?: { type?: string } } | undefined)?._def?.type;
/** `PERM_BY_PATH` 里所有的码(值可以是单个码,也可以是"任一页面可见即放行"的页面码数组) */
function mappedCodes(): string[] {
	return [
		...new Set(Object.values(PERM_BY_PATH).flatMap((mapped) => (typeof mapped === "string" ? [mapped] : [...mapped]))),
	];
}
/**
 * ⚠️ 审计行是**全局累积**的,而且 `node --test` **按文件并行** ——
 * 别的测试文件同一时刻也在 `role.create`。所以断言必须**只认自己那条**:
 * 用本文件唯一的 `code` 去 `target` 里过滤,别数"这个 path 下总共几条"。
 */
async function waitForOwnLog(path: string, marker: string): Promise<typeof sysLog.$inferSelect | null> {
	for (let i = 0; i < 40; i += 1) {
		const rows = await db.select().from(sysLog).where(eq(sysLog.path, path));
		const hit = rows.find((row) => (row.target ?? "").includes(marker));
		if (hit) {
			createdLogIds.push(hit.id);
			return hit;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return null;
}

after(async () => {
	if (createdLogIds.length > 0) {
		for (const id of createdLogIds) await db.delete(sysLog).where(eq(sysLog.id, id));
	}
	await closeDb();
});

describe("服务端鉴权", () => {
	it("未登录:受保护接口一律 UNAUTHORIZED(以前根本测不了这一条)", async () => {
		await assertRejects(() => anonymousCaller.role.list(), "请先登录");
		await assertRejects(() => anonymousCaller.file.list(), "请先登录");
		await assertRejects(() => anonymousCaller.role.remove({ id: "whatever" }), "请先登录");
	});

	it("未登录:会话路径上的写接口同样被拦(不只是读)", async () => {
		await assertRejects(() => anonymousCaller.dict.delete({ code: "whatever" }), "请先登录");
		await assertRejects(() => anonymousCaller.user.remove({ id: "whatever" }), "请先登录");
	});

	it("权限:有权限体系但这个账号没有该权限 ⇒ FORBIDDEN(不是只靠前端藏按钮)", async () => {
		const menus = await db.select().from(sysMenu);
		// 菜单表空 = 权限体系未启用 ⇒ 一律放行(与前端 useHasPerm 同口径),这条不适用
		if (menus.length === 0) return;

		// 不带 `isSuper` 的注入用户:库里没有任何角色授权 ⇒ 权限集是空集
		const nobody = createCallerFactory(trpcRouter)({ user: { id: "test-nobody", name: "无权用户" } });
		await assertRejects(() => nobody.log.list(), "没有权限");
		await assertRejects(() => nobody.role.create({ name: "不该建成", remark: "" }), "没有权限");
		await assertRejects(() => nobody.file.remove({ ids: ["whatever"] }), "没有权限");
		await assertRejects(() => nobody.notice.create({ userIds: ["x"], title: "不该发出" }), "没有权限");
		// 页面数据类读接口也必须硬拦(前端藏菜单只是表象 —— 记住 url 直接调接口才是真口子)
		await assertRejects(() => nobody.role.list(), "没有权限");
		await assertRejects(() => nobody.para.list(), "没有权限");
		await assertRejects(() => nobody.department.tree(), "没有权限");
		// 外壳级读接口不受影响:顶栏铃铛、侧栏与每页的偏好参数 —— 拦它们会让整站打不开
		await nobody.notice.list({ limit: 1 });
		await nobody.para.byKey({ key: "page.size" });
	});

	it("分类守卫:每个写接口必须显式分类(配了权限点 / 或在未配清单里)", () => {
		const mutations = PROCEDURES.filter((path) => typeOf(path) === "mutation");
		// 先确认守卫本身没有失效:写接口数量掉到 30 以下说明 router 结构变了,得回来看这里
		assert.ok(mutations.length >= 30, `写接口数量异常(${mutations.length}),守卫可能已失效`);
		const unclassified = mutations.filter((path) => !PERM_BY_PATH[path] && !UNMAPPED_MUTATIONS.includes(path));
		assert.deepEqual(
			unclassified,
			[],
			`新增写接口必须显式分类:要么在 PERM_BY_PATH 里配权限点,要么加进 UNMAPPED_MUTATIONS 并写清原因。漏了这些:${unclassified.join(", ")}`,
		);
	});

	it("分类守卫:每个读接口也必须显式分类(配了页面码 / 或在未配清单里)", () => {
		const queries = PROCEDURES.filter((path) => typeOf(path) === "query");
		// 先确认守卫本身没有失效:读接口数量掉到 15 以下说明 router 结构变了,得回来看这里
		assert.ok(queries.length >= 15, `读接口数量异常(${queries.length}),守卫可能已失效`);
		const unclassified = queries.filter((path) => !PERM_BY_PATH[path] && !UNMAPPED_QUERIES.includes(path));
		assert.deepEqual(
			unclassified,
			[],
			`新增读接口必须显式分类:要么在 PERM_BY_PATH 里配页面码,要么加进 UNMAPPED_QUERIES 并写清原因。漏了这些:${unclassified.join(", ")}`,
		);
	});

	it("权限映射里的码都必须真实存在(否则是「没人能被授予」的假权限)", async () => {
		const menus = await db.select().from(sysMenu);
		const perms = new Set(menus.map((menu) => menu.perm).filter((perm): perm is string => Boolean(perm)));
		// 空库(权限体系还没初始化)时这条不适用 —— 它防的是"配了码但忘了建按钮",不是"还没建表"
		if (perms.size === 0) return;
		/** `page:*:view` 是**合成码**(按可见菜单的路由算的),库里没有对应按钮,由下一条用例管 */
		const codes = mappedCodes().filter((code) => !code.startsWith("page:"));
		const missing = codes.filter((code) => !perms.has(code));
		assert.deepEqual(
			missing,
			[],
			`这些权限码在 sys_menu 里没有对应按钮,角色授权树里根本勾不到(等于假权限):${missing.join(", ")}`,
		);
	});

	it("合成的页面码必须对应真实的菜单路由(防页面路径拼错)", async () => {
		const paths = await db.select({ path: sysMenu.path }).from(sysMenu);
		if (paths.length === 0) return;
		const known = new Set(paths.map((row) => pagePermOf(row.path)));
		const orphan = mappedCodes().filter((code) => code.startsWith("page:") && !known.has(code));
		assert.deepEqual(orphan, [], `这些页面码没有对应的菜单路由,登记它的读接口永远没人调得动:${orphan.join(", ")}`);
	});

	it("权限映射里登记的路径都必须真实存在(防拼错路径名)", () => {
		for (const path of Object.keys(PERM_BY_PATH)) {
			assert.ok(PROCEDURES.includes(path), `PERM_BY_PATH 里有不存在的路径:${path}`);
		}
	});
});

describe("审计日志", () => {
	it("写接口留一行、查询一行都不留(否则列表刷新会把日志淹掉)", async () => {
		await caller.role.list();
		await caller.file.list();
		// 查询**永远**不写审计 ⇒ 这两个 path 在表里应该一行都没有(与并行无关,是确定性断言)
		assert.equal((await db.select().from(sysLog).where(eq(sysLog.path, "role.list"))).length, 0, "查询不该写审计");
		assert.equal((await db.select().from(sysLog).where(eq(sysLog.path, "file.list"))).length, 0, "查询不该写审计");

		const createdName = `${TEST_PREFIX}审计角色${SUFFIX}`;
		const created = await caller.role.create({ name: createdName, remark: "" });
		try {
			const row = await waitForOwnLog("role.create", createdName);
			assert.ok(row, "写调用要留下审计行");
			const entry = row as typeof sysLog.$inferSelect;
			assert.equal(entry.status, 1);
			assert.equal(entry.path, "role.create");
			assert.equal(entry.label, "新增角色", "动作名由 path 逐词翻译得到");
			assert.equal(entry.operator_id, TEST_USER.id);
			assert.equal(entry.operator_name, TEST_USER.name, "姓名要落快照(账号被删后日志仍读得懂)");
			assert.ok(entry.trace_id, "要带上 traceId,才能和 stdout 日志对上");
			// ⚠️ `role.create` 的入参里**没有 id**(它是服务端生成的)⇒ 目标描述只能挑到入参里真实存在的字段
			assert.ok((entry.target ?? "").includes(createdName), "目标描述要带上入参里能认出的字段(角色名)");
			assert.equal(entry.input?.includes(created.id), false, "入参快照就是入参,不该出现服务端生成的东西");
			assert.ok(entry.duration_ms !== null);
		} finally {
			await caller.role.remove({ id: created.id });
			const extra = await db.select().from(sysLog).where(eq(sysLog.path, "role.remove"));
			createdLogIds.push(...extra.map((row) => row.id));
		}
	});

	it("log.list:按动作筛 / 时间倒序 / 上限生效,且未登录不可读", async () => {
		await assertRejects(() => anonymousCaller.log.list(), "请先登录");

		const all = await caller.log.list();
		assert.ok(Array.isArray(all));
		if (all.length === 0) return; // 全新库、还没发生写调用时不适用

		for (let i = 1; i < all.length; i += 1) {
			const prev = new Date(all[i - 1]?.createTime ?? 0).getTime();
			const cur = new Date(all[i]?.createTime ?? 0).getTime();
			assert.ok(prev >= cur, "审计应按时间倒序");
		}

		const path = all[0]?.path as string;
		const only = await caller.log.list({ path });
		assert.ok(only.length >= 1);
		assert.ok(
			only.every((row) => row.path === path),
			"按动作筛之后不该混进别的路径",
		);

		assert.ok((await caller.log.list({ limit: 1 })).length <= 1, "limit 要生效");
		assert.ok((await caller.log.list({ keyword: path })).length >= 1, "搜索框那一端要能命中");
	});

	it("失败的写调用记 status=0(含错误码),且原来的报错照旧抛出", async () => {
		// 角色名现在是唯一可挑的入参关键字(已没有 code 字段)⇒ 用同一个 name 撞两次,第二次会被 CONFLICT 拒
		const failingName = `${TEST_PREFIX}审计失败_${SUFFIX}`;
		const first = await caller.role.create({ name: failingName, remark: "" });
		try {
			await assertRejects(() => caller.role.create({ name: failingName, remark: "" }), "");
			// 失败的这一次也会写一行:同 name 下应该出现 status=0 的那条
			let failedRow: typeof sysLog.$inferSelect | null = null;
			for (let i = 0; i < 40 && !failedRow; i += 1) {
				const rows = await db.select().from(sysLog).where(eq(sysLog.path, "role.create"));
				failedRow = rows.find((row) => (row.target ?? "").includes(failingName) && row.status === 0) ?? null;
				if (failedRow) createdLogIds.push(failedRow.id);
				else await new Promise((resolve) => setTimeout(resolve, 50));
			}
			assert.ok(failedRow, "失败的调用也应该留痕");
			assert.ok(failedRow?.error_code, "要记下错误码");
		} finally {
			await caller.role.remove({ id: first.id });
			const extra = await db.select().from(sysLog).where(eq(sysLog.path, "role.remove"));
			createdLogIds.push(...extra.map((row) => row.id));
		}
	});

	it("入参快照已脱敏:密码字段是 ***", async () => {
		const email = `${TEST_PREFIX}audit${SUFFIX}@example.com`;
		const created = await caller.user.create({
			name: `${TEST_PREFIX}审计用户${SUFFIX}`,
			email,
			password: "S3cret-Passw0rd",
		});
		try {
			const snapshot = (await waitForOwnLog("user.create", email))?.input ?? "";
			assert.ok(snapshot.includes("***"), `入参快照应已脱敏,实际:${snapshot.slice(0, 200)}`);
			assert.ok(!snapshot.includes("S3cret-Passw0rd"), "明文密码绝不能进审计");
		} finally {
			await caller.user.remove({ id: created.id });
			const extra = await db
				.select()
				.from(sysLog)
				.where(and(eq(sysLog.path, "user.create")));
			createdLogIds.push(...extra.map((row) => row.id));
		}
	});
});
