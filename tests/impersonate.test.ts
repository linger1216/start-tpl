/**
 * 「切换用户」端点(运维用,`lib/auth-debug.ts`)—— 集成测试。
 *
 * 覆盖:有权限的人能切(切完**是真的目标身份**,拿新 cookie 查 `getSession` 验)、
 * 没权限的人被 403 **且不会给对方建会话**、未登录 401、切自己 400、目标不存在 404。
 *
 * 为什么值得单测:这条路用的是 BA 的**内部适配器**(`ctx.context.internalAdapter.createSession`)
 * 与 cookie 助手(`setSessionCookie`)—— 官方 admin 插件的 `impersonateUser` 也是同一套写法。
 * 它**不在 BA 的公开 API 面上**,升级 better-auth 后可能悄悄变;`pnpm typecheck` 抓不到这种变化,
 * 只有这条"真的切一次,再看会话是谁"的用例能抓到。**升级 BA 后请重跑它。**
 *
 * ⚠️ 会读写真实库。夹具**自带**(自己建账号 / 角色 / 授权),不依赖演示账号与密码;`after` 里只清自己造的。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { sysCasbinRule, sysAccount, sysMenu, sysRole, sysSession, sysUser } from "../src/db/data-base-schema.ts";
import { auth } from "../src/lib/auth.ts";
import { clearCasbinCache } from "../src/lib/casbin.ts";
import { newId } from "../src/lib/ids.ts";
import { IMPERSONATE_PERM, MENU_TYPE } from "../src/lib/menu-spec.ts";
import { closeDb, TEST_PREFIX } from "./helpers.ts";

const SUFFIX = `${Date.now().toString(36)}`;
const PASSWORD = "Passw0rd!123";
const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];
const createdMenuIds: string[] = [];

/** 从 set-cookie 里抠出 `name=value` 那一截 */
function cookieOf(res: Response): string {
	return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** ⚠️ 切换的响应里可能有**两个** cookie(新会话 + 原身签名 cookie),必须都带上 */
function cookiesOf(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((raw) => raw.split(";")[0])
		.filter(Boolean)
		.join("; ");
}

/** 建一个 `__test__` 账号,并**立刻删掉注册时顺手建的会话**(否则下一个请求就是它的身份) */
async function makeUser(label: string): Promise<{ id: string; email: string }> {
	const email = `${TEST_PREFIX}imp_${label}_${SUFFIX}@example.com`;
	const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: `${TEST_PREFIX}${label}` } });
	createdUserIds.push(res.user.id);
	await db.delete(sysSession).where(eq(sysSession.userId, res.user.id));
	return { id: res.user.id, email };
}

/** 拿到某个账号的会话 cookie(走真实登录接口) */
async function signInCookie(email: string): Promise<string> {
	const res = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
	return cookieOf(res);
}

/** 该用户的会话行数(用来断言"被拒时不建会话") */
async function sessionCount(userId: string): Promise<number> {
	const rows = await db.select({ id: sysSession.id }).from(sysSession).where(eq(sysSession.userId, userId));
	return rows.length;
}

/** 夹具:`perm = sys:user:impersonate` 的菜单行(库里已有就用;没有就自己建一个,并登记待清理) */
async function impersonateMenuId(): Promise<string> {
	const [existing] = await db
		.select({ id: sysMenu.id })
		.from(sysMenu)
		.where(and(eq(sysMenu.perm, IMPERSONATE_PERM), eq(sysMenu.type, MENU_TYPE.BUTTON)))
		.limit(1);
	if (existing) return existing.id;
	const id = newId();
	await db.insert(sysMenu).values({
		id,
		parent_id: null,
		name: `${TEST_PREFIX}切换用户`,
		path: `${TEST_PREFIX}imp_${SUFFIX}`,
		icon: null,
		sort: 0,
		visible: 1,
		status: 1,
		type: MENU_TYPE.BUTTON,
		perm: IMPERSONATE_PERM,
	});
	createdMenuIds.push(id);
	return id;
}

