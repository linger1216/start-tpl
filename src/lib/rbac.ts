/**
 * **权限并集的计算** —— 角色 → 菜单/按钮。
 *
 * 模型(策略表见 `db/data-base-schema.ts` 的 `sys_casbin_rule`,引擎见 `lib/casbin.ts`):
 *
 *   用户 --(sys_casbin_rule 的 `g` 行,一人多角色)--> 角色 --(sys_casbin_rule 的 `p` 行)--> 菜单 / 按钮
 *
 * 所以「这个用户能看到什么」= **他所有角色的授权取并集** —— 角色与部门无关(部门只是组织架构),
 * 没有"当前部门"这个概念,也不需要切换。
 *
 * 为什么把算法放在这里、而不是写在 procedure 里:这一层**只吃 `userId`**,
 * 与"怎么拿到 userId(会话)"解耦 —— 单测可以直接喂一个 id,不必造 HTTP 会话。
 *
 * ⚠️ 这里是**全站唯一的权限计算处**(服务端只有 `menu.mine`、`(main)` 的路由守卫与 tRPC 权限中间件调它,
 * 客户端只有 `hooks/use-perms.ts` 读结果)。通配符(`*:*:*`)的展开在 `lib/casbin.ts` 的**装载时**
 * 算完(不是在这里每次现算) —— 展开之后,`use-perms.ts` 和各页面**一行都不用改**。
 *
 * 判决策本身在 `lib/casbin.ts`(`enforce`):本文件只负责把 Casbin 的结论**翻译成菜单树 + 权限码集合**。
 */
import { asc } from "drizzle-orm";

import { db } from "#/db";
import { sysMenu } from "#/db/data-base-schema";
import { implicitObjsOf, isPermissionConfigured, MENU_PREFIX } from "#/lib/casbin";
import { MENU_TYPE } from "#/lib/menu-spec";
import { PERM_FORMAT, pagePermOf, permMatches } from "#/lib/perm-code";
import { alive } from "#/lib/soft-delete";

/**
 * 权限码的**形状与比较**住在 `lib/perm-code.ts` —— 功能权限的引擎(`lib/casbin.ts`)与本文件
 * 都要用它,而两者互相依赖,语法抽到最底层就没有环。这里**原样再导出**,老调用方一行都不用改
 * (`routers/menu.ts` / `trpc/init.ts` / `tests/*` 都从本文件 import)。
 */
export { PERM_FORMAT, pagePermOf, permMatches };

/**
 * `sys_menu` 的一行(**整行**,服务端用)。
 *
 * 别与 `layout/nav-menu.ts` 导出的 `MenuRow` 混:那是喂给侧边栏的**投影**
 * (`{id,name,path,icon,type,parentId}` 那一小把),不是整行。
 */
type SysMenuRow = typeof sysMenu.$inferSelect;

/**
 * **只要求登录、不需要菜单授权**的页面路径。
 *
 * - `/` 工作台 = 登录后的落地页,把它拦掉等于"没勾菜单的人登录即 403";
 * - `/notices` 通知中心 = 刻意不发菜单授权(`scripts/seed-demo.ts` 的演示账号没有它),
 *   但顶栏铃铛在每个页面都指过来 —— 拦它等于把铃铛点坏了。
 *
 * 除此之外,**不在**菜单表里的路径也一律放行:菜单表管的是菜单驱动的页面 ——
 * 派生项目里新加的页面在灌进 `sys_menu` 之前,不会因为"查不到菜单"而被拦掉。
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
	rows: SysMenuRow[] | null;
	/** 权限标识集合(`perm`);`null` = 权限体系未启用 → 一律放行 */
	perms: string[] | null;
};

/**
 * 菜单访问的**完整**计算结果 —— 比 `EffectiveMenus` 多一张"全站菜单驱动的页面"表。
 *
 * 路由守卫要区分三种路径:① 菜单驱动的页面 → 按菜单授权判;② 登录落地页/通知中心 → 放行;
 * ③ 压根不在菜单表里的页面(如 `/settings/profile`)→ 放行。这张表 + `ALWAYS_VIEWABLE_PATHS` 就是全部判据。
 */
type MenuAccess = EffectiveMenus & {
	/** 菜单驱动的页面:**路径 → 菜单名**(菜单名给 403 页显示"「X」没有授权") */
	pages: ReadonlyMap<string, string>;
};

