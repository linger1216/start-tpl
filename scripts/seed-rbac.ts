/**
 * **RBAC 种子** —— 角色 / 按钮权限点 / 授权。
 *
 * 口径与其它种子脚本一致:**幂等、只补不覆盖**。已经存在的角色 / 授权一个字节都不动 ——
 * 你在界面上改过的东西,再跑一次不会被冲掉。
 *
 * 造出来的东西:
 *
 *   角色      系统管理员(全局定义,不随部门复制)
 *   按钮      各页的操作权限点(sys:role:* / sys:file:* / sys:user:* / sys:grid:* …)与隐藏的运维权限点
 *   授权      系统管理员 = *:*:*(通配:全部菜单与按钮,含以后新增的)
 *
 * ⚠️ **本脚本不建演示部门、也不建演示账号。**
 *   「上海公司 / 武汉公司 / 研发部 / 市场部」「部门主管 / 普通员工」「zhangsan@example.com」
 *   曾经由本脚本创建,现已去掉 —— 真实项目的部门与人员是外部同步进来的,初始化脚本不该再造一份。
 *   要演示数据请另写脚本,不要混进初始化流程,否则「重跑一次」就变成了「改数据」。
 *
 * 用法:pnpm db:seed:rbac(可重复跑)
 *
 * 角色怎么按业务键定位:`sys_role` 没有 `code` 列 —— 整个程序内部一律以 `id` 引用,
 * 策略表里也是 `role:<id>`。这里按**名字**查重,「系统管理员」是脚本唯一的种子角色,
 * 名字稳定、可作为种子键。
 *
 * **判重只认活着的行**(`deleted_at is null`):角色 / 菜单被软删之后,本脚本要能把它们重建出来;
 * 更关键的是**绝不能把软删行的 id 再分配出去** —— 那会造出指向"已删角色 / 已删父菜单"的脏引用。
 */
import "dotenv/config";

import { and, asc, eq } from "drizzle-orm";
import { sysMenu, sysRole, sysUser } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { ADMIN_ROLE_NAME, addUserRole, grantedMenuIdsOf, roleIdsOf, setRoleMenus } from "../src/lib/casbin.ts";
import { newId } from "../src/lib/ids.ts";
import { IMPERSONATE_PERM, MENU_TYPE } from "../src/lib/menu-spec.ts";
import { effectiveMenusFor, withAncestorIds } from "../src/lib/rbac.ts";
import { alive } from "../src/lib/soft-delete.ts";

/**
 * ⚠️ **只用于首次初始化演示数据,不要拿它去"修"数据。**
 *
 * 它是"只补不覆盖"(缺角色 / 缺成员才补),所以**跑一遍就会把人手工改过的演示账号补回原样** ——
 * 而那属于覆盖用户的决定。库里出现和你上次看到的不一致时,先判断是谁改的;判据是
 * **只清自己造的东西**(`__test__*` / `__probe__*`),其余只报告、别动手(见 AGENTS「已知陷阱」首条)。
 */

/** 已经有账号的人 —— 没有被分配部门的账号,在权限启用后会看不到任何菜单 */
const ADMIN_EMAIL = "admin@example.com";

const created = { dept: 0, role: 0, member: 0, assign: 0, grant: 0, menu: 0, user: 0 };

// ── 角色 ──────────────────────────────────────────────────────────
async function upsertRoleByName(name: string, sort: number, remark: string): Promise<string> {
	// 只认活着的角色:软删的「系统管理员」必须重建,否则会把一个已删角色的 id 继续分配/授权出去
	const [existing] = await db
		.select({ id: sysRole.id })
		.from(sysRole)
		.where(and(eq(sysRole.name, name), alive(sysRole)))
		.limit(1);
	if (existing) return existing.id;
	const id = newId();
	await db
		.insert(sysRole)
		.values({ id, name, sort, status: 1, remark, create_time: new Date(), update_time: new Date() });
	created.role += 1;
	return id;
}

// ── 按钮权限点(挂在「角色管理」下;type = 3,不进侧边栏)────────────
async function upsertButton(parentId: string, name: string, perm: string, sort: number): Promise<string> {
	const path = `#perm/${perm}`; // 不指向任何路由的占位路径(表定义要求 path 非空且唯一)
	// 只认活着的行:软删的按钮要能重建(否则新按钮会挂到一个已删父节点下,授权树上看不见)
	const [existing] = await db
		.select({ id: sysMenu.id })
		.from(sysMenu)
		.where(and(eq(sysMenu.path, path), alive(sysMenu)))
		.limit(1);
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
	const [existing] = await db
		.select({ id: sysMenu.id })
		.from(sysMenu)
		.where(and(eq(sysMenu.path, path), alive(sysMenu)))
		.limit(1);
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
	// 判据是**这个角色在策略表里还一条授权都没有**(不是"这次要加的这几条在不在")
	const existing = await grantedMenuIdsOf(roleId);
	if (existing.length > 0) return;
	const ids = await withAncestorIds(menuIds);
	if (ids.length === 0) return;
	await setRoleMenus(roleId, ids);
	created.grant += ids.length;
}

