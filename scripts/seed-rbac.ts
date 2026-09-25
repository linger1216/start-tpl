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
	sysDept,
	sysUserDept,
	sysMenu,
	sysRole,
	sysRoleMenu,
	sysUser,
	sysUserRole,
} from "../src/db/data-base-schema.ts";
import { auth } from "../src/lib/auth.ts";
import { newId } from "../src/lib/ids.ts";
import { IMPERSONATE_PERM, MENU_TYPE } from "../src/lib/menu-spec.ts";
import { effectiveMenusFor, withAncestorIds } from "../src/lib/rbac.ts";

/**
 * ⚠️ **只用于首次初始化演示数据,不要拿它去"修"数据。**
 *
 * 它是"只补不覆盖"(缺角色 / 缺成员才补),所以**跑一遍就会把人手工改过的演示账号补回原样** ——
 * 而那属于覆盖用户的决定。库里出现和你上次看到的不一致时,先判断是谁改的;判据是
 * **只清自己造的东西**(`__test__*` / `__probe__*`),其余只报告、别动手(见 AGENTS「已知陷阱」首条)。
 */

/** 演示账号(密码与开发账号一致,方便来回切着看) */
const DEMO_EMAIL = "zhangsan@example.com";
const DEMO_PASSWORD = "Passw0rd123";
/** 已经有账号的人 —— 没有被分配部门的账号,在权限启用后会看不到任何菜单 */
const ADMIN_EMAIL = "admin@example.com";

const created = { dept: 0, role: 0, member: 0, assign: 0, grant: 0, menu: 0, user: 0 };