/** 给某个人授上「切换用户」权限(自己建角色 + 授权,保底不改动别人的数据) */
async function grantImpersonate(userId: string): Promise<void> {
	const roleId = newId();
	createdRoleIds.push(roleId);
	// 角色按名字去重(`sys_role` 没有 code 列,这里用「imp + 测试后缀 + userId 后缀」当唯一名字)
	const roleName = `${TEST_PREFIX}imp_${SUFFIX}_${userId.slice(-6)}`;
	await db.insert(sysRole).values({
		id: roleId,
		name: roleName,
		sort: 0,
		status: 1,
	});
	// 授权与成员关系现在都是策略表的行:授权 = `p` 行(客体是菜单),成员 = `g` 行(主体是人)
	await db.insert(sysCasbinRule).values({
		id: newId(),
		ptype: "p",
		v0: `role:${roleId}`,
		v1: `menu:${await impersonateMenuId()}`,
		v2: "access",
	});
	await db.insert(sysCasbinRule).values({
		id: newId(),
		ptype: "g",
		v0: `user:${userId}`,
		v1: `role:${roleId}`,
		v2: "",
	});
	// 直接写表、绕过了 `lib/casbin.ts` 的领域函数 ⇒ 手动刷缓存,否则判定还停在旧策略上
	clearCasbinCache();
}

/** 把某人的「切换用户」授权撤掉(删掉那条用户-角色关联)—— 验证例外不会变成永久通行证 */
async function revokeImpersonate(userId: string): Promise<void> {
	await db
		.delete(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, "g"), eq(sysCasbinRule.v0, `user:${userId}`)));
	clearCasbinCache();
}

/**
 * 清尾:**一步失败不跳过后面的**(只告警、不再抛)。
 *
 * 为什么不用裸 `await` 串下来:清理是"删自己造的夹具",与用例结论无关;
 * 而**只要中间一步抛了,后面的删除就全被跳过** —— 实测一次偶发失败就漏下 8 个
 * `__test__imp_*` 账号 + 对应角色,还得等下一轮(30 分钟后)兜底清扫才收掉。
 * 顺序仍然是先子后父(session / account / user_role → role_menu / role → user → menu),
 * 否则外键 restrict 会拦。
 */
async function cleanupStep(label: string, fn: () => Promise<unknown>): Promise<void> {
	try {
		await fn();
	} catch (error) {
		console.warn(`[cleanup] ${label} 失败(继续清后面的):${(error as Error).message}`);
	}
}

after(async () => {
	if (createdUserIds.length > 0) {
		await cleanupStep("删除会话", () => db.delete(sysSession).where(inArray(sysSession.userId, createdUserIds)));
		await cleanupStep("删除 account", () => db.delete(sysAccount).where(inArray(sysAccount.userId, createdUserIds)));
		await cleanupStep("删除 user_role", () =>
			db
				.delete(sysCasbinRule)
				.where(
					and(eq(sysCasbinRule.ptype, "g"), inArray(sysCasbinRule.v0, createdUserIds.map((userId) => `user:${userId}`))),
				),
		);
	}
	if (createdRoleIds.length > 0) {
		const subjects = createdRoleIds.map((roleId) => `role:${roleId}`);
		await cleanupStep("删除 role_menu", () =>
			db.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, "p"), inArray(sysCasbinRule.v0, subjects))),
		);
		await cleanupStep("删除角色继承", () =>
			db.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, "g"), inArray(sysCasbinRule.v1, subjects))),
		);
		await cleanupStep("删除 role", () => db.delete(sysRole).where(inArray(sysRole.id, createdRoleIds)));
	}
	if (createdUserIds.length > 0)
		await cleanupStep("删除 user", () => db.delete(sysUser).where(inArray(sysUser.id, createdUserIds)));
	if (createdMenuIds.length > 0)
		await cleanupStep("删除 menu", () => db.delete(sysMenu).where(inArray(sysMenu.id, createdMenuIds)));
	// 上面都是直接删表,绕过了 `lib/casbin.ts` 的领域函数 → 判定缓存要手动刷
	clearCasbinCache();
	await cleanupStep("关闭连接", () => closeDb());
});

test("切换用户:有权限的人能切,切完拿新 cookie 查会话就是目标身份", async () => {
	const operator = await makeUser("operator");
	await grantImpersonate(operator.id);
	const target = await makeUser("target");

	const cookie = await signInCookie(operator.email);
	assert.ok(cookie, "操作者登录成功");

	const res = await auth.api.switchUser({
		body: { userId: target.id },
		headers: new Headers({ cookie }),
		asResponse: true,
	});
	assert.equal(res.status, 200, "有权限 → 200(不是 403)");

	const switched = cookieOf(res);
	assert.ok(switched, "响应里带回了新的会话 cookie");
	assert.notEqual(switched, cookie, "cookie 已经换成新身份的");

	const session = await auth.api.getSession({ headers: new Headers({ cookie: switched }) });
	assert.equal(session?.user.id, target.id, "换完 cookie 之后,会话就是**目标用户**");
	assert.equal(session?.user.email, target.email, "连邮箱也是目标的");
});

