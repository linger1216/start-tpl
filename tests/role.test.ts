/**
 * 角色 API(`sys_role` + `casbin_rule` 的 `p` / `g` 行)与**权限并集的计算** —— 集成测试。
 *
 * 覆盖:
 *  1. 角色台账:`code` 唯一 / `list` 带成员数 / 被部门成员引用时不让删;
 *  2. 授权:`setMenus` **自动补全祖先链**(只勾子节点也能看见)、`menuIds` 往返;
 *  3. **并集语义**(部门 → 角色 → 授权):张三在上海是 A、在武汉是 B,可见菜单与权限都是两者的并集;
 *  4. 两种兜底:未启用(`casbin_rule` 一条 `p` 行都没有)→ `perms = null` 一律放行,不把管理员锁在门外;
 *     已启用但没有角色的人 → 失败关闭(`rows = null` + `perms = []`);
 *  5. 按钮(`type = 3`):**不进可见菜单**,但它的 `perm` 进权限集合。
 *
 * ⚠️ 会读写真实库;数据用 `__test__` 前缀,`after` 清干净。
 * ⚠️ 第 4 条断言**按库的当前状态分支**,不假设授权表是空的:授权是 `casbin_rule` 的 `p` 行,
 * 跑过演示种子之后它就不空了,而 `node --test` 按文件并行跑 —— 分支比"跳过"更稳。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import {
	casbinRule,
	sysDept,
	sysUserDept,
	sysMenu,
	sysRole,
	sysUser,
} from "../src/db/data-base-schema.ts";
import { clearCasbinCache } from "../src/lib/casbin.ts";
import { newId } from "../src/lib/ids.ts";
import { MENU_TYPE } from "../src/lib/menu-spec.ts";
import { effectiveMenusFor, PERM_FORMAT, permMatches } from "../src/lib/rbac.ts";
import { assertRejects, caller, closeDb, ensureTestAdminPolicy, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const deptIds: string[] = [];
const roleIds: string[] = [];
const userIds: string[] = [];
const menuIds: string[] = [];

async function makeUser(label: string): Promise<string> {
	const id = newId();
	await db.insert(sysUser).values({ id, name: `${TEST_PREFIX}${label}`, email: `${TEST_PREFIX}${label}_${SUFFIX}@example.com` });
	userIds.push(id);
	return id;
}


/** 直接插一条测试菜单(菜单表是"人手工维护的配置表",这里造父子与按钮节点) */
async function makeMenu(label: string, parentId: string | null, type: number, perm: string | null): Promise<string> {
	const id = newId();
	await db.insert(sysMenu).values({
		id,
		parent_id: parentId,
		name: `${TEST_PREFIX}${label}`,
		path: `${TEST_PREFIX}${label}_${SUFFIX}`,
		type,
		perm,
		sort: 0,
		visible: 1,
		status: 1,
	});
	// 断言紧接着就读判定结果,而这里是**直接写表**、绕过了领域函数 ⇒ 要手动刷缓存
	// (「通配授权:以后新增的自动包含」那条用例正是靠它 —— 新建权限点后必须重新装载才看得见)
	clearCasbinCache();
	menuIds.push(id);
	return id;
}

after(async () => {
	// 先清策略表里指向测试数据的行 —— 授权是 `p` 行(客体是测试菜单),成员关系是 `g` 行(主体是测试用户)。
	// 直接删表绕过了 `lib/casbin.ts` 的领域函数,所以末尾要手动刷判定缓存。
	if (menuIds.length > 0) {
		await db
			.delete(casbinRule)
			.where(and(eq(casbinRule.ptype, "p"), inArray(casbinRule.v1, menuIds.map((id) => `menu:${id}`))));
	}
	if (userIds.length > 0) {
		await db
			.delete(casbinRule)
			.where(and(eq(casbinRule.ptype, "g"), inArray(casbinRule.v0, userIds.map((id) => `user:${id}`))));
	}
	clearCasbinCache();
	if (deptIds.length > 0) await db.delete(sysUserDept).where(inArray(sysUserDept.department_id, deptIds));
	if (roleIds.length > 0) await db.delete(sysRole).where(inArray(sysRole.id, roleIds));
	for (const id of [...deptIds].reverse()) await db.delete(sysDept).where(eq(sysDept.id, id));
	if (menuIds.length > 0) await db.delete(sysMenu).where(inArray(sysMenu.id, menuIds));
	if (userIds.length > 0) await db.delete(sysUser).where(inArray(sysUser.id, userIds));
});