// ── 部门 ──────────────────────────────────────────────────────────
async function upsertDepartment(name: string, parentId: string | null, sort: number): Promise<string> {
	const [existing] = await db
		.select({ id: sysDept.id })
		.from(sysDept)
		.where(
			and(
				eq(sysDept.name, name),
				parentId === null ? sql`${sysDept.parent_id} is null` : eq(sysDept.parent_id, parentId),
			),
		)
		.limit(1);
	if (existing) return existing.id;
	const id = newId();
	await db.insert(sysDept).values({
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
// ── 隐藏分组(只用来承载"运维"这类权限点:visible = 0,不进侧边栏)──────
async function upsertHiddenGroup(name: string, path: string, sort: number): Promise<string> {
	const [existing] = await db.select({ id: sysMenu.id }).from(sysMenu).where(eq(sysMenu.path, path)).limit(1);
	if (existing) return existing.id;
	const id = newId();
	await db.insert(sysMenu).values({
		id,
		parent_id: null,
		name,
		path,
		icon: null,
		sort,
		visible: 0,
		status: 1,
		type: MENU_TYPE.DIR,
		perm: null,
	});
	created.menu += 1;
	return id;
}

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
/** 把人加进部门(组织架构;**角色不在这张表上**)—— 已存在就不动 */
async function addMemberIfAbsent(departmentId: string, userId: string, label: string): Promise<void> {
	const [existing] = await db
		.select({ id: sysUserDept.id })
		.from(sysUserDept)
		.where(and(eq(sysUserDept.department_id, departmentId), eq(sysUserDept.user_id, userId)))
		.limit(1);
	if (existing) {
		console.log(`  · ${label} 已是部门成员,不动`);
		return;
	}
	await db.insert(sysUserDept).values({
		id: newId(),
		department_id: departmentId,
		user_id: userId,
		create_time: new Date(),
		update_time: new Date(),
	});
	created.member += 1;
	console.log(`  + ${label}(部门成员)`);
}

/** 分配**全局角色**(userId × roleId)—— 已存在就不动 */
async function assignRoleIfAbsent(userId: string, roleId: string, label: string): Promise<void> {
	const [existing] = await db
		.select({ id: sysUserRole.id })
		.from(sysUserRole)
		.where(and(eq(sysUserRole.user_id, userId), eq(sysUserRole.role_id, roleId)))
		.limit(1);
	if (existing) {
		console.log(`  · ${label} 已有这个角色,不动`);
		return;
	}
	await db.insert(sysUserRole).values({
		id: newId(),
		user_id: userId,
		role_id: roleId,
		create_time: new Date(),
		update_time: new Date(),
	});
	created.assign += 1;
	console.log(`  + ${label}(角色)`);
}

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
	// 否则下面"给系统管理员全部授权"的那份清单会漏掉刚建的两个按钮(实测踩过)。
	const seeded = await db.select().from(sysMenu).orderBy(asc(sysMenu.sort), asc(sysMenu.name));
	const byPath = new Map(seeded.map((row) => [row.path, row]));
	const rolesMenuId = byPath.get("/settings/roles")?.id;
	if (rolesMenuId) {
		await upsertButton(rolesMenuId, "新增角色", "sys:role:add", 90);
		await upsertButton(rolesMenuId, "删除角色", "sys:role:remove", 91);
	}
	console.log(`  sys:role:add / sys:role:remove;本次新增 ${created.menu} 个`);

	console.log("── 按钮权限点(挂在「文件管理」下,type = 3)──");
	const filesMenuId = byPath.get("/settings/files")?.id;
	if (filesMenuId) {
		await upsertButton(filesMenuId, "上传文件", "sys:file:upload", 90);
		await upsertButton(filesMenuId, "重命名文件", "sys:file:edit", 91);
		await upsertButton(filesMenuId, "删除文件", "sys:file:remove", 92);
	}
	console.log("  sys:file:upload / sys:file:edit / sys:file:remove");

	console.log("── 按钮权限点(其余各页,type = 3)──");
	// ⚠️ 这些是**服务端强制**用的权限码(见 `lib/rbac.ts` 的 `PERM_BY_PATH`):
	//    按钮不存在时,角色授权树里就勾不到它 —— 那么"给某个角色开这个动作"这件事根本无法表达。
	//    只建点、**不替任何角色授权**:系统管理员是 `*:*:*` 通配(自动全覆盖),
	//    部门主管 / 普通员工是刻意"只给菜单不给按钮"的演示角色,不动它们。
	const 菜单管理MenuId = byPath.get("/settings/menus")?.id;
	if (菜单管理MenuId) {
		await upsertButton(菜单管理MenuId, "新增菜单", "sys:menu:add", 90);
		await upsertButton(菜单管理MenuId, "修改菜单", "sys:menu:edit", 91);
		await upsertButton(菜单管理MenuId, "删除菜单", "sys:menu:remove", 92);
		await upsertButton(菜单管理MenuId, "菜单排序", "sys:menu:sort", 93);
	}
	const 字典管理MenuId = byPath.get("/settings/dictionary")?.id;
	if (字典管理MenuId) {
		await upsertButton(字典管理MenuId, "新增字典", "sys:dict:add", 90);
		await upsertButton(字典管理MenuId, "修改字典", "sys:dict:edit", 91);
		await upsertButton(字典管理MenuId, "删除字典", "sys:dict:remove", 92);
	}
	const 参数管理MenuId = byPath.get("/settings/parameters")?.id;
	if (参数管理MenuId) {
		await upsertButton(参数管理MenuId, "新增参数", "sys:para:add", 90);
		await upsertButton(参数管理MenuId, "修改参数", "sys:para:edit", 91);
		await upsertButton(参数管理MenuId, "删除参数", "sys:para:remove", 92);
	}
	const 标签管理MenuId = byPath.get("/settings/tags")?.id;
	if (标签管理MenuId) {
		await upsertButton(标签管理MenuId, "新增标签", "sys:tag:add", 90);
		await upsertButton(标签管理MenuId, "修改标签", "sys:tag:edit", 91);
		await upsertButton(标签管理MenuId, "删除标签", "sys:tag:remove", 92);
		await upsertButton(标签管理MenuId, "移动标签", "sys:tag:move", 93);
		await upsertButton(标签管理MenuId, "调整标签关联", "sys:tag:link", 94);
	}
	const 部门管理MenuId = byPath.get("/settings/departments")?.id;
	if (部门管理MenuId) {
		await upsertButton(部门管理MenuId, "新增部门", "sys:department:add", 90);
		await upsertButton(部门管理MenuId, "修改部门", "sys:department:edit", 91);
		await upsertButton(部门管理MenuId, "删除部门", "sys:department:remove", 92);
		await upsertButton(部门管理MenuId, "部门排序", "sys:department:sort", 93);
		await upsertButton(部门管理MenuId, "调整部门成员", "sys:department:member", 94);
	}
	const 角色管理MenuId = byPath.get("/settings/roles")?.id;
	if (角色管理MenuId) {
		await upsertButton(角色管理MenuId, "修改角色", "sys:role:edit", 90);
		await upsertButton(角色管理MenuId, "调整角色成员", "sys:role:user", 91);
		await upsertButton(角色管理MenuId, "保存角色权限", "sys:role:perm", 92);
	}
	const 日志MenuId = byPath.get("/settings/logs")?.id;
	if (日志MenuId) {
		await upsertButton(日志MenuId, "查看审计日志", "sys:log:list", 90);
	}
	const 用户管理MenuId = byPath.get("/settings/users")?.id;
	if (用户管理MenuId) {
		await upsertButton(用户管理MenuId, "新增用户", "sys:user:add", 90);
		await upsertButton(用户管理MenuId, "修改用户", "sys:user:edit", 91);
		await upsertButton(用户管理MenuId, "删除用户", "sys:user:remove", 92);
	}
	console.log(`  本次新增 ${created.menu} 个按钮权限点`);

	console.log("── 运维权限点(隐藏分组,type = 3)──");
	// 这一组 visible = 0:不进侧边栏,只在菜单管理 / 角色授权树里可见。
	// `*:*:*` 是**通配模式**(逐段匹配,见 lib/rbac.ts):授权它 = 全部权限点,**含以后新增的**。
	const opsGroupId = await upsertHiddenGroup("运维工具", "#ops", 99);
	const superPermId = await upsertButton(opsGroupId, "全部权限(通配)", "*:*:*", 1);
	await upsertButton(opsGroupId, "切换用户(运维)", IMPERSONATE_PERM, 2);
	console.log(`  *:*:* / ${IMPERSONATE_PERM};本次新增 ${created.menu} 个`);

	console.log("── 授权(只在角色还没有任何授权时写入)→ 权限体系从此启用 ──");
	// 系统管理员:**一条 `*:*:*` 就够** —— 通配模式在读取时展开(见 lib/rbac.ts),
	// 所以"全部菜单 + 全部按钮 + **以后新增的**"都自动在内,不用每加一个菜单就回来补勾。
	await grantIfEmpty(adminRole, [superPermId]);

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

	console.log("── 部门成员 + 全局角色 ──");
	const [admin] = await db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.email, ADMIN_EMAIL)).limit(1);
	if (admin) {
		await addMemberIfAbsent(shanghai, admin.id, `${ADMIN_EMAIL} → 上海公司`);
		await assignRoleIfAbsent(admin.id, adminRole, `${ADMIN_EMAIL} → 系统管理员`);
	}

	// `ensureDemoUser` 返回的是 **用户 id 字符串**(不是行对象)
	const demoUserId = await ensureDemoUser();
	if (demoUserId) {
		await addMemberIfAbsent(shanghai, demoUserId, `${DEMO_EMAIL} → 上海公司`);
		await addMemberIfAbsent(wuhan, demoUserId, `${DEMO_EMAIL} → 武汉公司`);
		await assignRoleIfAbsent(demoUserId, managerRole, `${DEMO_EMAIL} → 部门主管`);
		await assignRoleIfAbsent(demoUserId, staffRole, `${DEMO_EMAIL} → 普通员工`);
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
		`\n✓ 种子完成:部门 +${created.dept} / 角色 +${created.role} / 菜单 +${created.menu} / 授权 +${created.grant} / 部门成员 +${created.member} / 角色分配 +${created.assign} / 账号 +${created.user}`,
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