/**
 * 补全祖先链 —— 授权只勾了子节点时,把它的父/祖父也一并算上。
 *
 * 为什么必须有:侧边栏是**按 parentId 拼树**的,只授权一个深层的子菜单、
 * 父节点没授权 → 那一枝在树上根本无处安放,结果是"勾了却看不见"。
 * 写入时(`role.setMenus`)与装载时(`lib/casbin.ts` 的 `loadPolicy`)都用同一份口径,
 * 避免两处漂移 —— 这里这份是给**写入**用的。
 */
export async function withAncestorIds(ids: readonly string[]): Promise<string[]> {
	if (ids.length === 0) return [];
	const rows = await db.select({ id: sysMenu.id, parentId: sysMenu.parent_id }).from(sysMenu).where(alive(sysMenu));
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
	// 不在菜单表里的页面:菜单驱动不到它,只要求登录
	if (!pages.has(pathname)) return { allowed: true, pageName };
	return { allowed: perms.includes(pagePermOf(pathname)), pageName };
}

/** `effectiveMenusFor` / `canViewPath` 的共同实现(一次查询同时满足两种问法,别各查一遍) */
async function computeMenuAccess(userId: string | null): Promise<MenuAccess> {
	const all = await db.select().from(sysMenu).where(alive(sysMenu)).orderBy(asc(sysMenu.sort), asc(sysMenu.name));
	const navigable = (rows: readonly SysMenuRow[]) => rows.filter((row) => Number(row.type) !== MENU_TYPE.BUTTON);
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

	/**
	 * 判决策在 `lib/casbin.ts`(`implicitObjsOf`):它把"这个用户直接或经角色间接拿到的
	 * 全部 obj"算完并**展开**好了 —— 每组授权三条 obj(`menu:<id>`、该菜单的 `perm`、
	 * 页面路径折算的 `page:*:view`),通配模式也在**装载时**摊平成具体码。
	 *
	 * 所以这里只做翻译:留下 `menu:` 前缀的拿去选菜单,**其余的直接当权限码**
	 * (不能再出现通配模式 —— `hooks/use-perms.ts` 是 `perms.includes(code)` 的精确匹配,
	 * 留下模式会让所有按钮都判不过)。
	 */
	const objs = await implicitObjsOf(userId);
	const allowed = new Set(
		objs.filter((obj) => obj.startsWith(MENU_PREFIX)).map((obj) => obj.slice(MENU_PREFIX.length)),
	);
	if (allowed.size === 0) return { rows: null, perms: [], pages };

	const rows = navigable(all).filter((row) => allowed.has(row.id));
	/**
	 * 权限集合 = ① Casbin 判定里那些非 `menu:` 的 obj(按钮码 + 页面合成码)+
	 * ② **可见页面**再折算一遍 `page:*:view`。
	 *
	 * ② 是页面级判据:读接口的 `PERM_BY_PATH` 就登记这些码(一个读接口被多个页面用时取"或"),
	 * 于是"菜单勾上 = 页面进得去 = 它的读接口调得动",三处口径永远一致。
	 */
	const pageCodes = rows.flatMap((row) => (row.path?.startsWith("/") ? [pagePermOf(row.path)] : []));
	const perms = [...new Set([...objs.filter((obj) => !obj.startsWith(MENU_PREFIX)), ...pageCodes])];
	// 可见菜单为空 → 返回 null(区别于"菜单表为空"),展示层据此决定"什么都不显示"
	return { rows: rows.length > 0 ? rows : null, perms, pages };
}

