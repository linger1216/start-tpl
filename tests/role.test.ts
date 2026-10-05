/**
 * 角色 API(`sys_role` + `sys_casbin_rule` 的 `p` / `g` 行)与**权限并集的计算** —— 集成测试。
 *
 * 覆盖:
 *  1. 角色台账:`list` 带成员数 / 被部门成员引用时不让删;
 *  2. 授权:`setMenus` **自动补全祖先链**(只勾子节点也能看见)、`menuIds` 往返;
 *  3. **并集语义**(部门 → 角色 → 授权):张三在上海是 A、在武汉是 B,可见菜单与权限都是两者的并集;
 *  4. 两种兜底:未启用(`sys_casbin_rule` 一条 `p` 行都没有)→ `perms = null` 一律放行,不把管理员锁在门外;
 *     已启用但没有角色的人 → 失败关闭(`rows = null` + `perms = []`);
 *  5. 按钮(`type = 3`):**不进可见菜单**,但它的 `perm` 进权限集合。
 *
 * ⚠️ 会读写真实库;数据用 `__test__` 前缀,`after` 清干净。
 * ⚠️ 第 4 条断言**按库的当前状态分支**,不假设授权表是空的:授权是 `sys_casbin_rule` 的 `p` 行,
 * 跑过演示种子之后它就不空了,而 `node --test` 按文件并行跑 —— 分支比"跳过"更稳。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { eq, inArray } from "drizzle-orm";
import { sysCasbinRule, sysDept, sysMenu, sysUser, sysUserDept } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { clearCasbinCache } from "../src/lib/casbin.ts";
import { newId } from "../src/lib/ids.ts";
import { MENU_TYPE } from "../src/lib/menu-spec.ts";
import { effectiveMenusFor, PERM_FORMAT, permMatches } from "../src/lib/rbac.ts";
import {
	assertRejects,
	caller,
	closeDb,
	purgeCasbinByMenuIds,
	purgeCasbinByUserIds,
	purgeRoles,
	TEST_PREFIX,
	uniqueSuffix,
} from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const deptIds: string[] = [];
const roleIds: string[] = [];
const userIds: string[] = [];
const menuIds: string[] = [];

async function makeUser(label: string): Promise<string> {
	const id = newId();
	await db
		.insert(sysUser)
		.values({ id, name: `${TEST_PREFIX}${label}`, email: `${TEST_PREFIX}${label}_${SUFFIX}@example.com` });
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
	await purgeCasbinByMenuIds(menuIds);
	await purgeCasbinByUserIds(userIds);
	await purgeRoles(roleIds);
	clearCasbinCache();
	if (deptIds.length > 0) await db.delete(sysUserDept).where(inArray(sysUserDept.department_id, deptIds));
	for (const id of [...deptIds].reverse()) await db.delete(sysDept).where(eq(sysDept.id, id));
	if (menuIds.length > 0) await db.delete(sysMenu).where(inArray(sysMenu.id, menuIds));
	if (userIds.length > 0) await db.delete(sysUser).where(inArray(sysUser.id, userIds));
});

test("权限体系的两种兜底:未启用 → 全放行;已启用但没有角色 → 空 + 空集合", async () => {
	// ⚠️ 这条**按当前库的状态分支**,不假设授权表是空的:
	// 空库(或没跑过 `pnpm db:seed:rbac`)验"未启用不过滤";跑过演示种子之后则验"没有角色的人看不到任何菜单"。
	// 两种状态都是真实存在且必须成立的,所以分支比"跳过"更有价值。
	const grants = await db
		.select({ id: sysCasbinRule.id })
		.from(sysCasbinRule)
		.where(eq(sysCasbinRule.ptype, "p"))
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
 * 用 API 而不是直接往 `sys_casbin_rule` 插 `g` 行,这样测试同时覆盖了"保存角色"这条路径。
 */
