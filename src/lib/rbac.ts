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
 * ⚠️ 这里是**全站唯一的权限计算处**(服务端只有 `menu.mine`、`(main)` 的路由守卫与 tRPC 权限中间件调它,
 * 客户端只有 `hooks/use-perms.ts` 读结果)。所以通配符(`*:*:*`)的展开也放在这一处 ——
 * 展开之后,`use-perms.ts` 和各页面**一行都不用改**。
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

/**
 * **菜单路径 → 合成权限码**:`/settings/data-policy` → `page:settings_data_policy:view`。
 *
 * 为什么用合成码而不是给每个页面再建一个按钮权限点:页面可见性**就是菜单授权**——
 * "勾了这个菜单" = "能进这个页面 + 能调它用的读接口"。合成码让读接口能复用同一份判据,
 * 又不用在 `sys_menu` 里造 `page:*` 按钮(那会多出一批**没人能被授予**的假权限点)。
 *
 * 形状守规矩:非字母数字一律折算成 `_`,所以三段都满足 `PERM_FORMAT`、也能被 `permMatches` 逐段比较;
 * `page` 是新的域 —— 与 `sys:*` 的段值天然不同,不会互相误匹配。
 * 根路径 `/` 折算成 `page:root:view`(它落在 `ALWAYS_VIEWABLE_PATHS` 里,守卫对它直接放行,这个码只是占位)。
 */