/**
 * **tRPC 路径 → 权限码**的映射(服务端强制的唯一真源)。
 *
 * 设计取舍:与其在 65 个 procedure 上各写一次 `permProcedure("…")`(漏写一个就**静默放开**),
 * 不如把映射收在这一张表里、由中间件按 `path` **结构性**查 —— 与"日志天然全覆盖"同一个思路。
 *
 * **值可以是数组**(命中任一即放行):读接口常被多个页面共用(如 `role.list` 在角色/用户/部门
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
	// 导入 = 批量新增,复用「新增」权限点(不造新码:登记新码还得先在 sys_menu 建按钮,见本文件头)
	"dict.import": "sys:dict:add",
	// 参数
	"para.create": "sys:para:add",
	"para.update": "sys:para:edit",
	"para.delete": "sys:para:remove",
	"para.import": "sys:para:add",
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
	// 导入 = 批量新增,复用「新增」权限点(不造新码:登记新码还得先在 sys_menu 建按钮,见本文件头)
	"role.import": "sys:role:add",
	"role.addUser": "sys:role:user",
	"role.removeUser": "sys:role:user",
	"role.setMenus": "sys:role:perm",
	// 用户
	"user.create": "sys:user:add",
	"user.update": "sys:user:edit",
	"user.remove": "sys:user:remove",
	// 导入 = 批量新增,复用「新增」权限点(不造新码:登记新码还得先在 sys_menu 建按钮,见本文件头)
	"user.import": "sys:user:add",
	/**
	 * ===== 读接口 =====
	 *
	 * 页面级判据:`pagePermOf(路径)` 合成的页面码 = "这个页面的菜单勾上了"。
	 * 数组 = 这些页面里**任意一个**可见就放行(读接口被多页共用;写死一个会把别的页面打死)。
	 * 只拦"页面数据",不拦跨页面的外壳读接口(见 `UNMAPPED_QUERIES` 的理由)。
	 */
	// 角色(角色页 / 用户的角色指派 / 部门的人员角色 / 数据范围规则选主体)
	"role.list": [
		pagePermOf("/settings/roles"),
		pagePermOf("/settings/users"),
		pagePermOf("/settings/departments"),
		pagePermOf("/settings/data-scope"),
	],
	"role.users": pagePermOf("/settings/roles"),
	"role.menuIds": pagePermOf("/settings/roles"),
	// 部门(部门页 / 用户页的部门树 / 网格履职的组织筛选 / 数据范围规则选主体)
	"department.tree": [
		pagePermOf("/settings/departments"),
		pagePermOf("/settings/users"),
		pagePermOf("/demo/grid"),
		pagePermOf("/settings/data-scope"),
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
	// 站内通知(读自己的不需要权限点;替别人发才需要)
	"notice.create": "sys:notice:add",
	// Demo 网格履职
	"demoGrid.list": pagePermOf("/demo/grid"),
	"demoGrid.create": "sys:grid:add",
	"demoGrid.update": "sys:grid:edit",
	"demoGrid.remove": "sys:grid:remove",
	"demoGrid.assign": "sys:grid:assign",
	// 数据权限 ▸ 数据范围(整个页面是"管权限的人"的活,所以按页面 + 三个写权限点)
	"dataScope.list": pagePermOf("/settings/data-scope"),
	"dataScope.resources": pagePermOf("/settings/data-scope"),
	"dataScope.plugins": pagePermOf("/settings/data-scope"),
	"dataScope.trial": pagePermOf("/settings/data-scope"),
	"dataScope.create": "sys:scope:add",
	"dataScope.update": "sys:scope:edit",
	"dataScope.remove": "sys:scope:remove",
	// 数据权限 ▸ 值域插件(`test` 是把插件真跑一遍,和写接口一样只该超管碰 —— 见 routers/data-plugin.ts)
	"dataPlugin.list": pagePermOf("/settings/data-plugins"),
	"dataPlugin.test": "sys:plugin:test",
	"dataPlugin.create": "sys:plugin:add",
	"dataPlugin.update": "sys:plugin:edit",
	"dataPlugin.remove": "sys:plugin:remove",
};

