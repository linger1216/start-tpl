/**
 * 功能权限的**引擎** —— Casbin 判决策 + 策略表 `sys_casbin_rule` 的唯一读写入口。只在服务端跑。
 *
 * 分工:
 *  - `lib/perm-code.ts` 管权限码的**形状与比较**(纯逻辑);
 *  - 本文件管「谁有哪些角色」「角色能进哪些菜单」的**存取**与**判定**,并判「权限体系是否启用」;
 *  - `lib/rbac.ts` 管「这个用户能看到哪些菜单」的**并集计算** —— 它调本文件,不自己查策略表。
 *
 * 四条纪律(改这里之前先读):
 * 1. **判决策只有 Casbin**:`enforce()` 说不放行就是不放行,不许在旁边另写一套 `if`;
 * 2. **表里只存一种写法**:策略行永远是 `p, role:<角色 id>, menu:<菜单 id>, access` 与
 *    `g, user:<用户 id>, role:<角色 id>` / `g, role:<A>, role:<B>`。
 *    权限码与页面码是**装载时展开**出来的(见 `loadPolicy`),不落库 ——
 *    于是改菜单的 `perm` 不用回刷任何策略行;
 *    (角色在策略表里**只用 `id`** —— `sys_role` 没有 `code` 列,程序内部一律以 id 引用。)
 * 3. **写路径不经过 enforcer**:`enableAutoSave` 要求"内存里的规则形状 == 库里的形状",
 *    而本项目故意让装载**展开**、存储**不展开**(规矩 2),两者不是一种形状 ——
 *    用 enforcer 的 `addPolicy` / `removeFilteredPolicy` 会写进展开后的形状、删也删不掉。
 *    所以:写一律**直写库 + 清缓存**,enforcer 只负责判定;
 * 4. **失败关闭**:认不出人就什么都不给;唯一的例外是策略表**一条 `p` 行都没有** ——
 *    那时整套功能权限视为**未启用**,一律放行。
 */
import { type Adapter, Enforcer, type Model, newModelFromString } from "casbin";
import { and, eq, inArray, like, sql } from "drizzle-orm";

import { db } from "#/db";
import { sysCasbinRule, sysMenu, sysRole } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { logger } from "#/lib/logger";
// `ADMIN_ROLE_NAME` 真源在 `lib/menu-spec.ts`(客户端也要用,见该模块的注释);
// 本文件是 server-only,不能被 client 直接 import,故 re-import 这条字面量字符串而不是另起一份。
import { ADMIN_ROLE_NAME } from "#/lib/menu-spec";
import { isPermPattern, pagePermOf, permMatches } from "#/lib/perm-code";
import { alive } from "#/lib/soft-delete";
import { collectAncestorIds } from "#/lib/tree";

/**
 * Casbin 模型。
 *
 *  `p` 三段是主体 / 客体 / 动作;主体三种写法:具体主体、`role:<父角色>`(继承)、`*`(通配)。
 *
 * 为什么 `p` 里**没有 `eft`**:功能权限是纯并集(谁来授权就是并集语义),没有黑名单需求。
 * 而 `some(allow) && !some(deny)` 那种"一票否决"在本仓库已经被数据权限付过一次代价
 * (一条行级 deny 会否掉整类 allow,必须再配 `wholeTypeDeny` 兜) —— 没有需求就不付这个代价。
 *
 * 为什么 `r` 里**没有 `dom`**(多租户的域):本项目单租户,`dom` 只会让每条策略多一个恒等段。
 */
