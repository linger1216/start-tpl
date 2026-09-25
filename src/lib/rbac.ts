/**
 * **权限并集的计算** —— 角色 → 菜单/按钮。
 *
 * 模型(见 `db/data-base-schema.ts` 的注释):
 *
 *   用户 --(sys_user_role, 一人多角色)--> 角色 --(sys_role_menu)--> 菜单 / 按钮
 *
 * 所以「这个用户能看到什么」= **他所有角色的授权取并集** —— 角色与部门无关(部门只是组织架构),
 * 没有"当前部门"这个概念,也不需要切换。
 *
 * 为什么把算法放在这里、而不是写在 procedure 里:这一层**只吃 `userId`**,
 * 与"怎么拿到 userId(会话)"解耦 —— 单测可以直接喂一个 id,不必造 HTTP 会话。
 *
 * ⚠️ 这里是**全站唯一的权限计算处**(服务端只有 `menu.mine` 调它,客户端只有 `hooks/use-perms.ts` 读结果)。
 * 所以通配符(`*:*:*`)的展开也放在这一处 —— 展开之后,`use-perms.ts` 和各页面**一行都不用改**。
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db";
import { sysMenu, sysRole, sysRoleMenu, sysUserRole } from "#/db/data-base-schema";
import { MENU_TYPE } from "#/lib/menu-spec";

/** `sys_menu` 的一行 */
type MenuRow = typeof sysMenu.$inferSelect;

/**
 * 权限标识(`perm`)的格式:**`域:资源:动作`**,三段小写;每段可以用一个**整段的 `*`** 通配。
 *
 * 域 = 一级模块的 key(如 `sys`),**允许长出新的域**(派生项目加模块就会多一个域)——
 * 受控的是**形状**,不是取值:菜单接口用这条规则校验,挡住两段 / 大写 / 半截通配(`sys:ro*`)这类脏值。
 */
export const PERM_FORMAT = /^(?:[a-z][a-z0-9_]*|\*):(?:[a-z][a-z0-9_]*|\*):(?:[a-z][a-z0-9_]*|\*)$/;

/** 这条 perm 是不是**模式**(含通配段)—— 只在 `effectiveMenusFor` 里用,不外传 */
function isPermPattern(perm: string): boolean {
	return perm.includes("*");
}

/**
 * 模式与权限点**逐段比较**:某段相等、或模式那一段是 `*`,即算匹配。
 *
 * 段数必须一致 —— 所以 `sys:role`(两段)匹配不到任何东西(不放行,也不报错)。
 * 只支持**整段**通配(`sys:role:*`),不支持半截(`sys:ro*`)—— 后者在接口层就被 `PERM_FORMAT` 挡住。
 */
export function permMatches(pattern: string, code: string): boolean {
	const p = pattern.split(":");
	const c = code.split(":");
	return p.length === c.length && p.every((seg, i) => seg === "*" || seg === c[i]);
}

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

	// 该用户所有「启用的角色」—— 角色是全局的,与部门无关(见 sys_user_role)
	const assignments = await db
		.select({ roleId: sysUserRole.role_id })
		.from(sysUserRole)
		.innerJoin(sysRole, eq(sysRole.id, sysUserRole.role_id))
		.where(and(eq(sysUserRole.user_id, userId), eq(sysRole.status, 1)));
	const roleIds = [...new Set(assignments.map((row) => row.roleId))];
	if (roleIds.length === 0) return { rows: null, perms: [] };

	const granted = await db
		.select({ menuId: sysRoleMenu.menu_id })
		.from(sysRoleMenu)
		.where(inArray(sysRoleMenu.role_id, roleIds));

	const grantedIds = granted.map((row) => row.menuId);
	const grantedSet = new Set(grantedIds);

	/**
	 * **通配模式在这里展开**(`*:*:*` / `sys:*:*` / `sys:role:*`)。
	 *
	 * 做法:把"被模式命中的菜单行"当成**被授权**的行,再走同一套祖先补全 ——
	 * 于是一个模式的效果和"手勾上这些行"完全一样,没有第二套可见性规则。
	 * 因为是**读的时候**算,`*:*:*` 自动覆盖**以后新增的域 / 菜单 / 按钮**(不用回来补勾)——
	 * 这正是"不用一个一个赋权限"的价值所在。
	 */
	const grantedPerms = all.filter((row) => grantedSet.has(row.id) && row.perm).map((row) => row.perm as string);
	const activePatterns = [...new Set(grantedPerms.filter((perm) => isPermPattern(perm)))];
	const patternHitIds =
		activePatterns.length === 0
			? []
			: all
					.filter((row) => row.perm && activePatterns.some((p) => permMatches(p, row.perm as string)))
					.map((row) => row.id);

	// 并集 + 祖先补全(**一次**算完所有授权的祖先,别在循环里逐条查)
	const allowed = new Set(await withAncestorIds([...grantedIds, ...patternHitIds]));

	const rows = navigable(all).filter((row) => allowed.has(row.id));
	const perms = [...new Set(all.filter((row) => allowed.has(row.id) && row.perm).map((row) => row.perm as string))];
	// 可见菜单为空 → 返回 null(区别于"菜单表为空"),展示层据此决定"什么都不显示"
	return { rows: rows.length > 0 ? rows : null, perms };
}

