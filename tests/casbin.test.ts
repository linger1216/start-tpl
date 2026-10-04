/**
 * Casbin 功能权限引擎(`lib/casbin.ts`)—— 直接打领域函数,不绕路由。
 *
 * 为什么单独一个文件:`tests/role.test.ts` 验的是"**接口**行为对不对",
 * 这里验的是"**引擎**本身的几条容易写错、又不容易被人肉发现的性质"。
 *
 * 覆盖八条:
 *  1. **角色继承**(`g, role:A, role:B`)—— 迁到 Casbin 拿到的唯一能力增量;
 *  2. `menu:<id>` 在**装载时展开**成三种客体:菜单本身 / 它的 `perm` / 它的页面码(`pagePermOf`);
 *  3. 通配授权(`perm = test:thing:*`)覆盖**以后新增**的权限点 —— 证明是装载时算的,不是写死;
 *  4. 只勾子节点 → 祖先链自动补全(写入侧 `withAncestorIds`);
 *  5. 兜底:认不出人**失败关闭**;`isPermissionConfigured()` 与库里的 `p` 行数一致;
 *  6. 唯一键:同一条授权重复落库不产生第二行;
 *  7. **删菜单 → 它的 `p` 行清零**(外键 cascade 没了,靠写接口里的 `removeMenuPolicies`);
 *  8. 改菜单的 `perm` → 判定**立刻**跟着变(证明写接口刷了缓存,不是等 30 秒 TTL)。
 *
 * ⚠️ 会读写真实库;数据用 `__test__` 前缀,`after` 清干净。
 * ⚠️ 第 5 条**不假设授权表是空的**:跑过演示种子之后 `p` 行就不空了,所以只断言"与库一致"。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { and, eq, inArray, sql } from "drizzle-orm";
import { sysCasbinRule, sysMenu, sysRole, sysUser } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import {
	addRoleMenus,
	addUserRole,
	clearCasbinCache,
	enforce,
	grantedMenuIdsOf,
	implicitObjsOf,
	isPermissionConfigured,
	roleIdsOf,
	setRoleMenus,
} from "../src/lib/casbin.ts";
import { newId } from "../src/lib/ids.ts";
import { MENU_TYPE } from "../src/lib/menu-spec.ts";
import { pagePermOf, withAncestorIds } from "../src/lib/rbac.ts";
import {
	caller,
	closeDb,
	purgeCasbinByMenuIds,
	purgeCasbinByUserIds,
	purgeRoles,
	TEST_PREFIX,
	uniqueSuffix,
} from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const roleIds: string[] = [];
const userIds: string[] = [];
const menuIds: string[] = [];

/**
 * 直接建一个**启用**的角色,返回它的 `id` —— 策略表里认的就是 `role:<id>`(`sys_role` 没有 `code` 列)。
 *
 * 为什么必须真的落一行 `sys_role`:装载时会用 `sys_role.status` 过滤掉停用(或已不存在)的角色
 * (`lib/casbin.ts` 的 `roleDisabled`)—— 只往 `sys_casbin_rule` 里插行、库里没有这个角色,行会被当悬挂数据丢掉。
 */
async function makeRole(label: string): Promise<string> {
	const id = newId();
	await db.insert(sysRole).values({
		id,
		name: `${TEST_PREFIX}${label}`,
		sort: 0,
		status: 1,
	});
	roleIds.push(id);
	clearCasbinCache();
	return id;
}

async function makeUser(label: string): Promise<string> {
	const id = newId();
	await db.insert(sysUser).values({
		id,
		name: `${TEST_PREFIX}${label}`,
		email: `${TEST_PREFIX}${label}_${SUFFIX}@example.com`,
	});
	userIds.push(id);
	return id;
}

/** 直接插一条测试菜单。`path` 决定它展开出什么:以 `/` 开头 → 多一个页面码;`#…` → 不展开页面码 */
async function makeMenu(
	label: string,
	parentId: string | null,
	type: number,
	perm: string | null,
	path?: string,
): Promise<string> {
	const id = newId();
	await db.insert(sysMenu).values({
		id,
		parent_id: parentId,
		name: `${TEST_PREFIX}${label}`,
		path: path ?? `${TEST_PREFIX}${label}_${SUFFIX}`,
		type,
		perm,
		sort: 0,
		visible: 1,
		status: 1,
	});
	// 直接写表绕过了写接口 ⇒ 手动刷缓存(否则断言读到的还是上一份装载快照)
	clearCasbinCache();
	menuIds.push(id);
	return id;
}

/** 直接插一条角色继承:`g, role:<child>, role:<parent>` —— child 的成员顺带拿到 parent 的授权 */
async function inherit(childRoleId: string, parentRoleId: string): Promise<void> {
	await db.insert(sysCasbinRule).values({
		id: newId(),
		ptype: "g",
		v0: `role:${childRoleId}`,
		v1: `role:${parentRoleId}`,
		v2: "",
	});
	clearCasbinCache();
}

