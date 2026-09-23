/**
 * **权限并集的计算** —— 部门 → 角色 → 菜单/按钮。
 *
 * 模型(见 `db/data-base-schema.ts` 的注释):
 *
 *   用户 --(sys_department_member, 一人多部门, 每部门一个角色)--> 角色 --(sys_role_menu)--> 菜单 / 按钮
 *
 * 所以「这个用户能看到什么」= **他所有 (部门, 角色) 组合的授权取并集** ——
 * 没有"当前部门"这个概念,也不需要切换。张三在「上海=管理员、武汉=员工」,
 * 看到的就是两个角色菜单的并集。
 *
 * 为什么把算法放在这里、而不是写在 procedure 里:这一层**只吃 `userId`**,
 * 与"怎么拿到 userId(会话)"解耦 —— 单测可以直接喂一个 id,不必造 HTTP 会话。
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db";
import { sysDepartment, sysDepartmentMember, sysMenu, sysRole, sysRoleMenu } from "#/db/data-base-schema";
import { MENU_TYPE } from "#/lib/menu-spec";

/** `sys_menu` 的一行 */
type MenuRow = typeof sysMenu.$inferSelect;

type EffectiveMenus = {
	/**
	 * 该用户**可见**的菜单行(已排除按钮)。
	 *
	 * ⚠️ 两种"空"含义不同,展示层必须区分:
	 *  - `[]`  = 菜单表本身是空的(**权限体系未启用**)→ 调用方回落到代码里的静态 NAV_NODES(不白屏);
	 *  - `null`= **权限体系已启用,但这个人没有可见菜单**(或认不到人)→ 就是什么都不显示,不要回落静态菜单
	 *            (回落等于把全部菜单漏给他)。
	 */
	rows: MenuRow[] | null;
	/** 权限标识集合(`perm`);`null` = 权限体系未启用 → 一律放行 */
	perms: string[] | null;
};

/**
 * `sys_role_menu` 是否**一条都没有** —— 这是「权限体系是否启用」的唯一判据。
 *
 * 为什么要有这个开关:模板/新项目刚建好时没有任何授权记录,如果没有这个兜底,
 * 每个人(包括管理员自己)登录后都会看到空侧边栏 —— 把自己锁在外面。
 * 一旦配了第一条授权,过滤立即生效。
 */
async function isPermissionConfigured(): Promise<boolean> {
	const [row] = await db.select({ n: sql<number>`count(*)` }).from(sysRoleMenu);
	return Number(row?.n ?? 0) > 0;
}

/**
 * 补全祖先链 —— 授权只勾了子节点时,把它的父/祖父也一并算上。
 *
 * 为什么必须有:侧边栏是**按 parentId 拼树**的,只授权一个深层的子菜单、
 * 父节点没授权 → 那一枝在树上根本无处安放,结果是"勾了却看不见"。
 * 写入时(`role.setMenus`)与读取时(这里)都用同一份逻辑,避免两处口径漂移。
 */
export async function withAncestorIds(ids: readonly string[]): Promise<string[]> {
	if (ids.length === 0) return [];
	const rows = await db.select({ id: sysMenu.id, parentId: sysMenu.parent_id }).from(sysMenu);
	const parentOf = new Map(rows.map((row) => [row.id, row.parentId ?? null]));
	const out = new Set<string>();
	for (const id of ids) {
		let cursor: string | null = id;
		// `seen` 兼作环形数据的保险(脏数据下最多走一圈,不会死循环)
		const seen = new Set<string>();
		while (cursor && !seen.has(cursor)) {
			seen.add(cursor);
			out.add(cursor);
			cursor = parentOf.get(cursor) ?? null;
		}
	}
	return [...out];
}

/** 该用户的可见菜单 + 权限标识(并集) */
export async function effectiveMenusFor(userId: string | null): Promise<EffectiveMenus> {
	const all = await db.select().from(sysMenu).orderBy(asc(sysMenu.sort), asc(sysMenu.name));
	const navigable = (rows: readonly MenuRow[]) => rows.filter((row) => Number(row.type) !== MENU_TYPE.BUTTON);

	if (!(await isPermissionConfigured())) {
		// 未启用:全部可见菜单,perms = null(调用方一律放行)
		return { rows: navigable(all), perms: null };
	}
	if (!userId) {
		/**
		 * 权限体系开着,但认不到人 —— **失败关闭**:菜单什么都不给(且不要回落静态菜单),
		 * 权限集合给空数组(而不是 `null` —— 那个代表"未启用、一律放行")。
		 * 正常路径上到不了这里:`(main)` 的守卫已经保证了会话。
		 */
		return { rows: null, perms: [] };
	}

	// 该用户所有「启用的部门 × 启用的角色」
	const memberships = await db
		.select({ roleId: sysDepartmentMember.role_id })
		.from(sysDepartmentMember)
		.innerJoin(sysRole, eq(sysRole.id, sysDepartmentMember.role_id))
		.innerJoin(sysDepartment, eq(sysDepartment.id, sysDepartmentMember.department_id))
		.where(and(eq(sysDepartmentMember.user_id, userId), eq(sysRole.status, 1), eq(sysDepartment.status, 1)));
	const roleIds = [...new Set(memberships.map((row) => row.roleId))];
	if (roleIds.length === 0) return { rows: null, perms: [] };

	const granted = await db
		.select({ menuId: sysRoleMenu.menu_id })
		.from(sysRoleMenu)
		.where(inArray(sysRoleMenu.role_id, roleIds));

	// 并集 + 祖先补全(**一次**算完所有授权的祖先,别在循环里逐条查)
	const allowed = new Set(await withAncestorIds(granted.map((row) => row.menuId)));

	const rows = navigable(all).filter((row) => allowed.has(row.id));
	const perms = [...new Set(all.filter((row) => allowed.has(row.id) && row.perm).map((row) => row.perm as string))];
	// 可见菜单为空 → 返回 null(区别于"菜单表为空"),展示层据此决定"什么都不显示"
	return { rows: rows.length > 0 ? rows : null, perms };
}
