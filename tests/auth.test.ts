import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { and, eq, inArray } from "drizzle-orm";
import { sysAccount, sysLog, sysMenu, sysRole, sysSession, sysUser } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { ADMIN_ROLE_NAME } from "../src/lib/menu-spec.ts";
import {
	DATA_SCOPE_BY_PATH,
	PERM_BY_PATH,
	pagePermOf,
	UNMAPPED_MUTATIONS,
	UNMAPPED_QUERIES,
	UNSCOPED_QUERIES,
} from "../src/lib/rbac.ts";
import {
	anonymousCaller,
	assertRejects,
	caller,
	callerAs,
	closeDb,
	TEST_PREFIX,
	TEST_USER,
	uniqueSuffix,
} from "./helpers.ts";

/**
 * 服务端鉴权 + 审计。
 *
 * 这组用例的存在本身就是这批改造的产物:`anonymousCaller` 能直接断言"未登录必须被拒" ——
 * 在那之前测试直调没有请求上下文,根本没法测硬校验。
 */
const SUFFIX = uniqueSuffix();
const createdLogIds: string[] = [];
/** 「个人资料」用例造的真账号(`user.profile` 读的是 `sys_user` 真实行)—— 收尾连会话 / account 一起清 */
const createdUserIds: string[] = [];
/** 用例里建过的角色 —— `role.remove` 现在是软删,行会留在库里,收尾必须按 id 物理清 */
const createdRoleIds: string[] = [];

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
	// 空数组时循环本来就不跑,不用再套一层 if
	for (const id of createdLogIds) await db.delete(sysLog).where(eq(sysLog.id, id));
	// 子表 → 父表:session / account 先删,不然 `sys_user` 那行会留下孤儿会话
	for (const id of createdUserIds) {
		await db.delete(sysSession).where(eq(sysSession.userId, id));
		await db.delete(sysAccount).where(eq(sysAccount.userId, id));
		await db.delete(sysUser).where(eq(sysUser.id, id));
	}
	if (createdRoleIds.length > 0) await db.delete(sysRole).where(inArray(sysRole.id, createdRoleIds));
	await closeDb();
});