async function assignRoles(userId: string, roleIdList: string[]): Promise<void> {
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

test("角色:list 带成员数", async () => {
	const role = await caller.role.create({ name: `${TEST_PREFIX}管理员_${SUFFIX}` });
	roleIds.push(role.id);

	const user = await makeUser("rolelist");
	await assignRoles(user, [role.id]);

	const listed = (await caller.role.list()).find((row) => row.id === role.id);
	assert.equal(listed?.memberCount, 1, "list 应该把这个角色分配给了几个用户带出来");
});

test("角色:被用户引用时不让删", async () => {
	const role = await caller.role.create({ name: `${TEST_PREFIX}在用_${SUFFIX}` });
	roleIds.push(role.id);
	const user = await makeUser("usedrole");
	await assignRoles(user, [role.id]);

	await assertRejects(() => caller.role.remove({ id: role.id }), "个用户在用");

	// 把角色从他的角色里去掉 → 就能删了
	await assignRoles(user, []);
	assert.equal((await caller.role.remove({ id: role.id })).success, true);
});

test("角色授权:只勾子节点 → 自动补全祖先(否则侧边栏那一枝无处安放)", async () => {
	const role = await caller.role.create({ name: `${TEST_PREFIX}授权_${SUFFIX}` });
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
	const roleA = await caller.role.create({ name: `${TEST_PREFIX}上海管理员_${SUFFIX}` });
	const roleB = await caller.role.create({ name: `${TEST_PREFIX}武汉员工_${SUFFIX}` });
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
	const role = await caller.role.create({ name: `${TEST_PREFIX}停用角色_${SUFFIX}` });
	roleIds.push(role.id);
	const menu = await makeMenu("停用测试菜单", null, MENU_TYPE.MENU, "test:off");
	await caller.role.setMenus({ roleId: role.id, menuIds: [menu] });

	const user = await makeUser("offuser");
	await assignRoles(user, [role.id]);

	// 角色停用 → 权限跟着没了(注意:部门停用已经不影响权限了 —— 角色是全局的)
	await caller.role.update({ id: role.id, name: role.name, status: false, remark: null });
	const afterRoleOff = await effectiveMenusFor(user);
	assert.equal(afterRoleOff.rows, null, "角色停用 → 这个人没有可见菜单");

	// 角色恢复 → 权限回来
	await caller.role.update({ id: role.id, name: role.name, status: true, remark: null });
	const backOn = await effectiveMenusFor(user);
	assert.ok(
		backOn.rows?.some((row) => row.id === menu),
		"角色恢复 → 菜单跟着回来",
	);
});

test("按钮(type = 3):不进可见菜单,但它的 perm 进权限集合", async () => {
	const role = await caller.role.create({ name: `${TEST_PREFIX}按钮角色_${SUFFIX}` });
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
	const role = await caller.role.create({ name: `${TEST_PREFIX}通配角色_${SUFFIX}` });
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

test("setRoleMenus 的通配保留:整批替换时,**含通配段的 perm 行不会被一起删掉**(否则 *:*:* 一类角色一夜归零)", async () => {
	// 「系统管理员」就靠一条 `*:*:*` 通配顶全部;之前 setRoleMenus 是全量删除 + 全量插入,
	// UI 上改个菜单就会把 `*:*:*` 砍掉 —— admin 一夜回到 0 授权。修法:setRoleMenus 在落库之前
	// 先把通配行识别出来,删的时候只删非通配,最后把通配重新插回去。这里用一个非 admin 角色跑同样的修法。
	const role = await caller.role.create({ name: `${TEST_PREFIX}通配保留_${SUFFIX}` });
	roleIds.push(role.id);
	const wildcard = await makeMenu("通配行", null, MENU_TYPE.BUTTON, "test:keep:*");
	const plain = await makeMenu("普通行", null, MENU_TYPE.BUTTON, "test:keep:single");
	// 起始授权 = 两条都有
	await caller.role.setMenus({ roleId: role.id, menuIds: [wildcard, plain] });
	let stored = await caller.role.menuIds({ roleId: role.id });
	assert.ok(stored.includes(wildcard) && stored.includes(plain), "起始两条都在");

	// 改成**只传普通行** —— 通配行应当被保留下来(否则就回到 bug)
	await caller.role.setMenus({ roleId: role.id, menuIds: [plain] });
	stored = await caller.role.menuIds({ roleId: role.id });
	assert.ok(stored.includes(plain), "新传进来的普通行在");
	assert.ok(stored.includes(wildcard), "通配行被保留下来 —— 整批替换不再误伤 *:*:* 一类的角色");
});

test("角色的用户:加人幂等 / 列表带出部门 / 能移出", async () => {
	const role = await caller.role.create({ name: `${TEST_PREFIX}角色用户_${SUFFIX}` });
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

test("导入:按角色名 upsert —— 新建 + 改状态 / 备注,再导一次只报 duplicates", async () => {
	const roleA = `${TEST_PREFIX}导入角色甲_${SUFFIX}`;
	const roleB = `${TEST_PREFIX}导入角色乙_${SUFFIX}`;
	// 先建一个,验证「已有角色」那一支;备注故意留着,检查「空单元格不动库里的值」
	const before = await caller.role.create({ name: roleB, remark: "原来的备注" });
	roleIds.push(before.id);

	const first = await caller.role.import({
		rows: [
			{ name: roleA, sort: "7", status: "停用", remark: "新建的" },
			{ name: roleB, sort: "9" },
		],
	});
	assert.equal(first.created, 2, "两行都写了");
	assert.equal(first.errors.length, 0);
	assert.equal(first.duplicates.length, 0);

	let rows = await caller.role.list();
	const a = rows.find((row) => row.name === roleA);
	assert.ok(a, "新角色建出来了");
	roleIds.push(a.id);
	assert.equal(a.sort, 7, "排序列照填");
	assert.equal(a.status, 0, "状态列认「停用」");
	assert.equal(a.remark, "新建的");
	assert.equal(rows.find((row) => row.name === roleB)?.remark, "原来的备注", "留空的备注不动库里的值");

	// 再导一次:和库里一模一样 → duplicates,不假装写了一遍
	const second = await caller.role.import({
		rows: [{ name: roleA, sort: "7", status: "停用", remark: "新建的" }],
	});
	assert.equal(second.created, 0);
	assert.equal(second.errors.length, 0);
	assert.equal(second.duplicates.length, 1);
	assert.match(second.duplicates[0]?.message ?? "", /没有改动/);

	// 只填状态 → 真改(改 status 会让 casbin 装载结果变,服务端那边要 clearCasbinCache)
	const third = await caller.role.import({ rows: [{ name: roleA, status: "启用" }] });
	assert.equal(third.created, 1);
	rows = await caller.role.list();
	assert.equal(rows.find((row) => row.name === roleA)?.status, 1, "状态改回启用");
});

test("导入:逐行校验 —— 缺角色名 / 排序不是非负整数 / 状态写法不认 / 同批重名", async () => {
	const roleName = `${TEST_PREFIX}导入校验_${SUFFIX}`;
	const result = await caller.role.import({
		rows: [
			{ name: "", sort: "1", status: "启用" },
			{ name: roleName, sort: "x" },
			{ name: roleName, status: "算了" },
			{ name: roleName, sort: "3", status: "启用" },
			{ name: roleName, sort: "4" },
		],
	});
	assert.equal(result.created, 1, "只有第 4 行是合法的");
	assert.equal(result.errors.length, 4);
	assert.match(result.errors[0]?.message ?? "", /缺少「角色名」/);
	assert.match(result.errors[1]?.message ?? "", /「排序」/);
	assert.match(result.errors[2]?.message ?? "", /「状态」/);
	assert.match(result.errors[3]?.message ?? "", /出现了多次/);

	const created = (await caller.role.list()).find((row) => row.name === roleName);
	assert.ok(created, "合法那行真的落库了");
	roleIds.push(created.id);
	assert.equal(created.sort, 3);
	assert.equal(created.status, 1, "状态列认「启用」");
});

after(async () => {
	await closeDb();
});