const MODEL = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = (r.sub == p.sub || g(r.sub, p.sub) || p.sub == "*") && codeMatch(p.obj, r.obj) && (r.act == p.act || p.act == "*")
`;

/** matcher 里那个自定义函数的注册名 */
const CODE_MATCH_FN = "codeMatch";

/** `sys_casbin_rule` 的两种行 */
const POLICY_TYPE = "p";
const GROUP_TYPE = "g";
/** 主体 / 客体串的前缀:主体 `user:` / `role:`,客体 `menu:`(`rbac.ts` 靠 `MENU_PREFIX` 拆客体) */
const USER_PREFIX = "user:";
const ROLE_PREFIX = "role:";
export const MENU_PREFIX = "menu:";

/** 唯一能跨 admin 改 admin / 删除 admin 的角色 —— re-export 给 server 调用方,
 * `scripts/seed-rbac.ts` / `routers/user.ts` / `routers/role.ts` 都从这里 import。
 * 真源是 `lib/menu-spec.ts`(客户端也要用);本文件不再 export 一份。*/
export { ADMIN_ROLE_NAME };

/**
 * 客体(obj)怎么比 —— matcher 调的就是它。**纯函数,不查库**。
 *
 * 为什么不直接用 Casbin 内置的 `keyMatch2`:内置那几套是给 **URL 路径**设计的
 * (`/api/users/:id`)。本项目是 tRPC,连"HTTP 方法"这一维都不存在(全是 `POST /api/trpc/<path>`),
 * 客体是**权限码**(`sys:user:add`)。通配语义就用权限码自己的段级 `*`(`permMatches`),没有第二套规则。
 */
function codeMatch(pattern: string, code: string): boolean {
	if (pattern === code) return true;
	if (pattern === "*") return true;
	// 不含通配就必须严格相等;含通配才逐段比 —— 段数不同一律不匹配,所以 `sys:role`(两段)不会误放行
	return isPermPattern(pattern) ? permMatches(pattern, code) : false;
}

/**
 * **只读适配器**:`loadPolicy` 读 `sys_casbin_rule` 并按纪律 2 展开,四个写方法一律抛错。
 *
 * 写方法为什么抛错而不是空实现:Casbin 自己从不调它们(纪律 3,我们不接自动持久化),
 * 但哪天有人调了,抛错立刻炸出来;空实现只会让"以为写进去了"的改动静默失效。
 */
class CasbinRuleAdapter implements Adapter {
	/** 装进来的 `p` 行数 —— 「我明明配了却看不到」的第一个排查点 */
	loaded = 0;

	async loadPolicy(model: Model): Promise<void> {
		const [rules, menus, roles] = await Promise.all([
			db
				.select({
					ptype: sysCasbinRule.ptype,
					v0: sysCasbinRule.v0,
					v1: sysCasbinRule.v1,
					v2: sysCasbinRule.v2,
				})
				.from(sysCasbinRule),
			db
				.select({ id: sysMenu.id, parentId: sysMenu.parent_id, perm: sysMenu.perm, path: sysMenu.path })
				.from(sysMenu)
				.where(alive(sysMenu)),
			db.select({ id: sysRole.id, status: sysRole.status }).from(sysRole).where(alive(sysRole)),
		]);
		const menuById = new Map(menus.map((row) => [row.id, row]));

		/**
		 * **停用的角色一律不算**:凡是把 `role:<id>` 当主体 / 客体的 `g` 行与 `p` 行,只有 `sys_role.status = 1` 时才装载。
		 *
		 * 为什么必须在装载时挡:策略表是一张纯字符串图,它不知道 `sys_role` 有 `status` 这一列 ——
		 * 不在这里过一道,一个**停用**的角色照样把权限发给它的成员(旧实现里这层过滤长在 SQL 的 join 上,
		 * 见 `tests/role.test.ts` 的「停用的角色不贡献权限」)。顺带把"`sys_role` 里已经没有这个 id"的
		 * 悬挂行也挡掉 —— 等价于旧方案里外键 cascade 的效果。
		 */
		const liveRoles = new Set(roles.filter((row) => row.status === 1).map((row) => row.id));
		const roleDisabled = (subject: string): boolean =>
			subject.startsWith(ROLE_PREFIX) && !liveRoles.has(subject.slice(ROLE_PREFIX.length));

		// `g` 行:用户 → 角色、角色 → 角色(继承)。客体那一侧是角色,角色停用就整条不装
		for (const row of rules) {
			if (row.ptype !== GROUP_TYPE) continue;
			if (roleDisabled(row.v1)) continue;
			model.addPolicy(GROUP_TYPE, GROUP_TYPE, [row.v0, row.v1]);
		}

		// `p` 行按**主体**归组:`p, role:X, menu:a` 与 `p, role:X, menu:b` 是同一个主体的两条勾选
		const grants = new Map<string, { act: string; ids: Set<string> }>();
		const orphans = new Set<string>();
		for (const row of rules) {
			if (row.ptype !== POLICY_TYPE) continue;
			this.loaded += 1;
			if (roleDisabled(row.v0)) continue;
			if (!row.v1.startsWith(MENU_PREFIX)) continue; // 表里不该有别的写法;有也不装载(失败关闭)
			const menuId = row.v1.slice(MENU_PREFIX.length);
			if (!menuById.has(menuId)) {
				// 菜单已被删、策略行还没清 —— 当"没授权"(等价于旧方案里外键 cascade 的效果)
				orphans.add(menuId);
				continue;
			}
			const bucket = grants.get(row.v0) ?? { act: row.v2, ids: new Set<string>() };
			bucket.act = row.v2;
			bucket.ids.add(menuId);
			grants.set(row.v0, bucket);
		}

		for (const [sub, bucket] of grants) {
			/**
			 * 祖先补全:只勾了深层子菜单时,父 / 祖父一并算上。
			 *
			 * 为什么必须有:侧边栏是**按 parentId 拼树**的,父节点没授权 → 那一枝在树上无处安放,
			 * 结果是"勾了却看不见"。写入时(`role.setMenus` 调 `withAncestorIds`)已经补过一次,
			 * 这里再补一次是为了兜住手写 / 迁移来的行 —— 两处同口径,不是两套规则。
			 */
			const ids = new Set([...bucket.ids, ...collectAncestorIds(menus, bucket.ids)]);

			/**
			 * **通配模式在这里展开**(`*:*:*` / `sys:*:*` / `sys:role:*`)。
			 *
			 * 做法:把"被模式命中的菜单行"当成**被授权**的行,再走同一套祖先补全 ——
			 * 于是一个模式的效果和"手勾上这些行"完全一样,没有第二套可见性规则。
			 * 因为是**装载时**算,`*:*:*` 自动覆盖**以后新增的菜单 / 按钮**(不用回来补勾)——
			 * 这正是"不用一个一个赋权限"的价值所在。
			 */
			const patterns = [
				...new Set(
					[...bucket.ids]
						.map((id) => menuById.get(id)?.perm)
						.filter((perm): perm is string => !!perm && isPermPattern(perm)),
				),
			];
			if (patterns.length > 0) {
				for (const menu of menus) {
					if (menu.perm && patterns.some((pattern) => permMatches(pattern, menu.perm as string))) ids.add(menu.id);
				}
			}

			for (const id of ids) {
				const menu = menuById.get(id);
				if (!menu) continue;
				// ①菜单 id 本身:回读勾选态、决定侧边栏哪一枝可见
				model.addPolicy(POLICY_TYPE, POLICY_TYPE, [sub, `${MENU_PREFIX}${id}`, bucket.act]);
				// ②该行的 `perm`:可能是具体码,也可能是通配模式(交给 matcher 的 codeMatch)
				if (menu.perm) model.addPolicy(POLICY_TYPE, POLICY_TYPE, [sub, menu.perm, bucket.act]);
				// ③页面合成码:供 `PERM_BY_PATH` 里那些读接口的页面级判据
				if (menu.path?.startsWith("/"))
					model.addPolicy(POLICY_TYPE, POLICY_TYPE, [sub, pagePermOf(menu.path), bucket.act]);
			}
		}

		if (orphans.size > 0) {
			logger.warn("casbin.menu_missing", { count: orphans.size, menuIds: [...orphans] });
		}
		logger.debug("casbin.load", { pRows: this.loaded, subjects: grants.size });
	}

	async savePolicy(): Promise<boolean> {
		throw new Error(READONLY_ERROR);
	}

	async addPolicy(): Promise<void> {
		throw new Error(READONLY_ERROR);
	}

	async removePolicy(): Promise<void> {
		throw new Error(READONLY_ERROR);
	}

	async removeFilteredPolicy(): Promise<void> {
		throw new Error(READONLY_ERROR);
	}
}

const READONLY_ERROR =
	"sys_casbin_rule 只能通过 lib/casbin.ts 的领域函数写:装载是展开的、存储是不展开的,两者不是一种形状";

/** 策略很少动,缓存 30 秒(与 `lib/sys-para.ts` 同一手法) */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; enforcer: Enforcer } | null = null;

async function engineOf(force = false): Promise<Enforcer> {
	if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.enforcer;
	const enforcer = new Enforcer();
	// 传了 adapter 且非 lazy ⇒ `initWithModelAndAdapter` 内部就会 `loadPolicy()`,不用自己再调
	await enforcer.initWithModelAndAdapter(newModelFromString(MODEL), new CasbinRuleAdapter());
	await enforcer.addFunction(CODE_MATCH_FN, (pattern: string, code: string) => codeMatch(pattern, code));
	cache = { at: Date.now(), enforcer };
	return enforcer;
}

/**
 * 策略写完立刻生效,不必干等 30 秒 —— **每个写函数末尾都会调它**,不用调用方记。
 *
 * ⚠️ **菜单增 / 删 / 改 / 排序后也必须调**(`routers/menu.ts` 的每个写接口):
 * 展开结果跟着 `sys_menu` 变,而 `sys_casbin_rule` 一行没动,不刷缓存就会拿旧快照判定。
 */
export function clearCasbinCache(): void {
	cache = null;
}

/** 问一句 Casbin:这个主体能不能对 `obj` 做 `act` */
export async function enforce(sub: string, obj: string, act = "access"): Promise<boolean> {
	const enforcer = await engineOf();
	return enforcer.enforce(sub, obj, act);
}

/**
 * 一个用户对**一组码**的判定:命中**任一**即放行。
 *
 * `PERM_BY_PATH` 的值可以是数组(读接口常被多个页面共用),"或"的语义收在这里,
 * 免得每个调用方各写一遍 `Promise.all(...).some(...)`。
 */
export async function enforceAny(userId: string, codes: readonly string[]): Promise<boolean> {
	const enforcer = await engineOf();
	const sub = `${USER_PREFIX}${userId}`;
	const hits = await Promise.all(codes.map((code) => enforcer.enforce(sub, code, "access")));
	return hits.some(Boolean);
}

/**
 * 这个用户**实际拥有**的客体集合 —— 角色继承由 Casbin 自己算
 * (`g, role:A, role:B` 时 A 的成员自动拿到 B 的授权),这里不手写第二套角色展开。
 *
 * 返回的是**装载时展开过**的客体(含 `menu:<id>`、具体权限码、页面码)。
 */
export async function implicitObjsOf(userId: string): Promise<string[]> {
	const enforcer = await engineOf();
	const sub = `${USER_PREFIX}${userId}`;
	const roles = await enforcer.getImplicitRolesForUser(sub);
	const subjects = new Set([sub, ...roles, "*"]);
	const out = new Set<string>();
	for (const rule of await enforcer.getPolicy()) {
		const [pSub, pObj] = rule;
		if (pSub && pObj && subjects.has(pSub)) out.add(pObj);
	}
	return [...out];
}

/**
 * 策略表里**一条 `p` 行都没有** = 功能权限未启用。
 *
 * 为什么要有这个开关:模板 / 新项目刚建好时没有任何授权记录,如果没有这个兜底,
 * 每个人(包括管理员自己)登录后都会看到空侧边栏 —— 把自己锁在外面。一旦配了第一条授权,过滤立即生效。
 *
 * 为什么直接查库、不吃 enforcer 的缓存:这是"库里到底有没有配过"的事实,不该跟着 30 秒 TTL 漂。
 */
export async function isPermissionConfigured(): Promise<boolean> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(sysCasbinRule)
		.where(eq(sysCasbinRule.ptype, POLICY_TYPE));
	return Number(row?.n ?? 0) > 0;
}

// ── 读:角色的勾选、用户与角色的对应关系 ────────────────────────────

/** 这个角色勾了哪些菜单 / 按钮(裸 id,已去掉 `menu:` 前缀) */
export async function grantedMenuIdsOf(roleId: string): Promise<string[]> {
	const rows = await db
		.select({ v1: sysCasbinRule.v1 })
		.from(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, POLICY_TYPE), eq(sysCasbinRule.v0, `${ROLE_PREFIX}${roleId}`)));
	return rows
		.map((row) => row.v1)
		.filter((v1) => v1.startsWith(MENU_PREFIX))
		.map((v1) => v1.slice(MENU_PREFIX.length));
}

/** 这个人直接挂着哪些角色(裸 id)。**不含**角色继承 —— 继承由 Casbin 判定时算 */
export async function roleIdsOf(userId: string): Promise<string[]> {
	const rows = await db
		.select({ v1: sysCasbinRule.v1 })
		.from(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), eq(sysCasbinRule.v0, `${USER_PREFIX}${userId}`)));
	return rows
		.map((row) => row.v1)
		.filter((v1) => v1.startsWith(ROLE_PREFIX))
		.map((v1) => v1.slice(ROLE_PREFIX.length));
}

/**
 * 用户是否持有「系统管理员」角色。**只查直接挂的角色**,不展开继承(继承是 Casbin 的事,
 * 这里只问「他本人是不是 admin」)。一次查 g 行 + sys_role.name join,不 N+1。
 *
 * 业务用途:`user.update` / `user.remove` 的「admin 守卫」—— 改 admin / 删 admin
 * 都要 admin 自己来。
 *
 * **第二个参数 `isSuper` 是测试 ctx 旁路**:`getCurrentUser()` 只返 `{ id, name }`,生产里
 * 拿不到 `isSuper`(库里没列;BA 不写;HTTP 路径上的 `ctx.user` 也不带这字段)。`isSuper=true`
 * 只在 `callerAs({ ..., isSuper: true })` 这条测试通道上有值 —— 让 admin 守卫能在 caller-level
 * 测试里稳定跑通,与生产语义不冲突。**真正的生产旁路是第一个参数**:
 * `permMiddleware` / `dataScopeMiddleware` 现在都直接 `await isAdminUser(user.id)` 查角色,
 * 不再靠 ctx.isSuper(它对 HTTP 路径是死码)。
 */
export async function isAdminUser(userId: string, isSuper = false): Promise<boolean> {
	if (isSuper) return true;
	const ids = await roleIdsOf(userId);
	if (ids.length === 0) return false;
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(sysRole)
		.where(and(inArray(sysRole.id, ids), eq(sysRole.name, ADMIN_ROLE_NAME), alive(sysRole)));
	return Number(row?.n ?? 0) > 0;
}

/** 这个角色底下有哪些人(裸 user id) */
export async function userIdsOfRole(roleId: string, tx?: Pick<typeof db, "select">): Promise<string[]> {
	const exec = tx ?? db;
	const rows = await exec
		.select({ v0: sysCasbinRule.v0 })
		.from(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), eq(sysCasbinRule.v1, `${ROLE_PREFIX}${roleId}`)));
	return rows
		.map((row) => row.v0)
		.filter((v0) => v0.startsWith(USER_PREFIX))
		.map((v0) => v0.slice(USER_PREFIX.length));
}

/**
 * **全部**「人 → 角色 id」的直接成员关系(**不含**角色继承)。
 *
 * 用户台账要一次显示所有人的角色 —— 有了这个就不必按人逐个查(那是 N+1)。
 * 返回值刻意是**裸 id** 而不是角色名:调用方自己去 `sys_role` 换名字,本文件不替它做 join。
 */
export async function allUserRoles(): Promise<Array<{ userId: string; roleId: string }>> {
	const rows = await db
		.select({ v0: sysCasbinRule.v0, v1: sysCasbinRule.v1 })
		.from(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), like(sysCasbinRule.v0, `${USER_PREFIX}%`)));
	return rows
		.filter((row) => row.v1.startsWith(ROLE_PREFIX))
		.map((row) => ({
			userId: row.v0.slice(USER_PREFIX.length),
			roleId: row.v1.slice(ROLE_PREFIX.length),
		}));
}

/**
 * 所有角色的成员数 —— **一次 groupBy 拿全**(禁止按角色逐个 count,那是 N+1)。
 *
 * 只数 `user:` 开头的行:同一张表里还有 `role:` 开头的(角色继承),那不是"成员"。
 * 返回的 `Map`:键是 `sys_role.id`(策略表里 `role:<id>` 的那个 id),值是成员行数。
 */
export async function memberCountsOfRole(): Promise<Map<string, number>> {
	const rows = await db
		.select({ v1: sysCasbinRule.v1, n: sql<number>`count(*)` })
		.from(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), like(sysCasbinRule.v0, `${USER_PREFIX}%`)))
		.groupBy(sysCasbinRule.v1);
	const out = new Map<string, number>();
	for (const row of rows) {
		if (!row.v1.startsWith(ROLE_PREFIX)) continue;
		out.set(row.v1.slice(ROLE_PREFIX.length), Number(row.n));
	}
	return out;
}

// ── 写:一律「直写库 + 清缓存」(纪律 3)─────────────────────────────

/** 幂等插入一行 —— 不用 `on duplicate key update`(达梦不认),与 `routers/role.ts` 的既有做法同口径 */
async function insertIfAbsent(row: { ptype: string; v0: string; v1: string; v2?: string }): Promise<boolean> {
	const [existing] = await db
		.select({ id: sysCasbinRule.id })
		.from(sysCasbinRule)
		.where(
			and(
				eq(sysCasbinRule.ptype, row.ptype),
				eq(sysCasbinRule.v0, row.v0),
				eq(sysCasbinRule.v1, row.v1),
				eq(sysCasbinRule.v2, row.v2 ?? ""),
			),
		);
	if (existing) return false;
	const now = new Date();
	try {
		await db.insert(sysCasbinRule).values({
			id: newId(),
			ptype: row.ptype,
			v0: row.v0,
			v1: row.v1,
			v2: row.v2 ?? "",
			created_at: now,
			updated_at: now,
		});
		return true;
	} catch (error) {
		// 查-插两步之间被并发插入了同一行 —— `uk_sys_casbin_rule` 撞键。
		// 语义上"已存在"等价于幂等成功;再去查一次,真在 → false(没插,不报错),不在 → 真错误照抛。
		const [again] = await db
			.select({ id: sysCasbinRule.id })
			.from(sysCasbinRule)
			.where(
				and(
					eq(sysCasbinRule.ptype, row.ptype),
					eq(sysCasbinRule.v0, row.v0),
					eq(sysCasbinRule.v1, row.v1),
					eq(sysCasbinRule.v2, row.v2 ?? ""),
				),
			);
		if (!again) throw error;
		return false;
	}
}

/** 重设一个角色的菜单勾选(**全量替换**)。`menuIds` 应由调用方先过 `withAncestorIds` 补全祖先 */
export async function setRoleMenus(roleId: string, menuIds: readonly string[]): Promise<void> {
	const sub = `${ROLE_PREFIX}${roleId}`;
	const incomingIds = [...new Set(menuIds)];
	// **通配行** 单独保留 —— 这些是 perm 里含 `*` 的按钮(如 `*:*:*`、`sys:*:*`),
	// 装载时被 casbin 解释为「匹配所有 N 个权限点」,所以一条通配顶一千条普通授权。
	// 整批替换若不挑出来,角色身上"靠一条 `*:*:*` 就什么都能干"的那份**整批被砍**——
	// 「系统管理员」就是踩在这个坑里:UI 编辑菜单后 admin 一夜回到 0 授权。
	// 修法:**删 p 行前先盘点角色当前持有的通配行,把它们单独摘出来,删完重新插回去**。
	// 识别口径:看菜单的 `perm` 字段(这是**这个菜单本身**的权限模式,不是角色当前持有的)。
	// 哪怕 UI 上把这条菜单取消勾选、新的 menuIds 里没有它,也必须保住角色既有的通配授权。
	const wildcardMenuIds = new Set<string>(
		incomingIds.length === 0
			? []
			: (
					await db
						.select({ id: sysMenu.id })
						.from(sysMenu)
						.where(and(inArray(sysMenu.id, incomingIds), like(sysMenu.perm, "%*%")))
				).map((row) => row.id),
	);
	const nonWildcardIncoming = incomingIds.filter((id) => !wildcardMenuIds.has(id));
	await db.transaction(async (tx) => {
		// 把"角色当前持有哪些 p 行"先记下来,再用 perm 是否含 `*` 标出通配行
		const currentPRows = await tx
			.select({ v1: sysCasbinRule.v1 })
			.from(sysCasbinRule)
			.where(and(eq(sysCasbinRule.ptype, POLICY_TYPE), eq(sysCasbinRule.v0, sub)));
		// 持有菜单 id(MENU_PREFIX 去掉)
		const currentMenuIds = new Set(currentPRows.map((r) => r.v1.slice(MENU_PREFIX.length)));
		const currentWildcards = new Set<string>();
		if (currentMenuIds.size > 0) {
			const wildcardMenuRows = await tx
				.select({ id: sysMenu.id })
				.from(sysMenu)
				.where(and(inArray(sysMenu.id, [...currentMenuIds]), like(sysMenu.perm, "%*%")));
			for (const r of wildcardMenuRows) currentWildcards.add(r.id);
		}
		// 角色最终要持有的 p 行 = 新 menuIds + 当前仍在的通配菜单 id
		// (新 menuIds 里若已含同一条通配菜单,会被 Set 自然去重)
		const finalMenuIds = new Set<string>([...nonWildcardIncoming, ...wildcardMenuIds]);
		for (const id of currentWildcards) finalMenuIds.add(id);
		await tx.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, POLICY_TYPE), eq(sysCasbinRule.v0, sub)));
		if (finalMenuIds.size === 0) return;
		const now = new Date();
		await tx.insert(sysCasbinRule).values(
			[...finalMenuIds].map((menuId) => ({
				id: newId(),
				ptype: POLICY_TYPE,
				v0: sub,
				v1: `${MENU_PREFIX}${menuId}`,
				v2: "access",
				created_at: now,
				updated_at: now,
			})),
		);
	});
	clearCasbinCache();
}

/** 给一个角色**补**几条菜单授权(已存在的行不动)—— 与 `setRoleMenus` 的全量替换相对,迁移 / 批量补用 */
export async function addRoleMenus(roleId: string, menuIds: readonly string[]): Promise<number> {
	const sub = `${ROLE_PREFIX}${roleId}`;
	let added = 0;
	for (const menuId of [...new Set(menuIds)]) {
		if (await insertIfAbsent({ ptype: POLICY_TYPE, v0: sub, v1: `${MENU_PREFIX}${menuId}`, v2: "access" })) added += 1;
	}
	if (added > 0) clearCasbinCache();
	return added;
}

/** 给一个人加一个角色(已存在则什么都不做) */
export async function addUserRole(userId: string, roleId: string): Promise<void> {
	if (await insertIfAbsent({ ptype: GROUP_TYPE, v0: `${USER_PREFIX}${userId}`, v1: `${ROLE_PREFIX}${roleId}` })) {
		clearCasbinCache();
	}
}

/** 摘掉一个人的某个角色 */
export async function removeUserRole(userId: string, roleId: string): Promise<void> {
	await db
		.delete(sysCasbinRule)
		.where(
			and(
				eq(sysCasbinRule.ptype, GROUP_TYPE),
				eq(sysCasbinRule.v0, `${USER_PREFIX}${userId}`),
				eq(sysCasbinRule.v1, `${ROLE_PREFIX}${roleId}`),
			),
		);
	clearCasbinCache();
}

/**
 * 允许把写操作**并进调用方的事务**里 —— drizzle 的 `tx` 与 `db` 在 `select`/`insert`/`delete` 上同形。
 *
 * 为什么需要它:`user.update` 要把「账号列 + 部门归属 + 角色」放在**同一个事务**里
 * (要么都成、要么都不成)。若这里自己再开一个事务,两条连接会互相等锁 —— 所以由调用方把 `tx` 传进来。
 */
type Writer = Pick<typeof db, "delete" | "insert" | "select" | "update">;

/** 重设一个人的全部角色(**全量替换**)—— 「保存角色」那条路径用它 */
export async function setUserRoles(userId: string, roleIds: readonly string[], tx?: Writer): Promise<void> {
	const sub = `${USER_PREFIX}${userId}`;
	const targets = [...new Set(roleIds)].map((roleId) => `${ROLE_PREFIX}${roleId}`);
	const run = async (exec: Writer) => {
		await exec.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), eq(sysCasbinRule.v0, sub)));
		if (targets.length === 0) return;
		const now = new Date();
		await exec.insert(sysCasbinRule).values(
			targets.map((v1) => ({
				id: newId(),
				ptype: GROUP_TYPE,
				v0: sub,
				v1,
				v2: "",
				created_at: now,
				updated_at: now,
			})),
		);
	};
	if (tx) {
		await run(tx);
	} else {
		await db.transaction(run);
	}
	clearCasbinCache();
}

/** 清掉一个人的全部角色(删用户时用) */
export async function removeAllRolesOfUser(userId: string, tx?: Writer): Promise<void> {
	const sub = `${USER_PREFIX}${userId}`;
	// 已在事务里(用户删除包了 tx)就直接落在同一连接;单独调用时走默认连接
	const exec = tx ?? db;
	await exec.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), eq(sysCasbinRule.v0, sub)));
	// 注意:**不给事务内调用者做缓存清理** —— 事务提交后调用方自行 clearCasbinCache(),
	// 事务里清了也会被别的并发读回填(缓存与库的窗口性可接受,30s TTL 兜底)。
	if (!tx) clearCasbinCache();
}

/**
 * 角色被删时**把它的痕迹清干净**:自己的 `p` 行、以它为成员的人的 `g` 行、以及以它为父角色的继承行。
 *
 * ⚠️ 这件事本来靠外键 cascade;Casbin 的行不是关系行,没有外键可依 —— 必须显式清。
 *
 * user role
 * role menu
 */
export async function removeRoleEverywhere(roleId: string, tx?: Writer): Promise<void> {
	const sub = `${ROLE_PREFIX}${roleId}`;
	// caller 自带事务就落同一连接(整体回滚才有意义);单独调用保持自带小事务
	if (tx) {
		await tx.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, POLICY_TYPE), eq(sysCasbinRule.v0, sub)));
		await tx.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), eq(sysCasbinRule.v0, sub)));
		await tx.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), eq(sysCasbinRule.v1, sub)));
	} else {
		await db.transaction(async (inner) => {
			await inner.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, POLICY_TYPE), eq(sysCasbinRule.v0, sub)));
			await inner.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), eq(sysCasbinRule.v0, sub)));
			await inner.delete(sysCasbinRule).where(and(eq(sysCasbinRule.ptype, GROUP_TYPE), eq(sysCasbinRule.v1, sub)));
		});
		clearCasbinCache();
	}
}

/**
 * `sys_role` 没有 `code` 列、改名不影响 id,故无策略行需要搬 —— 旧 `renameRolePolicies` 已删除。
 * 这条占位注释保留给查 git blame 的同事:历史上角色有 `code` 时确实需要这个函数。
 */

/**
 * 菜单被删时清掉指向它的策略行。
 *
 * ⚠️ 这件事本来靠 `fk_sys_role_menu_menu` 的 cascade;Casbin 的行不是关系行,必须显式清。
 * 漏了不会立刻报错(装载时会把孤儿行跳过并告警),但库里会慢慢攒垃圾,而且"删了菜单再建同 id"会诈尸。
 */
export async function removeMenuPolicies(menuId: string): Promise<void> {
	await db
		.delete(sysCasbinRule)
		.where(and(eq(sysCasbinRule.ptype, POLICY_TYPE), eq(sysCasbinRule.v1, `${MENU_PREFIX}${menuId}`)));
	clearCasbinCache();
}
