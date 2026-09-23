/**
 * **RBAC 演示数据种子** —— 部门 / 角色 / 成员 / 授权 / 两个演示账号。
 *
 * 口径与其它种子脚本一致:**幂等、只补不覆盖**。已经存在的部门 / 角色 / 授权 / 成员一个字节都不动 ——
 * 你在界面上改过的东西,再跑一次不会被冲掉。
 *
 * 造出来的东西(可以照着它点一遍界面):
 *
 *   部门      上海公司(研发部、市场部)、武汉公司
 *   角色      系统管理员 / 部门主管 / 普通员工(全局定义,不随部门复制)
 *   按钮      角色管理页下的「新增角色 / 删除角色」两个权限点(type = 3,不进侧边栏)
 *   授权      系统管理员 = 全部菜单与按钮;部门主管 = 一部分;普通员工 = 更少
 *   成员      admin@example.com → 上海公司 = 系统管理员(保证管理员自己不被锁死)
 *             zhangsan@example.com → 上海公司 = 部门主管 **且** 武汉公司 = 普通员工  ← 并集演示
 *
 * 用法:`pnpm db:seed:rbac`(可重复跑)
 */
import "dotenv/config";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import {
	sysDepartment,
	sysDepartmentMember,
	sysMenu,
	sysRole,
	sysRoleMenu,
	sysUser,
} from "../src/db/data-base-schema.ts";
import { auth } from "../src/lib/auth.ts";
import { newId } from "../src/lib/ids.ts";
import { MENU_TYPE } from "../src/lib/menu-spec.ts";
import { effectiveMenusFor, withAncestorIds } from "../src/lib/rbac.ts";

/** 演示账号(密码与开发账号一致,方便来回切着看) */
const DEMO_EMAIL = "zhangsan@example.com";
const DEMO_PASSWORD = "Passw0rd123";
/** 已经有账号的人 —— 没有被分配部门的账号,在权限启用后会看不到任何菜单 */
const ADMIN_EMAIL = "admin@example.com";

const created = { dept: 0, role: 0, member: 0, grant: 0, menu: 0, user: 0 };

// ── 部门 ──────────────────────────────────────────────────────────
async function upsertDepartment(name: string, parentId: string | null, sort: number): Promise<string> {
	const [existing] = await db
		.select({ id: sysDepartment.id })
		.from(sysDepartment)
		.where(
			and(
				eq(sysDepartment.name, name),
				parentId === null ? sql`${sysDepartment.parent_id} is null` : eq(sysDepartment.parent_id, parentId),
			),
		)
		.limit(1);
	if (existing) return existing.id;
	const id = newId();
	await db.insert(sysDepartment).values({
		id,
		parent_id: parentId,
		name,
		sort,
		status: 1,
		create_time: new Date(),
		update_time: new Date(),
	});
	created.dept += 1;
	return id;
}

// ── 角色 ──────────────────────────────────────────────────────────
async function upsertRole(code: string, name: string, sort: number, remark: string): Promise<string> {
	const [existing] = await db.select({ id: sysRole.id }).from(sysRole).where(eq(sysRole.code, code)).limit(1);
	if (existing) return existing.id;
	const id = newId();
	await db.insert(sysRole).values({ id, code, name, sort, status: 1, remark, create_time: new Date(), update_time: new Date() });
	created.role += 1;
	return id;
}

// ── 按钮权限点(挂在「角色管理」下;type = 3,不进侧边栏)────────────
async function upsertButton(parentId: string, name: string, perm: string, sort: number): Promise<string> {
	const path = `#perm/${perm}`; // 不指向任何路由的占位路径(表定义要求 path 非空且唯一)
	const [existing] = await db.select({ id: sysMenu.id }).from(sysMenu).where(eq(sysMenu.path, path)).limit(1);
	if (existing) return existing.id;
	const id = newId();
	await db.insert(sysMenu).values({
		id,
		parent_id: parentId,
		name,
		path,
		icon: null,
		sort,
		visible: 1,
		status: 1,
		type: MENU_TYPE.BUTTON,
		perm,
	});
	created.menu += 1;
	return id;
}

// ── 授权(只在"这个角色还一条授权都没有"时写入 = 只补不覆盖)────────
async function grantIfEmpty(roleId: string, menuIds: readonly string[]): Promise<void> {
	const existing = await db.select({ id: sysRoleMenu.id }).from(sysRoleMenu).where(eq(sysRoleMenu.role_id, roleId));
	if (existing.length > 0) return;
	const ids = await withAncestorIds(menuIds);
	if (ids.length === 0) return;
	const now = new Date();
	await db.insert(sysRoleMenu).values(ids.map((menuId) => ({ id: newId(), role_id: roleId, menu_id: menuId, create_time: now, update_time: now })));
	created.grant += ids.length;
}

// ── 成员(已存在就不动 —— 你在界面上换过的角色不会被覆盖)────────────
async function assignIfAbsent(departmentId: string, userId: string, roleId: string, label: string): Promise<void> {
	const [existing] = await db
		.select({ id: sysDepartmentMember.id })
		.from(sysDepartmentMember)
		.where(and(eq(sysDepartmentMember.department_id, departmentId), eq(sysDepartmentMember.user_id, userId)))
		.limit(1);
	if (existing) {
		console.log(`  · ${label} 已有分配,不动`);
		return;
	}
	await db.insert(sysDepartmentMember).values({
		id: newId(),
		department_id: departmentId,
		user_id: userId,
		role_id: roleId,
		create_time: new Date(),
		update_time: new Date(),
	});
	created.member += 1;
	console.log(`  + ${label}`);
}