describe("服务端鉴权", () => {
	it("未登录:受保护接口一律 UNAUTHORIZED(以前根本测不了这一条)", async () => {
		await assertRejects(() => anonymousCaller.role.list(), "请先登录");
		await assertRejects(() => anonymousCaller.file.list(), "请先登录");
		await assertRejects(() => anonymousCaller.role.remove({ id: "whatever" }), "请先登录");
		// 个人资料页的读接口:它**不挂菜单授权**(没勾设置菜单的人也要能看自己),
		// 但"要登录"这条不能少 —— 否则任何人都能靠它探到别人的资料(它的 SQL 只认 ctx.user.id)
		await assertRejects(() => anonymousCaller.user.profile(), "请先登录");
	});

	it("未登录:会话路径上的写接口同样被拦(不只是读)", async () => {
		await assertRejects(() => anonymousCaller.dict.remove({ code: "whatever" }), "请先登录");
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

	it("管理员旁路(permMiddleware):持「系统管理员」角色的真账号 + 不授任何菜单 + ctx.isSuper=false → 受保护接口照样放行", async () => {
		// 「老 `ctx.isSuper` 旁路只在测试注入里有效,HTTP 路径上是死码」这一段历史的回归用例:
		// ctx.isSuper 在生产里没人设(库里没列;BA 不写;getCurrentUser 只返 id/name),所以"靠 ctx.isSuper 短路"
		// 在真账号上根本没机会跑。修法是 `permMiddleware` 直接按 user.id 查「系统管理员」角色。
		// 这里用一个真账号 + 真角色分配来验,**故意**不勾任何菜单 + ctx 不带 isSuper —— 模拟真 HTTP 请求。
		const menus = await db.select().from(sysMenu);
		if (menus.length === 0) return; // 未初始化时这条不适用

		const role = await caller.role.create({
			name: `${TEST_PREFIX}超管测试_${SUFFIX}`,
			remark: "admin bypass test",
		});
		createdRoleIds.push(role.id);
		// ⚠️ 不授任何菜单 —— 关键点:就算 `sys_casbin_rule` 里这个角色一条 `p` 行都没有,
		// admin 也得能调受保护的接口(否则就是"还得手动勾菜单",违背 admin 的本意)。
		const user = await caller.user.create({
			name: `${TEST_PREFIX}超管测试用户${SUFFIX}`,
			email: `${TEST_PREFIX}adminbypass-${SUFFIX}@example.com`,
			password: "Passw0rd123",
		});
		createdUserIds.push(user.id);
		// 复用 prod seed 的「系统管理员」角色 —— 直接把这个 user 挂上去即可,免去与 seed
		// 同名冲突(库对 name 有唯一索引 `uk_sys_role_name`)。这条用例不是测"造一个 admin 角色"——
		// 是测"真账号持 admin 角色,缺授权,permMiddleware 仍放行"这条用 admin bypass 的语义。
		const adminRoleRow = (await caller.role.list()).find((r) => r.name === ADMIN_ROLE_NAME);
		if (!adminRoleRow) {
			// 没 seed 时本用例前提不成立 —— 跳过,别让测试挂掉基础设施
			console.warn("[auth] 未找到 prod seed 的「系统管理员」角色,跳过 admin bypass 测试");
			return;
		}
		const realAdminRoleId = adminRoleRow.id;
		// 把 user 分配到这个角色 —— 走 caller.user.update,与产品路径一致
		const me = (await caller.user.list()).find((row) => row.id === user.id);
		assert.ok(me, "用户应该被查到");
		await caller.user.update({
			id: user.id,
			name: me.name,
			email: me.email,
			image: me.image ?? "",
			emailVerified: me.emailVerified ?? false,
			roleIds: [realAdminRoleId],
			departmentIds: me.departmentIds ?? [],
		});

		// 走 callerAs 注入 ctx.user,**故意不带 isSuper** —— 这是"模拟 HTTP 路径"的关键。
		// 老 `if (user?.isSuper) return next()` 在此不会命中,只能走新的 `isAdminUser(user.id)` 真查路径。
		const realAdmin = callerAs({ id: user.id, name: user.name, isSuper: false });
		await realAdmin.role.list();
		await realAdmin.department.tree();
		await realAdmin.log.list();
		// 对照:同样注入 id 但**不是 admin** 的真账号,这条接口照旧被拒
		const other = await caller.user.create({
			name: `${TEST_PREFIX}非超管对照${SUFFIX}`,
			email: `${TEST_PREFIX}notadmin-${SUFFIX}@example.com`,
			password: "Passw0rd123",
		});
		createdUserIds.push(other.id);
		const otherCaller = callerAs({ id: other.id, name: other.name, isSuper: false });
		await assertRejects(() => otherCaller.role.list(), "没有权限");
	});

	it("管理员旁路(dataScopeMiddleware):scope() 给 admin 直接返 undefined,不再走行级过滤", async () => {
		// 数据权限(行级)与功能权限(菜单级)是**两层**,admin 两层都得放行。
		// 走 TEST_USER(它有 isSuper=true,isAdminUser(userId, isSuper=true) 也走 admin 旁路);
		// `demoGrid.list` 是当前**唯一一个**登记在 `DATA_SCOPE_BY_PATH` 的接口,验的就是它。
		await caller.demoGrid.list();
		// 对照:`anonymous` 没 ctx.user,scope 仍按未授权处理
		await assertRejects(() => anonymousCaller.demoGrid.list(), "请先登录");
	});

	it("个人资料:只读自己那一行,roles / depts 永远给数组(个人资料页的数据源)", async () => {
		// 注入的 `test-admin` **不是库里的账号**(见 helpers.ts),而 `user.profile` 读的是 `sys_user` 真实行,
		// 所以这里先造一个真账号(邮箱带 `__test__` 前缀;收尾在 `after` 里连会话 / account 一起删)。
		const created = await caller.user.create({
			name: `${TEST_PREFIX}资料页`,
			email: `${TEST_PREFIX}profile-${SUFFIX}@example.com`,
			password: "Passw0rd123",
		});
		createdUserIds.push(created.id);
		const asSelf = callerAs({ id: created.id, name: created.name });
		const me = await asSelf.user.profile();
		assert.equal(me.id, created.id);
		assert.equal(me.email, created.email);
		assert.equal(me.emailVerified, false, "刚建出来的账号还没验证邮箱");
		assert.deepEqual(me.roles, [], "没有角色 ⇒ 空数组(不是 null)");
		assert.deepEqual(me.depts, [], "没有部门 ⇒ 空数组(不是 null)");
		// 身份取的是会话(注入的 ctx.user),不接受入参 —— 所以"换成别人"在接口层就不可能
		assert.equal(me.name, created.name);
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

	/**
	 * 数据范围(行级)与权限是**两层**:上面两条守卫管"能不能调",这条管"同一个接口里能看到哪些行"。
	 * 它拦的是最容易出的错 —— 新加一个读接口,忘了想"这个接口要不要按部门 / 本人筛",于是默认就看全部。
	 */
	it("数据范围守卫:每个读接口必须显式分类(登记了资源 / 或在未做清单里)", () => {
		const queries = PROCEDURES.filter((path) => typeOf(path) === "query");
		const unclassified = queries.filter((path) => !DATA_SCOPE_BY_PATH[path] && !UNSCOPED_QUERIES.includes(path));
		assert.deepEqual(
			unclassified,
			[],
			`新增读接口必须显式归类:要么在 DATA_SCOPE_BY_PATH 里登记资源并在 resolver 里用 ctx.scope(),要么加进 UNSCOPED_QUERIES 并写清属于哪一类。漏了这些:${unclassified.join(", ")}`,
		);
		// 反向断言:表里不能留已经不存在的接口(改名 / 删接口后忘了清,守卫就形同虚设)
		const known = new Set(queries);
		const stale = [...Object.keys(DATA_SCOPE_BY_PATH), ...UNSCOPED_QUERIES].filter((path) => !known.has(path));
		assert.deepEqual(stale, [], `这两张表里有已经不存在的读接口(改名 / 删除后没清):${stale.join(", ")}`);
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
		createdRoleIds.push(created.id);
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
		createdRoleIds.push(first.id);
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
		createdUserIds.push(created.id);
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
