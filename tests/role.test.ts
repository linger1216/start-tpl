/**
 * 角色 API(`sys_role` + `sys_role_menu`)与**权限并集的计算** —— 集成测试。
 *
 * 覆盖:
 *  1. 角色台账:`code` 唯一 / `list` 带成员数 / 被部门成员引用时不让删;
 *  2. 授权:`setMenus` **自动补全祖先链**(只勾子节点也能看见)、`menuIds` 往返;
 *  3. **并集语义**(部门 → 角色 → 授权):张三在上海是 A、在武汉是 B,可见菜单与权限都是两者的并集;
 *  4. 两种兜底:未启用(`sys_role_menu` 一条都没有)→ `perms = null` 一律放行,不把管理员锁在门外;
 *     已启用但没有角色的人 → 失败关闭(`rows = null` + `perms = []`);
 *  5. 按钮(`type = 3`):**不进可见菜单**,但它的 `perm` 进权限集合。
 *
 * ⚠️ 会读写真实库;数据用 `__test__` 前缀,`after` 清干净。
 * ⚠️ **这个文件是 `sys_role_menu` 唯一的写入方** —— 第 4 条断言依赖"那张表此刻是空的",
 * 而 `node --test` 按文件并行跑;别的文件不碰授权表,这条才不会飘。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { sysDepartment, sysDepartmentMember, sysMenu, sysRole, sysRoleMenu, sysUser } from "../src/db/data-base-schema.ts";
import { newId } from "../src/lib/ids.ts";
import { MENU_TYPE } from "../src/lib/menu-spec.ts";
import { effectiveMenusFor } from "../src/lib/rbac.ts";
import { assertRejects, caller, closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

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

async function makeDept(label: string) {
	const row = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}${label}_${SUFFIX}` });
	deptIds.push(row.id);
	return row;
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
	menuIds.push(id);
	return id;
}

after(async () => {
	if (roleIds.length > 0) await db.delete(sysRoleMenu).where(inArray(sysRoleMenu.role_id, roleIds));
	if (deptIds.length > 0) await db.delete(sysDepartmentMember).where(inArray(sysDepartmentMember.department_id, deptIds));
	if (roleIds.length > 0) await db.delete(sysRole).where(inArray(sysRole.id, roleIds));
	for (const id of [...deptIds].reverse()) await db.delete(sysDepartment).where(eq(sysDepartment.id, id));
	if (menuIds.length > 0) await db.delete(sysMenu).where(inArray(sysMenu.id, menuIds));
	if (userIds.length > 0) await db.delete(sysUser).where(inArray(sysUser.id, userIds));
});

test("权限体系的两种兜底:未启用 → 全放行;已启用但没有角色 → 空 + 空集合", async () => {
	// ⚠️ 这条**按当前库的状态分支**,不假设 `sys_role_menu` 是空的:
	// 空库(或没跑过 `pnpm db:seed:rbac`)验"未启用不过滤";跑过演示种子之后则验"没有角色的人看不到任何菜单"。
	// 两种状态都是真实存在且必须成立的,所以分支比"跳过"更有价值。
	const grants = await db.select({ id: sysRoleMenu.id }).from(sysRoleMenu);
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

test("角色:code 唯一,list 带成员数", async () => {
	const code = `${TEST_PREFIX}role_${SUFFIX}`;
	const role = await caller.role.create({ code, name: `${TEST_PREFIX}管理员` });
	roleIds.push(role.id);
	await assertRejects(() => caller.role.create({ code, name: "重复" }), "已被角色");

	const dept = await makeDept("rolelist");
	const user = await makeUser("rolelist");
	await caller.department.setMemberRole({ departmentId: dept.id, userId: user, roleId: role.id });

	const listed = (await caller.role.list()).find((row) => row.id === role.id);
	assert.equal(listed?.memberCount, 1, "list 应该把这个角色的成员数带出来");
});

test("角色:被部门成员引用时不让删", async () => {
	const role = await caller.role.create({ code: `${TEST_PREFIX}used_${SUFFIX}`, name: `${TEST_PREFIX}在用` });
	roleIds.push(role.id);
	const dept = await makeDept("usedrole");
	const user = await makeUser("usedrole");
	await caller.department.setMemberRole({ departmentId: dept.id, userId: user, roleId: role.id });

	await assertRejects(() => caller.role.remove({ id: role.id }), "部门成员在用");

	// 把人挪走 → 就能删了
	await caller.department.removeMember({ departmentId: dept.id, userId: user });
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

test("权限并集:两个部门两个角色 → 菜单与权限都取并集", async () => {
	const roleA = await caller.role.create({ code: `${TEST_PREFIX}unionA_${SUFFIX}`, name: `${TEST_PREFIX}上海管理员` });
	const roleB = await caller.role.create({ code: `${TEST_PREFIX}unionB_${SUFFIX}`, name: `${TEST_PREFIX}武汉员工` });
	roleIds.push(roleA.id, roleB.id);

	const menuA = await makeMenu("上海专用", null, MENU_TYPE.MENU, "test:shanghai");
	const menuB = await makeMenu("武汉专用", null, MENU_TYPE.MENU, "test:wuhan");
	await caller.role.setMenus({ roleId: roleA.id, menuIds: [menuA] });
	await caller.role.setMenus({ roleId: roleB.id, menuIds: [menuB] });

	const deptA = await makeDept("上海");
	const deptB = await makeDept("武汉");
	const user = await makeUser("zhangsan");
	await caller.department.setMemberRole({ departmentId: deptA.id, userId: user, roleId: roleA.id });
	await caller.department.setMemberRole({ departmentId: deptB.id, userId: user, roleId: roleB.id });

	const effective = await effectiveMenusFor(user);
	assert.ok(effective.rows, "应有一份可见菜单");
	const visible = effective.rows.map((row) => row.id);
	assert.ok(visible.includes(menuA), "上海那份在(第一个部门的角色)");
	assert.ok(visible.includes(menuB), "武汉那份也在(第二个部门的角色)—— 这就是并集");
	assert.ok(effective.perms?.includes("test:shanghai") && effective.perms?.includes("test:wuhan"), "权限标识也是并集");
});

test("停用的角色 / 停用的部门不贡献权限", async () => {
	const role = await caller.role.create({ code: `${TEST_PREFIX}off_${SUFFIX}`, name: `${TEST_PREFIX}停用角色` });
	roleIds.push(role.id);
	const menu = await makeMenu("停用测试菜单", null, MENU_TYPE.MENU, "test:off");
	await caller.role.setMenus({ roleId: role.id, menuIds: [menu] });

	const dept = await makeDept("停用部");
	const user = await makeUser("offuser");
	await caller.department.setMemberRole({ departmentId: dept.id, userId: user, roleId: role.id });

	// 角色先停用
	await caller.role.update({ id: role.id, code: role.code, name: role.name, status: false, remark: null });
	const afterRoleOff = await effectiveMenusFor(user);
	assert.equal(afterRoleOff.rows, null, "角色停用 → 这个人没有可见菜单");

	// 角色恢复、部门停用
	await caller.role.update({ id: role.id, code: role.code, name: role.name, status: true, remark: null });
	const deptRow = (await caller.department.tree()).find((row) => row.id === dept.id);
	assert.ok(deptRow);
	await caller.department.update({ id: dept.id, name: deptRow.name, parentId: null, status: false, remark: null });
	const afterDeptOff = await effectiveMenusFor(user);
	assert.equal(afterDeptOff.rows, null, "部门停用 → 这个部门不贡献权限");
});

test("按钮(type = 3):不进可见菜单,但它的 perm 进权限集合", async () => {
	const role = await caller.role.create({ code: `${TEST_PREFIX}btn_${SUFFIX}`, name: `${TEST_PREFIX}按钮角色` });
	roleIds.push(role.id);
	const menu = await makeMenu("带按钮的页", null, MENU_TYPE.MENU, null);
	const button = await makeMenu("删除按钮", menu, MENU_TYPE.BUTTON, "test:page:delete");
	await caller.role.setMenus({ roleId: role.id, menuIds: [button] });

	const dept = await makeDept("按钮部");
	const user = await makeUser("btnuser");
	await caller.department.setMemberRole({ departmentId: dept.id, userId: user, roleId: role.id });

	const effective = await effectiveMenusFor(user);
	const visible = (effective.rows ?? []).map((row) => row.id);
	assert.ok(visible.includes(menu), "按钮所在的菜单可见");
	assert.ok(!visible.includes(button), "**按钮本身不进导航**");
	assert.ok(effective.perms?.includes("test:page:delete"), "但它的 perm 进了权限集合(前端 useHasPerm 认它)");
});

after(async () => {
	await closeDb();
});