test("权限体系的两种兜底:未启用 → 全放行;已启用但没有角色 → 空 + 空集合", async () => {
	// ⚠️ 这条**按当前库的状态分支**,不假设授权表是空的:
	// 空库(或没跑过 `pnpm db:seed:rbac`)验"未启用不过滤";跑过演示种子之后则验"没有角色的人看不到任何菜单"。
	// 两种状态都是真实存在且必须成立的,所以分支比"跳过"更有价值。
	const grants = await db
		.select({ id: casbinRule.id })
		.from(casbinRule)
		.where(eq(casbinRule.ptype, "p"))
		.limit(1);
	const someone = await makeUser("nobody");

	if (grants.length === 0) {
		const effective = await effectiveMenusFor(someone);
		assert.equal(effective.perms, null, "未启用 → perms = null(前端 useHasPerm 据此一律放行)");
		assert.ok((effective.rows?.length ?? 0) > 0, "未启用 → 全部可见菜单(不把管理员锁在门外)");
		assert.ok(
			effective.rows?.every((row) => Number(row.type) !== MENU_TYPE.BUTTON),
			"未启用也不该把按钮当菜单塞进导航",
		);
		return;
	}

	// 已启用:这个人一条角色分配都没有 → 什么都看不到,且**失败关闭**(perms 是 [] 而不是 null)
	const effective = await effectiveMenusFor(someone);
	assert.equal(effective.rows, null, "已启用 + 无角色 → rows = null(展示层据此不回落静态菜单)");
	assert.deepEqual(effective.perms, [], "已启用 + 无角色 → perms = [](不是 null —— 那个代表'放行')");
});

/**
 * 把角色分配给某个用户 —— 走真实的 `user.update`(角色是全局的,与部门无关)。
 * 用 API 而不是直接往 `casbin_rule` 插 `g` 行,这样测试同时覆盖了"保存角色"这条路径。
 */
async function assignRoles(userId: string, roleIdList: string[]): Promise<void> {
	// 策略表已启用 ⇒ 引擎失败关闭:合成的 test-admin 身份必须先补一条无限制策略,才读得到用户列表
	await ensureTestAdminPolicy();
	const row = (await caller.user.list()).find((item) => item.id === userId);
	assert.ok(row, "用户应该存在");
	// 角色与部门都是**覆盖式**:只想改角色,就得把当前部门原样传回去(不传会清掉)
	await caller.user.update({
		id: userId,
		name: row.name,
		email: row.email,
		image: row.image ?? "",
		emailVerified: row.emailVerified,
		roleIds: roleIdList,
		departmentIds: row.departmentIds,
	});
}

test("角色:code 唯一,list 带成员数", async () => {
	const code = `${TEST_PREFIX}role_${SUFFIX}`;
	const role = await caller.role.create({ code, name: `${TEST_PREFIX}管理员` });
	roleIds.push(role.id);
	await assertRejects(() => caller.role.create({ code, name: "重复" }), "已被角色");

	const user = await makeUser("rolelist");
	await assignRoles(user, [role.id]);

	const listed = (await caller.role.list()).find((row) => row.id === role.id);
	assert.equal(listed?.memberCount, 1, "list 应该把这个角色分配给了几个用户带出来");
});

test("角色:被用户引用时不让删", async () => {
	const role = await caller.role.create({ code: `${TEST_PREFIX}used_${SUFFIX}`, name: `${TEST_PREFIX}在用` });
	roleIds.push(role.id);
	const user = await makeUser("usedrole");
	await assignRoles(user, [role.id]);

	await assertRejects(() => caller.role.remove({ id: role.id }), "个用户在用");

	// 把角色从他的角色里去掉 → 就能删了
	await assignRoles(user, []);
	assert.equal((await caller.role.remove({ id: role.id })).success, true);
});

test("角色授权:只勾子节点 → 自动补全祖先(否则侧边栏那一枝无处安放)", async () => {
	const role = await caller.role.create({ code: `${TEST_PREFIX}grant_${SUFFIX}`, name: `${TEST_PREFIX}授权` });
	roleIds.push(role.id);
	const parent = await makeMenu("父菜单", null, MENU_TYPE.DIR, null);
	const child = await makeMenu("子菜单", parent, MENU_TYPE.MENU, null);

	const out = await caller.role.setMenus({ roleId: role.id, menuIds: [child] });
	assert.equal(out.count, 2, "只传了子节点,落库应是父子两条");
	const stored = await caller.role.menuIds({ roleId: role.id });
	assert.ok(stored.includes(child), "勾的子节点在");
	assert.ok(stored.includes(parent), "父节点被自动补上");

	// 覆盖式保存:改成只授权父节点 → 子节点的授权应消失
	await caller.role.setMenus({ roleId: role.id, menuIds: [parent] });
	assert.deepEqual(await caller.role.menuIds({ roleId: role.id }), [parent], "再保存是覆盖,不是累加");
});