after(async () => {
	// 先清策略表里指向测试数据的行,再删业务表(策略行没有外键,顺序随便,但清缓存要在最后)
	await purgeCasbinByMenuIds(menuIds);
	await purgeCasbinByUserIds(userIds);
	if (roleIds.length > 0) {
		// 主体侧:授权 p 行 + 继承 g 行;还可能有角色继承 `g, role:<id>, role:<other>` 把这个 id 写进 v0
		await db.delete(sysCasbinRule).where(
			inArray(
				sysCasbinRule.v0,
				roleIds.map((id) => `role:${id}`),
			),
		);
	}
	await purgeRoles(roleIds);
	clearCasbinCache();
	if (menuIds.length > 0) await db.delete(sysMenu).where(inArray(sysMenu.id, menuIds));
	if (userIds.length > 0) await db.delete(sysUser).where(inArray(sysUser.id, userIds));
	await closeDb();
});

test("① 角色继承:g, role:A, role:B —— A 的成员自动拿到 B 的授权", async () => {
	const parent = await makeRole("inh_parent");
	const child = await makeRole("inh_child");
	const user = await makeUser("inherit");
	const menu = await makeMenu("继承来的权限", null, MENU_TYPE.BUTTON, "test:inh:read");

	await addUserRole(user, child);
	await setRoleMenus(parent, [menu]);
	await inherit(child, parent);

	assert.equal(
		await enforce(`user:${user}`, "test:inh:read"),
		true,
		"挂在子角色上,父角色的授权要通过继承链生效(这是迁到 Casbin 唯一的增量)",
	);
	const objs = await implicitObjsOf(user);
	assert.ok(objs.includes("test:inh:read"), "implicitObjsOf 也要含继承来的权限码");

	// 读侧**不重复展开**继承:继承由 Casbin 在判定时算,这里只给直接挂的角色
	assert.deepEqual(await roleIdsOf(user), [child], "roleIdsOf 只给直接挂着的角色");
});

test("② menu:<id> 装载时展开成三种客体:菜单本身 / 它的 perm / 它的页面码", async () => {
	const roleId = await makeRole("exp");
	const user = await makeUser("expand");
	await addUserRole(user, roleId);

	const dirPath = `#group/${TEST_PREFIX}${SUFFIX}`;
	const pagePath = `/${TEST_PREFIX}page_${SUFFIX}`;
	const dir = await makeMenu("目录", null, MENU_TYPE.DIR, null, dirPath);
	const page = await makeMenu("页面", dir, MENU_TYPE.MENU, null, pagePath);
	const button = await makeMenu("按钮", page, MENU_TYPE.BUTTON, "test:exp:add", `#perm/${TEST_PREFIX}${SUFFIX}`);
	await setRoleMenus(roleId, [dir, page, button]);

	const objs = await implicitObjsOf(user);
	for (const id of [dir, page, button]) {
		// 这条是权限树的"选中态"要回读的东西
		assert.ok(objs.includes(`menu:${id}`), `每个勾上的菜单本身都要能被回读:menu:${id}`);
	}
	assert.equal(
		await enforce(`user:${user}`, pagePermOf(pagePath)),
		true,
		"页面菜单的 path 以 / 开头 ⇒ 多展开一个 page:…:view(路由守卫靠它)",
	);
	assert.equal(await enforce(`user:${user}`, "test:exp:add"), true, "按钮的 perm 进权限集合(接口守卫靠它)");
	assert.equal(
		await enforce(`user:${user}`, pagePermOf(dirPath)),
		false,
		"目录的 path 不是 / 开头 ⇒ 不该展开出页面码(否则分组节点会变成可访问页面)",
	);
});

test("③ 通配授权:菜单的 perm 是 test:thing:* ⇒ 以后新增的权限点自动被覆盖", async () => {
	const roleId = await makeRole("wild");
	const user = await makeUser("wildcard");
	await addUserRole(user, roleId);
	const menu = await makeMenu("通配菜单", null, MENU_TYPE.BUTTON, "test:thing:*");
	await setRoleMenus(roleId, [menu]);

	assert.equal(await enforce(`user:${user}`, "test:thing:read"), true, "现成的码命中");
	assert.equal(
		await enforce(`user:${user}`, "test:thing:brand_new_action"),
		true,
		"**从没写进策略表**的新码也要命中 —— 证明模式是装载时展开的,不是把码写死",
	);
	assert.equal(await enforce(`user:${user}`, "test:other:read"), false, "只覆盖自己那一段,不越界");
});