export function pagePermOf(pathname: string): string {
	const key =
		pathname
			.replace(/^\//, "")
			.replace(/[^a-zA-Z0-9]+/g, "_")
			.toLowerCase() || "root";
	return `page:${key}:view`;
}

/**
 * **只要求登录、不需要菜单授权**的页面路径。
 *
 * - `/` 工作台 = 登录后的落地页,把它拦掉等于"没勾菜单的人登录即 403";
 * - `/notices` 通知中心 = 刻意不发菜单授权(`scripts/seed-demo.ts` 的演示账号没有它),
 *   但顶栏铃铛在每个页面都指过来 —— 拦它等于把铃铛点坏了。
 *
 * 除此之外**不在**菜单表里的路径(如 `/blank`)也一律放行:菜单表管的是菜单驱动的页面。
 */
const ALWAYS_VIEWABLE_PATHS: readonly string[] = ["/", "/notices"];

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
 * 菜单访问的**完整**计算结果 —— 比 `EffectiveMenus` 多一张"全站菜单驱动的页面"表。
 *
 * 路由守卫要区分三种路径:① 菜单驱动的页面 → 按菜单授权判;② 登录落地页/通知中心 → 放行;
 * ③ 压根不在菜单表里的页面(如 `/blank`)→ 放行。这张表 + `ALWAYS_VIEWABLE_PATHS` 就是全部判据。
 */
type MenuAccess = EffectiveMenus & {
	/** 菜单驱动的页面:**路径 → 菜单名**(菜单名给 403 页显示"「X」没有授权") */
	pages: ReadonlyMap<string, string>;
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

/**
 * 该用户**启用的角色**(角色是全局的,与部门无关 —— 见 `sys_user_role`)。
 *
 * 单独抽出来是因为**功能权限**与**数据权限**都要用它:菜单侧只要 `id`(`sys_role_menu` 按角色授权),
 * 数据权限侧还要 `code`(`sys_data_policy` 里的主体写成 `role:<code>`)。全站原本只有一处这个 join,
 * 再抄一遍必然漂。
 */
export async function enabledRolesOf(userId: string): Promise<{ id: string; code: string }[]> {
	const rows = await db
		.select({ id: sysRole.id, code: sysRole.code })
		.from(sysUserRole)
		.innerJoin(sysRole, eq(sysRole.id, sysUserRole.role_id))
		.where(and(eq(sysUserRole.user_id, userId), eq(sysRole.status, 1)));
	// 去重:同一个角色只会有一条 sys_user_role,但脏数据下也别让下游算两遍
	return [...new Map(rows.map((row) => [row.id, row])).values()];
}

/** 该用户的可见菜单 + 权限标识(并集) */
export async function effectiveMenusFor(userId: string | null): Promise<EffectiveMenus> {
	const { rows, perms } = await computeMenuAccess(userId);
	return { rows, perms };
}

/**
 * 该用户能打开哪些**页面**(服务端强制的页面级判据,`(main)/route.tsx` 的 `beforeLoad` 用它)。
 *
 * 判据只有一条:**菜单授权**。勾了菜单就能进这个页面、也能调这个页面用的读接口 ——
 * 侧边栏隐藏只是"看不见入口",不是"进不去",所以这里必须与服务端一起拦(否则记住 url 就能读)。
 *
 * 返回 `pageName` 是给 403 页显示用的(菜单表里的显示名),页面不在菜单表里时为 `null`。
 */
export async function canViewPath(
	userId: string | null,
	pathname: string,
): Promise<{ allowed: boolean; pageName: string | null }> {
	const { pages, perms } = await computeMenuAccess(userId);
	const pageName = pages.get(pathname) ?? null;
	// 权限体系未启用(菜单表空)⇒ 一律放行,与中间件、`useHasPerm` 同口径
	if (perms === null) return { allowed: true, pageName };
	if (ALWAYS_VIEWABLE_PATHS.includes(pathname)) return { allowed: true, pageName };
	// 不在菜单表里的页面:菜单驱动不到它(如 `/blank`),只要求登录
	if (!pages.has(pathname)) return { allowed: true, pageName };
	return { allowed: perms.includes(pagePermOf(pathname)), pageName };
}

/** `effectiveMenusFor` / `canViewPath` 的共同实现(一次查询同时满足两种问法,别各查一遍) */
async function computeMenuAccess(userId: string | null): Promise<MenuAccess> {
	const all = await db.select().from(sysMenu).orderBy(asc(sysMenu.sort), asc(sysMenu.name));
	const navigable = (rows: readonly MenuRow[]) => rows.filter((row) => Number(row.type) !== MENU_TYPE.BUTTON);
	// 菜单驱动的页面:路径以 `/` 开头(分组节点是 `#group/…`、按钮是 `#perm/…`)。
	// `sys_menu.path` 是 not null + unique,所以这里天然不重复。
	const pages = new Map(
		navigable(all)
			.filter((row) => row.path?.startsWith("/"))
			.map((row) => [row.path as string, row.name] as const),
	);

	if (!(await isPermissionConfigured())) {
		// 未启用:全部可见菜单,perms = null(调用方一律放行)
		return { rows: navigable(all), perms: null, pages };
	}
	if (!userId) {
		/**
		 * 权限体系开着,但认不到人 —— **失败关闭**:菜单什么都不给(且不要回落静态菜单),
		 * 权限集合给空数组(而不是 `null` —— 那个代表"未启用、一律放行")。
		 * 正常路径上到不了这里:`(main)` 的守卫已经保证了会话。
		 */
		return { rows: null, perms: [], pages };
	}

	const roleIds = (await enabledRolesOf(userId)).map((role) => role.id);
	if (roleIds.length === 0) return { rows: null, perms: [], pages };

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
	/**
	 * 权限集合 = ① 授权行自带的按钮码 + ② **可见页面**折算出来的 `page:*:view` 合成码。
	 *
	 * ② 是页面级判据:读接口的 `PERM_BY_PATH` 就登记这些码(一个读接口被多个页面用时取"或"),
	 * 于是"菜单勾上 = 页面进得去 = 它的读接口调得动",三处口径永远一致。
	 */
	const pageCodes = rows.flatMap((row) => (row.path?.startsWith("/") ? [pagePermOf(row.path)] : []));
	const perms = [
		...new Set([
			...all.filter((row) => allowed.has(row.id) && row.perm).map((row) => row.perm as string),
			...pageCodes,
		]),
	];
	// 可见菜单为空 → 返回 null(区别于"菜单表为空"),展示层据此决定"什么都不显示"
	return { rows: rows.length > 0 ? rows : null, perms, pages };
}

/**
 * **tRPC 路径 → 权限码**的映射(服务端强制的唯一真源)。
 *
 * 设计取舍:与其在 71 个 procedure 上各写一次 `permProcedure("…")`(漏写一个就**静默放开**),
 * 不如把映射收在这一张表里、由中间件按 `path` **结构性**查 —— 与"日志天然全覆盖"同一个思路。
 *
 * **值可以是数组**(命中任一即放行):读接口常被多个页面共用(如 `role.list` 在角色/用户/部门/
 * 数据权限四个页面都用),写死一个码会把别的页面打死。数组里放的是 `pagePermOf(页面路径)` 合成的
 * 页面码 —— 复用菜单授权,不新增"没人能被授予"的假权限点。
 *
 * ⚠️ **登记在这里的 `sys:*` 码,必须先在 `sys_menu` 里有对应按钮**(`scripts/seed-rbac.ts` 建):
 * 要求一个"没人能被授予"的码,结果是**已授权的账号集体失权**。`tests/auth.test.ts` 的
 * **分类守卫**(`PERM_BY_PATH` ∪ `UNMAPPED_MUTATIONS` ∪ `UNMAPPED_QUERIES` = 全部接口)会强制
 * 后续新增接口也显式登记。
 */
export const PERM_BY_PATH: Record<string, string | readonly string[]> = {
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
	/**
	 * ===== 读接口 =====
	 *
	 * 页面级判据:`pagePermOf(路径)` 合成的页面码 = "这个页面的菜单勾上了"。
	 * 数组 = 这些页面里**任意一个**可见就放行(读接口被多页共用;写死一个会把别的页面打死)。
	 * 只拦"页面数据",不拦跨页面的外壳读接口(见 `UNMAPPED_QUERIES` 的理由)。
	 */
	// 角色(角色页 / 用户的角色指派 / 部门的人员角色 / 数据权限的按角色授权)
	"role.list": [
		pagePermOf("/settings/roles"),
		pagePermOf("/settings/users"),
		pagePermOf("/settings/departments"),
		pagePermOf("/settings/data-policy"),
	],
	"role.users": pagePermOf("/settings/roles"),
	"role.menuIds": pagePermOf("/settings/roles"),
	// 部门(部门页 / 用户页的部门树 / 数据权限的组织范围 / 网格履职的组织筛选)
	"department.tree": [
		pagePermOf("/settings/departments"),
		pagePermOf("/settings/users"),
		pagePermOf("/settings/data-policy"),
		pagePermOf("/demo/grid"),
	],
	"department.members": pagePermOf("/settings/departments"),
	// 字典(字典页;`dict.byCode` 是跨页面的取值器,见 UNMAPPED_QUERIES)
	"dict.list": pagePermOf("/settings/dictionary"),
	// 菜单(菜单页 / 角色页的授权树)
	"menu.list": [pagePermOf("/settings/menus"), pagePermOf("/settings/roles")],
	// 参数(参数页;`para.byKey` 是外壳偏好,见 UNMAPPED_QUERIES)
	"para.list": pagePermOf("/settings/parameters"),
	// 文件(文件页 + 它的详情弹窗)
	"file.list": pagePermOf("/settings/files"),
	"file.url": pagePermOf("/settings/files"),
	// 审计日志(读接口也走这张表)
	"log.list": "sys:log:list",
	// 数据权限(读接口也走这张表:看得到规则 = 看得到全站谁能看什么)
	"policy.list": "sys:policy:list",
	"policy.explain": "sys:policy:list",
	"policy.create": "sys:policy:add",
	"policy.update": "sys:policy:edit",
	// 批量改标量(动作 / 效果 / 启用)与改一行是同一件事的两种粒度,共用 `sys:policy:edit`
	"policy.updateMany": "sys:policy:edit",
	"policy.remove": "sys:policy:remove",
	// 站内通知(读自己的不需要权限点;替别人发才需要)
	"notice.create": "sys:notice:add",
	// Demo 网格履职(行级数据权限的演示表;数据权限页的"具体数据行"也要读它)
	"demoGrid.list": [pagePermOf("/demo/grid"), pagePermOf("/settings/data-policy")],
	"demoGrid.create": "sys:grid:add",
	"demoGrid.update": "sys:grid:edit",
	"demoGrid.remove": "sys:grid:remove",
	"demoGrid.assign": "sys:grid:assign",
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

/**
 * **只要求登录、不需要权限点**的读接口(query)。
 *
 * 判据与 `UNMAPPED_MUTATIONS` 同款(`tests/auth.test.ts` 的分类守卫强制每个 query 显式二选一),
 * 但读接口的取舍点不同:**登记一个跨页面的外壳读接口,等于把整个外壳打死**。所以这里放的是
 * "每个页面都在用、或天生只读自己"的那些 —— 加进来必须写清属于哪一类:
 *
 * 1. **外壳级** —— 侧边栏、顶栏、工作台、页面偏好:任何登录用户都要用,拦它会让全站打不开;
 * 2. **天生自限范围** —— SQL 只读"自己那一份"(如通知),或只回姓名/组织这类展示信息;
 * 3. **还没有调用方** —— 强制登记会制造一个"没人能被授予"的假权限点。
 *
 * 登记进 `PERM_BY_PATH` 的读接口 = **页面数据**(谁看不见这个页面,就取不到它的数据)。
 */
export const UNMAPPED_QUERIES: readonly string[] = [
	// 类别 1:外壳级 —— 顶栏账号切换器 + 工作台 + 通知选人(且 SQL 已被数据权限按 `sys_user` 过滤)
	"user.list",
	// 类别 1:外壳级 —— 侧边栏与 `useHasPerm` 的数据源(它自己就是权限结果,"要权限才能读权限"是死锁)
	"menu.mine",
	// 类别 1:外壳级 —— 顶栏铃铛在每个页面都有;SQL 按 `user_id` 自限(见 doc/通知中心.md)
	"notice.list",
	// 类别 1:外壳级 —— 侧栏模式 / 树展开 / 页大小 / 列偏好,每个页面都在用
	"para.byKey",
	// 类别 1:外壳级 —— `useDict` 的取值器(工作台也在用),不是某个页面的数据
	"dict.byCode",
	// 类别 1:工作台打标签那一格(工作台不挂菜单授权) —— 标签页自己的 `tag.list` 也没有登记,
	// 因为同一个 `tag.list` 被工作台共用;标签页的可见性由路由守卫保证
	"tag.list",
	"tag.objectIdsOfTag",
	"tag.tagIdsOfObject",
	"tag.objectsOfTag",
	"tag.tagsOfObject",
	// 类别 3:目前没有调用方(留给"用户详情里的角色指派"),等有了调用方再按页面登记
	"user.roles",
];