test("权限并集:一个人有多个角色 → 菜单与权限都取并集", async () => {
	const roleA = await caller.role.create({ code: `${TEST_PREFIX}unionA_${SUFFIX}`, name: `${TEST_PREFIX}上海管理员` });
	const roleB = await caller.role.create({ code: `${TEST_PREFIX}unionB_${SUFFIX}`, name: `${TEST_PREFIX}武汉员工` });
	roleIds.push(roleA.id, roleB.id);

	const menuA = await makeMenu("上海专用", null, MENU_TYPE.MENU, "test:shanghai");
	const menuB = await makeMenu("武汉专用", null, MENU_TYPE.MENU, "test:wuhan");
	await caller.role.setMenus({ roleId: roleA.id, menuIds: [menuA] });
	await caller.role.setMenus({ roleId: roleB.id, menuIds: [menuB] });

	const user = await makeUser("zhangsan");
	await assignRoles(user, [roleA.id, roleB.id]);

	const effective = await effectiveMenusFor(user);
	assert.ok(effective.rows, "应有一份可见菜单");
	const visible = effective.rows.map((row) => row.id);
	assert.ok(visible.includes(menuA), "第一个角色的授权在");
	assert.ok(visible.includes(menuB), "第二个角色的授权也在 —— 这就是并集");
	assert.ok(effective.perms?.includes("test:shanghai") && effective.perms?.includes("test:wuhan"), "权限标识也是并集");
});

test("停用的角色不贡献权限", async () => {
	const role = await caller.role.create({ code: `${TEST_PREFIX}off_${SUFFIX}`, name: `${TEST_PREFIX}停用角色` });
	roleIds.push(role.id);
	const menu = await makeMenu("停用测试菜单", null, MENU_TYPE.MENU, "test:off");
	await caller.role.setMenus({ roleId: role.id, menuIds: [menu] });

	const user = await makeUser("offuser");
	await assignRoles(user, [role.id]);

	// 角色停用 → 权限跟着没了(注意:部门停用已经不影响权限了 —— 角色是全局的)
	await caller.role.update({ id: role.id, code: role.code, name: role.name, status: false, remark: null });
	const afterRoleOff = await effectiveMenusFor(user);
	assert.equal(afterRoleOff.rows, null, "角色停用 → 这个人没有可见菜单");

	// 角色恢复 → 权限回来
	await caller.role.update({ id: role.id, code: role.code, name: role.name, status: true, remark: null });
	const backOn = await effectiveMenusFor(user);
	assert.ok(backOn.rows?.some((row) => row.id === menu), "角色恢复 → 菜单跟着回来");
});

test("按钮(type = 3):不进可见菜单,但它的 perm 进权限集合", async () => {
	const role = await caller.role.create({ code: `${TEST_PREFIX}btn_${SUFFIX}`, name: `${TEST_PREFIX}按钮角色` });
	roleIds.push(role.id);
	const menu = await makeMenu("带按钮的页", null, MENU_TYPE.MENU, null);
	const button = await makeMenu("删除按钮", menu, MENU_TYPE.BUTTON, "test:page:delete");
	await caller.role.setMenus({ roleId: role.id, menuIds: [button] });

	const user = await makeUser("btnuser");
	await assignRoles(user, [role.id]);

	const effective = await effectiveMenusFor(user);
	const visible = (effective.rows ?? []).map((row) => row.id);
	assert.ok(visible.includes(menu), "按钮所在的菜单可见");
	assert.ok(!visible.includes(button), "**按钮本身不进导航**");
	assert.ok(effective.perms?.includes("test:page:delete"), "但它的 perm 进了权限集合(前端 useHasPerm 认它)");
});

// ── 权限模式(逐段通配)──────────────────────────────────────────

test("权限模式:逐段比较,而且只认**整段** `*`", () => {
	assert.equal(permMatches("*:*:*", "test:page:delete"), true, "全通配");
	assert.equal(permMatches("test:*:*", "test:page:delete"), true, "域内全通配");
	assert.equal(permMatches("test:page:*", "test:page:delete"), true, "资源内全通配");
	assert.equal(permMatches("test:page:delete", "test:page:delete"), true, "不带通配就按相等比");
	assert.equal(permMatches("other:*:*", "test:page:delete"), false, "域不同 → 不匹配");
	assert.equal(permMatches("test:page", "test:page:delete"), false, "**段数不同 → 永远不匹配**(所以要挡两段)");
	assert.equal(permMatches("test:pa*", "test:page:delete"), false, "不支持半截通配");

	assert.equal(PERM_FORMAT.test("test:page:delete"), true);
	assert.equal(PERM_FORMAT.test("*:*:*"), true);
	assert.equal(PERM_FORMAT.test("test:page"), false, "两段");
	assert.equal(PERM_FORMAT.test("Test:page:delete"), false, "大写");
	assert.equal(PERM_FORMAT.test("test:pa*:delete"), false, "半截通配");
});