test("④ 只勾子节点 → 写入时补全祖先链(否则侧边栏那一枝无处安放)", async () => {
	const roleId = await makeRole("anc");
	const user = await makeUser("anchor");
	await addUserRole(user, roleId);

	const grandpa = await makeMenu("祖父", null, MENU_TYPE.DIR, null, `#group/${TEST_PREFIX}gp_${SUFFIX}`);
	const parent = await makeMenu("父", grandpa, MENU_TYPE.DIR, null, `#group/${TEST_PREFIX}pa_${SUFFIX}`);
	const child = await makeMenu("子", parent, MENU_TYPE.MENU, null, `/${TEST_PREFIX}child_${SUFFIX}`);

	const filled = await withAncestorIds([child]);
	assert.deepEqual(
		new Set(filled),
		new Set([child, parent, grandpa]),
		"两层祖先都要补上(侧边栏按 parentId 拼树,缺一层那一枝就挂不上)",
	);

	await setRoleMenus(roleId, filled);
	assert.deepEqual(
		new Set(await grantedMenuIdsOf(roleId)),
		new Set([child, parent, grandpa]),
		"落库的就是补全后的集合",
	);
});

test("⑤ 兜底:认不出人失败关闭;isPermissionConfigured 与库里的 p 行数一致", async () => {
	const somebody = await makeUser("nobody");
	assert.equal(
		await enforce(`user:${somebody}`, "test:anything:read"),
		false,
		"没有任何 g 行的人 ⇒ 引擎一律 false(失败关闭,不是放行)",
	);
	assert.deepEqual(await implicitObjsOf(somebody), [], "认不出人 ⇒ 客体集合是空的");

	// 未启用(库里一条 p 行都没有)的哨兵由调用方(isPermissionConfigured)负责,不吃 30 秒 TTL
	const [row] = await db.select({ n: sql<number>`count(*)` }).from(sysCasbinRule).where(eq(sysCasbinRule.ptype, "p"));
	assert.equal(
		await isPermissionConfigured(),
		Number(row?.n ?? 0) > 0,
		"这个判据必须直接反映「库里有没有配过」,不能跟着缓存漂",
	);
});

test("⑥ 唯一键:同一条授权重复落库不产生第二行", async () => {
	const roleId = await makeRole("uniq");
	const menu = await makeMenu("唯一菜单", null, MENU_TYPE.BUTTON, "test:uniq:x");

	assert.equal(await addRoleMenus(roleId, [menu]), 1, "第一次补 1 条");
	assert.equal(await addRoleMenus(roleId, [menu]), 0, "第二次补 0 条(唯一键挡住,不产生第二行)");
	const rows = await db
		.select({ id: sysCasbinRule.id })
		.from(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, "p"), eq(sysCasbinRule.v0, `role:${roleId}`)));
	assert.equal(rows.length, 1, "库里只有一行");
});

test("⑦ 删菜单 → 它的 p 行跟着清零(外键 cascade 没了,靠写接口清)", async () => {
	const roleId = await makeRole("rm");
	const created = await caller.menu.create({
		parentId: null,
		name: `${TEST_PREFIX}待删菜单`,
		path: `/${TEST_PREFIX}rm_${SUFFIX}`,
		icon: null,
		visible: true,
		type: MENU_TYPE.MENU,
		perm: null,
	});
	menuIds.push(created.id);
	await caller.role.setMenus({ roleId, menuIds: [created.id] });
	assert.ok((await grantedMenuIdsOf(roleId)).includes(created.id), "先确认授权真的落库了");

	await caller.menu.delete({ id: created.id });

	const left = await db
		.select({ id: sysCasbinRule.id })
		.from(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, "p"), eq(sysCasbinRule.v1, `menu:${created.id}`)));
	assert.equal(left.length, 0, "菜单没了,指向它的 p 行必须清零(否则同 id 复活会诈尸)");
});

test("⑧ 改菜单的 perm → 判定立刻跟着变(写接口刷了缓存,不等 30 秒 TTL)", async () => {
	const roleId = await makeRole("swap");
	const user = await makeUser("swap");
	await addUserRole(user, roleId);

	const created = await caller.menu.create({
		parentId: null,
		name: `${TEST_PREFIX}换权限`,
		path: `/${TEST_PREFIX}swap_${SUFFIX}`,
		icon: null,
		visible: true,
		type: MENU_TYPE.BUTTON,
		perm: "test:swap:read",
	});
	menuIds.push(created.id);
	await caller.role.setMenus({ roleId, menuIds: [created.id] });
	assert.equal(await enforce(`user:${user}`, "test:swap:read"), true, "改之前:read 通");
	assert.equal(await enforce(`user:${user}`, "test:swap:write"), false, "改之前:write 不通");

	await caller.menu.update({
		id: created.id,
		name: `${TEST_PREFIX}换权限`,
		path: `/${TEST_PREFIX}swap_${SUFFIX}`,
		icon: null,
		visible: true,
		type: MENU_TYPE.BUTTON,
		perm: "test:swap:write",
	});

	assert.equal(
		await enforce(`user:${user}`, "test:swap:write"),
		true,
		"改之后:write 立刻通 —— 装载时展开的结果跟着 sys_menu 变了",
	);
	assert.equal(await enforce(`user:${user}`, "test:swap:read"), false, "旧码立刻失效(缓存不能还留旧快照)");
});