test("切换用户:没权限 → 403,而且**不会给目标建会话**", async () => {
	const plain = await makeUser("plain"); // 没有任何角色
	const victim = await makeUser("victim");

	const cookie = await signInCookie(plain.email);
	const before = await sessionCount(victim.id);

	const res = await auth.api.switchUser({
		body: { userId: victim.id },
		headers: new Headers({ cookie }),
		asResponse: true,
	});
	assert.equal(res.status, 403, "没有 sys:user:impersonate → 403");

	const after = await sessionCount(victim.id);
	assert.equal(after, before, "被拒的时候什么都不该发生(不给对方建会话)");
});

test("切换用户:切成没有该权限的人之后,仍然能切回原身(否则人被困住)", async () => {
	const operator = await makeUser("undo_op");
	await grantImpersonate(operator.id);
	const target = await makeUser("undo_target"); // 故意**不**授切换权限

	const cookie = await signInCookie(operator.email);
	const res = await auth.api.switchUser({
		body: { userId: target.id },
		headers: new Headers({ cookie }),
		asResponse: true,
	});
	assert.equal(res.status, 200);
	const asTargetCookies = cookiesOf(res);
	assert.ok(asTargetCookies.includes("impersonator_id"), "响应里带上了「原身」签名 cookie");

	const asTarget = await auth.api.getSession({ headers: new Headers({ cookie: asTargetCookies }) });
	assert.equal(asTarget?.user.id, target.id, "此刻是目标身份(它自己没有切换权限)");

	// 关键:用**目标身份**切回原身 —— 必须放行(这是"防困住"的那条例外)
	const undo = await auth.api.switchUser({
		body: { userId: operator.id },
		headers: new Headers({ cookie: asTargetCookies }),
		asResponse: true,
	});
	assert.equal(undo.status, 200, "切回原身不受权限限制");
	const back = await auth.api.getSession({ headers: new Headers({ cookie: cookiesOf(undo) }) });
	assert.equal(back?.user.id, operator.id, "回到了原身");

	// 原身份有权限 ⇒ **带着它的签名 cookie 可以继续切别人**(等价于原身份本人在操作)
	// 这不是提权:下面一条会验证「原身份被撤权后就不行了」。
	const other = await makeUser("undo_other");
	const onward = await auth.api.switchUser({
		body: { userId: other.id },
		headers: new Headers({ cookie: asTargetCookies }),
		asResponse: true,
	});
	assert.equal(onward.status, 200, "原身份有权限时,可以继续切到别人");
	
	// 强不变量:把原身份的权限**撤掉**,例外就只剩「切回原身」,不能再切别人
	await revokeImpersonate(operator.id);
	const denied = await auth.api.switchUser({
		body: { userId: other.id },
		headers: new Headers({ cookie: asTargetCookies }),
		asResponse: true,
	});
	assert.equal(denied.status, 403, "原身份被撤权后,不能借例外当跳板");
	const stillUndo = await auth.api.switchUser({
		body: { userId: operator.id },
		headers: new Headers({ cookie: asTargetCookies }),
		asResponse: true,
	});
	assert.equal(stillUndo.status, 200, "但切回原身的例外仍然保留(否则人被困住)");
});

test("切换用户:未登录 401 / 切自己 400 / 目标不存在 404", async () => {
	const operator = await makeUser("guard");
	await grantImpersonate(operator.id);
	const cookie = await signInCookie(operator.email);

	const anonymous = await auth.api.switchUser({
		body: { userId: operator.id },
		headers: new Headers(),
		asResponse: true,
	});
	assert.equal(anonymous.status, 401, "没有会话 → 401");

	const self = await auth.api.switchUser({
		body: { userId: operator.id },
		headers: new Headers({ cookie }),
		asResponse: true,
	});
	assert.equal(self.status, 400, "切自己 → 400");

	const missing = await auth.api.switchUser({
		body: { userId: `${TEST_PREFIX}not_exist_${SUFFIX}` },
		headers: new Headers({ cookie }),
		asResponse: true,
	});
	assert.equal(missing.status, 404, "目标不存在 → 404");
});