test("权限标识的形状在接口层被挡住(两段 / 大写 / 半截通配都存不进去)", async () => {
	const base = {
		parentId: null,
		name: `${TEST_PREFIX}形状_${SUFFIX}`,
		icon: null,
		visible: true,
		type: MENU_TYPE.BUTTON,
	};
	await assertRejects(
		() => caller.menu.create({ ...base, path: `${TEST_PREFIX}shape1_${SUFFIX}`, perm: "test:thing" }),
		"域:资源:动作",
	);
	await assertRejects(
		() => caller.menu.create({ ...base, path: `${TEST_PREFIX}shape2_${SUFFIX}`, perm: "Test:thing:read" }),
		"域:资源:动作",
	);
	await assertRejects(
		() => caller.menu.create({ ...base, path: `${TEST_PREFIX}shape3_${SUFFIX}`, perm: "test:th*:read" }),
		"域:资源:动作",
	);
	// 合法的通配可以建
	const ok = await caller.menu.create({ ...base, path: `${TEST_PREFIX}shape4_${SUFFIX}`, perm: "*:*:*" });
	menuIds.push(ok.id);
});

test("通配授权:一条 `test:thing:*` = 该资源下全部权限,而且**以后新增的自动包含**", async () => {
	const role = await caller.role.create({ code: `${TEST_PREFIX}wild_${SUFFIX}`, name: `${TEST_PREFIX}通配角色` });
	roleIds.push(role.id);

	const read = await makeMenu("通配读", null, MENU_TYPE.BUTTON, "test:thing:read");
	const other = await makeMenu("通配别的资源", null, MENU_TYPE.BUTTON, "test:other:read");
	const pattern = await makeMenu("通配模式", null, MENU_TYPE.BUTTON, "test:thing:*");
	// 只授**模式**这一条
	await caller.role.setMenus({ roleId: role.id, menuIds: [pattern] });

	const user = await makeUser("wilduser");
	await assignRoles(user, [role.id]);

	const before = await effectiveMenusFor(user);
	assert.ok(read && other, "夹具存在");
	assert.ok(before.perms?.includes("test:thing:read"), "模式覆盖了同资源下的具体权限");
	assert.ok(before.perms?.includes("test:thing:*"), "模式本身也留在集合里(界面据此显示「全部权限」)");
	assert.ok(!before.perms?.includes("test:other:read"), "**跨资源不越界** —— 这就是逐段匹配的意义");

	// 授完之后**再新增**一条同资源的权限点 → 不用回来重新授权,自动就有
	const write = await makeMenu("通配写", null, MENU_TYPE.BUTTON, "test:thing:write");
	const after = await effectiveMenusFor(user);
	assert.ok(write, "夹具存在");
	assert.ok(after.perms?.includes("test:thing:write"), "新增的权限点自动被覆盖(装载时展开,不是写死)");
	assert.ok(!after.perms?.includes("test:other:read"), "仍然不越界");
});

test("角色的用户:加人幂等 / 列表带出部门 / 能移出", async () => {
	const role = await caller.role.create({ code: `${TEST_PREFIX}ru_${SUFFIX}`, name: `${TEST_PREFIX}角色用户` });
	roleIds.push(role.id);
	const user = await makeUser("roleuser");
	const dept = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}角色用户部门_${SUFFIX}` });
	deptIds.push(dept.id);

	// 加两次 → 只有一条(幂等,和部门加成员同一个约定)
	await caller.role.addUser({ roleId: role.id, userId: user });
	await caller.role.addUser({ roleId: role.id, userId: user });
	let list = await caller.role.users({ roleId: role.id });
	assert.equal(list.length, 1, "加两次只有一条(幂等)");
	assert.equal(list[0]?.userId, user);

	// 角色是全局的 → 列表要带出这个人的部门,否则光有姓名没法消歧
	await caller.department.addMember({ departmentId: dept.id, userId: user });
	list = await caller.role.users({ roleId: role.id });
	assert.ok(list[0]?.departmentNames.includes(`${TEST_PREFIX}角色用户部门_${SUFFIX}`), "列表带出了他的部门");

	// 不存在的用户 / 角色要报错,而不是静默写脏数据
	await assertRejects(() => caller.role.addUser({ roleId: role.id, userId: "no_such_user" }), "这个用户不存在");
	await assertRejects(() => caller.role.addUser({ roleId: "no_such_role", userId: user }), "这个角色不存在");

	// 移出 → 空(再移一次也不报错)
	await caller.role.removeUser({ roleId: role.id, userId: user });
	await caller.role.removeUser({ roleId: role.id, userId: user });
	assert.equal((await caller.role.users({ roleId: role.id })).length, 0, "移出之后列表空了");
});

after(async () => {
	await closeDb();
});