/**
 * **数据权限:哪个读接口对应哪张"资源表"**(行级可见性 —— 与 `PERM_BY_PATH` 同一个思路)。
 *
 * 分两层管,别混:
 *  · `PERM_BY_PATH` 管**功能** —— 能不能调这个接口(菜单勾没勾);
 *  · 这张表管**行** —— 同一个接口,不同的人看到不同的行。
 *
 * 中间件(`init.ts` 的 `dataScopeMiddleware`)按 `path` 查到资源,再给 resolver 挂
 * `ctx.scope(resource?)`。resolver 只需把返回值塞进 `where`:
 *
 *     const scope = await ctx.scope();                    // 默认取本 path 登记的资源
 *     const rows = await db.select().from(sysDemoGrid).where(and(eq(…), scope));
 *
 * `and()` 会丢掉 `undefined` 参数(实测 `drizzle-orm/sql/expressions/conditions.js` 的
 * `and()` 第一件事就是 `filter((c) => c !== undefined)`)⇒ **"没有规则 = 不筛选"天然成立**,
 * 不必写 `if (scope)` 那种一旦写反就静默放行的形状。
 *
 * ⚠️ **`ctx.scope()` 的返回值必须进 `where`** —— 它返回 `undefined` 的含义是"不筛选",不是"没数据";
 * 忘了塞,这条接口就没有行级过滤。`tests/auth.test.ts` 的分类守卫只能保证"这条接口被显式分类过"
 * (落在本表 = 要做行级过滤,落在 `UNSCOPED_QUERIES` = 明确声明不做),管不到 resolver 内部 ——
 * 所以规矩是:**读了业务表就调一次 `ctx.scope()`,别绕过**。
 */
export const DATA_SCOPE_BY_PATH: Record<string, { resource: string }> = {
	// Demo 网格履职 —— v1 的第一个(也是当前唯一一个)行级资源,拿来当样板
	"demoGrid.list": { resource: "demo_grid" },
};

/**
 * **不做行级过滤**的读接口 —— 与 `DATA_SCOPE_BY_PATH` 二选一,同样由 `tests/auth.test.ts` 的
 * 分类守卫强制(每个 query 必须落在这两张表之一)。
 *
 * 为什么不跟 `UNMAPPED_QUERIES` 合成一张:那张表管的是**权限**(要不要权限点),这张管的是**行**
 * (要不要按部门 / 本人筛)—— 两个维度会分岔:`role.list` 要权限点(在 `PERM_BY_PATH` 里)但不筛行;
 * 反过来 `demoGrid.list` 两个都要。合成一张就表达不了"要权限、但不筛行"这一类。
 *
 * 加进来必须写清属于下面哪一类:
 *
 * 1. **外壳级** —— 每个页面都在用,筛它会让整站打不开;
 * 2. **全局定义 / 配置类** —— 角色、菜单、字典、参数这种"全系统一份"的数据,没有"这一行归哪个部门"这一说;
 * 3. **天生自限范围** —— SQL 只按入参读、或只读"自己那一份";
 * 4. **v1 还没做** —— 这些**应该**有行级口径(按部门看人 / 看日志 / 看文件),但 v1 只落了 `demo_grid`
 *    一个样板。它们是数据权限后续的落地清单,不是"永远不做"。
 */
export const UNSCOPED_QUERIES: readonly string[] = [
	// 类别 1:外壳级
	"user.list",
	"menu.mine",
	"department.tree",
	"department.members",
	"notice.list",
	"tag.list",
	// 类别 2:全局定义 / 配置类
	"menu.list",
	"role.list",
	"dict.list",
	"dict.byCode",
	"para.list",
	"para.byKey",
	// 类别 2:数据权限自己的配置 —— 规则 / 插件 / 资源元数据是"全系统一份",不存在"这一行归谁看"
	"dataScope.list",
	"dataScope.resources",
	"dataScope.plugins",
	// 类别 2 —— 试用页的只读诊断:它算的就是"**指定的人**看得到哪些行",本身不该再被同一套规则筛一遍
	"dataScope.trial",
	"dataPlugin.list",
	"dataPlugin.test",
	// 类别 3:天生自限范围(按入参读 / 只读自己那一份)
	"role.users",
	"role.menuIds",
	"user.roles",
	"user.profile",
	"file.url",
	"tag.objectIdsOfTag",
	"tag.tagIdsOfObject",
	"tag.objectsOfTag",
	"tag.tagsOfObject",
	// 类别 4:v1 还没做 —— 后续要按部门 / 本人筛
	"file.list",
	"log.list",
];

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
	// 类别 1:外壳级 —— 顶栏账号切换器 + 工作台 + 通知选人
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
	// 类别 2:天生自限范围 —— 个人资料页(`/settings/profile`)。SQL 只按 `ctx.user.id` 读自己那一行;
	// 页面本身刻意**不挂菜单授权**(不然"没勾设置菜单的人连自己资料都看不到"),
	// 入口在顶栏用户菜单里,与 `/demo/*` 那类"不在菜单表里的页面"同一个口径(见 `canViewPath`)。
	"user.profile",
];
