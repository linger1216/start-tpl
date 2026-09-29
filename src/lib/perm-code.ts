/**
 * **权限码本身的形状与比较** —— 纯逻辑,不碰库、不碰会话。
 *
 * 为什么单独一个文件(而不是留在 `lib/rbac.ts`):「权限码怎么写、怎么比」是**语法**,
 * 「这个用户实际有哪些码」是**计算**。功能权限的引擎(`lib/casbin.ts`)与菜单并集的计算
 * (`lib/rbac.ts`)都要用这套语法,而它俩互相引用 —— 语法抽到最底层,两边都往下依赖,没有环。
 *
 * `lib/rbac.ts` 会把这里的东西**原样再导出**(`PERM_FORMAT` / `permMatches` / `pagePermOf`),
 * 所以老调用方(`routers/menu.ts` / `trpc/init.ts` / `tests/*`)一行都不用改。
 */

/**
 * 权限标识(`perm`)的格式:**`域:资源:动作`**,三段小写;每段可以用一个**整段的 `*`** 通配。
 *
 * 域 = 一级模块的 key(如 `sys`),**允许长出新的域**(派生项目加模块就会多一个域)——
 * 受控的是**形状**,不是取值:菜单接口用这条规则校验,挡住两段 / 大写 / 半截通配(`sys:ro*`)这类脏值。
 */
export const PERM_FORMAT = /^(?:[a-z][a-z0-9_]*|\*):(?:[a-z][a-z0-9_]*|\*):(?:[a-z][a-z0-9_]*|\*)$/;

/** 这条 perm 是不是**模式**(含通配段) */
export function isPermPattern(perm: string): boolean {
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