/** 分配**全局角色**(userId × 角色 id)—— 已存在就不动 */
async function assignRoleIfAbsent(userId: string, roleId: string, label: string): Promise<void> {
	const ids = await roleIdsOf(userId);
	if (ids.includes(roleId)) {
		console.log(`  · ${label} 已有这个角色,不动`);
		return;
	}
	await addUserRole(userId, roleId);
	created.assign += 1;
	console.log(`  + ${label}(角色)`);
}

async function main() {
	const adminRoleId = await upsertRoleByName(ADMIN_ROLE_NAME, 1, "示例:能看见全部菜单与按钮");

	console.log("── 按钮权限点(挂在「角色管理」下,type = 3)──");
	// 否则下面"给系统管理员全部授权"的那份清单会漏掉刚建的两个按钮(实测踩过)。
	const seeded = await db.select().from(sysMenu).where(alive(sysMenu)).orderBy(asc(sysMenu.sort), asc(sysMenu.name));
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
	// 数据权限:规则页给"管权限的人";插件页的写接口服务端还额外要求**超管**(插件能写服务端代码)
	const 数据范围MenuId = byPath.get("/settings/data-scope")?.id;
	if (数据范围MenuId) {
		await upsertButton(数据范围MenuId, "新增规则", "sys:scope:add", 90);
		await upsertButton(数据范围MenuId, "修改规则", "sys:scope:edit", 91);
		await upsertButton(数据范围MenuId, "删除规则", "sys:scope:remove", 92);
	}
	const 值域插件MenuId = byPath.get("/settings/data-plugins")?.id;
	if (值域插件MenuId) {
		await upsertButton(值域插件MenuId, "新增插件", "sys:plugin:add", 90);
		await upsertButton(值域插件MenuId, "修改插件", "sys:plugin:edit", 91);
		await upsertButton(值域插件MenuId, "删除插件", "sys:plugin:remove", 92);
		await upsertButton(值域插件MenuId, "试跑插件", "sys:plugin:test", 93);
	}
	const 日志MenuId = byPath.get("/settings/logs")?.id;
	if (日志MenuId) {
		await upsertButton(日志MenuId, "查看审计日志", "sys:log:list", 90);
	}
	const 通知MenuId = byPath.get("/notices")?.id;
	if (通知MenuId) {
		await upsertButton(通知MenuId, "手动发通知", "sys:notice:add", 90);
	}
	const 网格MenuId = byPath.get("/demo/grid")?.id;
	if (网格MenuId) {
		await upsertButton(网格MenuId, "新增网格", "sys:grid:add", 90);
		await upsertButton(网格MenuId, "编辑网格", "sys:grid:edit", 91);
		await upsertButton(网格MenuId, "删除网格", "sys:grid:remove", 92);
		await upsertButton(网格MenuId, "批量指派负责人", "sys:grid:assign", 93);
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
	// 系统管理员:**一条 `*:*:*` 就够** —— 通配模式在**装载时**展开(见 lib/casbin.ts),
	// 所以"全部菜单 + 全部按钮 + **以后新增的**"都自动在内,不用每加一个菜单就回来补勾。
	await grantIfEmpty(adminRoleId, [superPermId]);

	// 部门主管:**只给菜单、不给按钮** —— 这样切到演示账号能直接看到
	// 「页面进得去,但页里的新增 / 删除按钮不可见」(按钮级可见性)

	console.log(`  本次写入 ${created.grant} 条授权行(已配过的角色不动)`);

	console.log("── 部门成员 + 全局角色 ──");
	const [admin] = await db
		.select({ id: sysUser.id })
		.from(sysUser)
		.where(and(eq(sysUser.email, ADMIN_EMAIL), alive(sysUser)))
		.limit(1);
	if (admin) {
		await assignRoleIfAbsent(admin.id, adminRoleId, `${ADMIN_EMAIL} → ${ADMIN_ROLE_NAME}`);
	}

	// ── 收尾:把两个账号的实际可见菜单算出来,一眼能看出"并集" ──
	console.log("\n── 效果 ──");
	for (const [email, id] of [[ADMIN_EMAIL, admin?.id]] as const) {
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
			"⚠️ 权限体系现在**已启用**(`sys_casbin_rule` 里已经有授权行了):没有被分配部门与角色的账号将看不到任何菜单。",
		);
	}
	process.exit(0);
}

main().catch((error) => {
	console.error("种子失败:", error);
	process.exit(1);
});