/** 演示账号:用 BA 自己的接口建(密码会被正确地 scrypt 哈希);已存在就跳过 */
async function ensureDemoUser(): Promise<string | null> {
	const [existing] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.email, DEMO_EMAIL)).limit(1);
	if (existing) return existing.id;
	try {
		const result = await auth.api.signUpEmail({
			body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "张三" },
		});
		created.user += 1;
		// signUpEmail 会顺手建一个会话并下发 cookie —— 脚本里不需要它,删掉
		await db.execute(sql`delete from sys_session where user_id = ${result.user.id}`);
		return result.user.id;
	} catch (error) {
		console.warn(`  ! 建演示账号失败(可能已存在):${(error as Error).message}`);
		return null;
	}
}

async function main() {
	console.log("── 部门 ──");
	const shanghai = await upsertDepartment("上海公司", null, 1);
	const wuhan = await upsertDepartment("武汉公司", null, 2);
	await upsertDepartment("研发部", shanghai, 1);
	await upsertDepartment("市场部", shanghai, 2);
	console.log(`  上海公司 / 武汉公司(+ 研发部 / 市场部);本次新增 ${created.dept} 个`);

	console.log("── 角色 ──");
	const adminRole = await upsertRole("sys_admin", "系统管理员", 1, "示例:能看见全部菜单与按钮");
	const managerRole = await upsertRole("dept_manager", "部门主管", 2, "示例:看得到部门/角色/用户,但看不到参数与字典");
	const staffRole = await upsertRole("staff", "普通员工", 3, "示例:只看得见工作台、系统设置与标签管理");
	console.log(`  系统管理员 / 部门主管 / 普通员工;本次新增 ${created.role} 个`);

	console.log("── 按钮权限点(挂在「角色管理」下,type = 3)──");
	// 先取一次菜单只是为了找到「角色管理」这个父节点;按钮建好之后还要**重新读一次** ——
	// 否则下面"给系统管理员全部授权"的那份清单会漏掉刚建的两个按钮(实测踩过)。
	const seeded = await db.select().from(sysMenu).orderBy(asc(sysMenu.sort), asc(sysMenu.name));
	const byPath = new Map(seeded.map((row) => [row.path, row]));
	const rolesMenuId = byPath.get("/settings/roles")?.id;
	if (rolesMenuId) {
		await upsertButton(rolesMenuId, "新增角色", "sys:role:add", 90);
		await upsertButton(rolesMenuId, "删除角色", "sys:role:remove", 91);
	}
	console.log(`  sys:role:add / sys:role:remove;本次新增 ${created.menu} 个`);

	console.log("── 授权(只在角色还没有任何授权时写入)→ 权限体系从此启用 ──");
	// ⚠️ 重新读一次 —— 这次要**包含刚建的两个按钮**(否则管理员的"全部授权"漏按钮)
	const menus = await db.select().from(sysMenu).orderBy(asc(sysMenu.sort), asc(sysMenu.name));
	await grantIfEmpty(adminRole, menus.map((row) => row.id));

	// 部门主管:**只给菜单、不给按钮** —— 这样切到演示账号能直接看到
	// 「页面进得去,但页里的新增 / 删除按钮不可见」(按钮级可见性)
	const managerPaths = ["/", "/settings", "/settings/users", "/settings/departments", "/settings/roles"];
	const managerMenuIds = managerPaths.map((path) => byPath.get(path)?.id).filter((id): id is string => Boolean(id));
	await grantIfEmpty(managerRole, managerMenuIds);

	// 普通员工:只有工作台 + 系统设置 + 标签管理
	const staffPaths = ["/", "/settings", "/settings/tags"];
	const staffMenuIds = staffPaths.map((path) => byPath.get(path)?.id).filter((id): id is string => Boolean(id));
	await grantIfEmpty(staffRole, staffMenuIds);

	console.log(`  本次写入 ${created.grant} 条授权行(已配过的角色不动)`);

	console.log("── 成员 ──");
	const [admin] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.email, ADMIN_EMAIL)).limit(1);
	if (admin) await assignIfAbsent(shanghai, admin.id, adminRole, `${ADMIN_EMAIL} → 上海公司 = 系统管理员`);

	// `ensureDemoUser` 返回的是 **用户 id 字符串**(不是行对象)
	const demoUserId = await ensureDemoUser();
	if (demoUserId) {
		await assignIfAbsent(shanghai, demoUserId, managerRole, `${DEMO_EMAIL} → 上海公司 = 部门主管`);
		await assignIfAbsent(wuhan, demoUserId, staffRole, `${DEMO_EMAIL} → 武汉公司 = 普通员工`);
	}

	// ── 收尾:把两个账号的实际可见菜单算出来,一眼能看出"并集" ──
	console.log("\n── 效果 ──");
	for (const [email, id] of [
		[ADMIN_EMAIL, admin?.id],
		[DEMO_EMAIL, demoUserId],
	] as const) {
		if (!id) continue;
		const effective = await effectiveMenusFor(id);
		const names = effective.rows?.map((row) => row.name) ?? null;
		console.log(
			`  ${email} → 可见 ${names === null ? "0(或认不到人)" : `${names.length} 个`}` +
				`   权限标识 ${effective.perms === null ? "null(未启用)" : `${effective.perms.length} 个`}`,
		);
		if (names) console.log(`      ${names.join("、")}`);
	}
	console.log(
		`\n✓ 种子完成:部门 +${created.dept} / 角色 +${created.role} / 菜单 +${created.menu} / 授权 +${created.grant} / 成员 +${created.member} / 账号 +${created.user}`,
	);
	if (created.grant > 0) {
		console.log(
			"⚠️ 权限体系现在**已启用**(sys_role_menu 不再是空的):没有被分配部门与角色的账号将看不到任何菜单。",
		);
	}
	process.exit(0);
}

main().catch((error) => {
	console.error("种子失败:", error);
	process.exit(1);
});