/**
 * **tRPC 路径 → 权限码**的映射(服务端强制的唯一真源)。
 *
 * 设计取舍:与其在 55 个 procedure 上各写一次 `permProcedure("…")`(漏写一个就**静默放开**),
 * 不如把映射收在这一张表里、由中间件按 `path` **结构性**查 —— 与"日志天然全覆盖"同一个思路。
 *
 * ⚠️ **登记在这里的码,必须先在 `sys_menu` 里有对应按钮**(`scripts/seed-rbac.ts` 建):
 * 要求一个"没人能被授予"的码,结果是**已授权的账号集体失权**。现在 35 条写接口已全部登记,
 * `UNMAPPED_MUTATIONS` **为空** —— `tests/auth.test.ts` 的分类守卫会强制后续新增接口也显式登记。
 */
export const PERM_BY_PATH: Record<string, string> = {
	// 文件
	"file.presign": "sys:file:upload",
	"file.confirm": "sys:file:upload",
	"file.rename": "sys:file:edit",
	"file.remove": "sys:file:remove",
	// 菜单
	"menu.create": "sys:menu:add",
	"menu.update": "sys:menu:edit",
	"menu.delete": "sys:menu:remove",
	"menu.reorder": "sys:menu:sort",
	// 字典
	"dict.create": "sys:dict:add",
	"dict.update": "sys:dict:edit",
	"dict.delete": "sys:dict:remove",
	// 参数
	"para.create": "sys:para:add",
	"para.update": "sys:para:edit",
	"para.delete": "sys:para:remove",
	// 标签
	"tag.create": "sys:tag:add",
	"tag.update": "sys:tag:edit",
	"tag.delete": "sys:tag:remove",
	"tag.move": "sys:tag:move",
	"tag.link": "sys:tag:link",
	"tag.unlink": "sys:tag:link",
	// 部门
	"department.create": "sys:department:add",
	"department.update": "sys:department:edit",
	"department.remove": "sys:department:remove",
	"department.reorder": "sys:department:sort",
	"department.addMember": "sys:department:member",
	"department.removeMember": "sys:department:member",
	// 角色
	"role.create": "sys:role:add",
	"role.update": "sys:role:edit",
	"role.remove": "sys:role:remove",
	"role.addUser": "sys:role:user",
	"role.removeUser": "sys:role:user",
	"role.setMenus": "sys:role:perm",
	// 用户
	"user.create": "sys:user:add",
	"user.update": "sys:user:edit",
	"user.remove": "sys:user:remove",
	// 审计日志(读接口也走这张表)
	"log.list": "sys:log:list",
	// 站内通知(读自己的不需要权限点;替别人发才需要)
	"notice.create": "sys:notice:add",
};

/**
 * **只要求登录、不需要权限点**的写接口。
 *
 * 两类会出现在这里,加的时候都要写清属于哪一类:
 *
 * 1. **天生自限范围** —— 接口在 SQL 层只动"自己那一份数据"(如通知的已读),任何登录用户都该能用;
 * 2. **还没建权限点** —— 强制会制造"没人能被授予"的假权限,等按钮建好再挪进 `PERM_BY_PATH`。
 *
 * `tests/auth.test.ts` 的**分类守卫**强制每次新增写接口都显式二选一,不允许悄悄溜进来。
 */
export const UNMAPPED_MUTATIONS: readonly string[] = [
	// 类别 1:通知的已读 —— `user_id` 一律取 `ctx.user.id`,碰不到别人的行(见 doc/通知中心.md)
	"notice.read",
	"notice.readAll",
];
