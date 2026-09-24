/**
 * 菜单类型码与文案 —— **客户端与服务端共用一份**(同 `lib/para-spec.ts` 的口径)。
 *
 * 为什么要有「按钮」这一档:`sys_menu` 同时承担两件事 ——
 *  1. 侧边栏要渲染什么(**导航**);
 *  2. 某个操作按钮该不该显示(**权限点**,认 `perm`)。
 *
 * 两者的区别只体现在 `type` 上:按钮不进导航(`buildNavTree` 会过滤掉),
 * 但它作为叶子出现在角色授权树里,授权后它的 `perm` 就进了用户的权限集合。
 * 现有菜单行全是 `2`(菜单),所以加这一列不改变任何既有行为。
 */
export const MENU_TYPE = {
	/** 目录:只是分组,不指向页面(路径给一个不指向路由的占位值) */
	DIR: 1,
	/** 菜单:侧边栏可见的页面 */
	MENU: 2,
	/** 按钮:只是权限点,不进侧边栏 */
	BUTTON: 3,
} as const;

export type MenuType = (typeof MENU_TYPE)[keyof typeof MENU_TYPE];

export const MENU_TYPES = [MENU_TYPE.DIR, MENU_TYPE.MENU, MENU_TYPE.BUTTON] as const;

export const MENU_TYPE_META: Record<MenuType, { label: string; hint: string }> = {
	[MENU_TYPE.DIR]: { label: "目录", hint: "只是分组,不指向页面(路径给占位值即可)" },
	[MENU_TYPE.MENU]: { label: "菜单", hint: "侧边栏可见的页面" },
	[MENU_TYPE.BUTTON]: { label: "按钮", hint: "只是权限点,不进侧边栏;前端靠 perm 判断是否显示" },
};

/** 库里的值可能是字符串(mysql2 对 tinyint 的口径不定),统一收敛成合法的类型码 */
export function asMenuType(value: unknown): MenuType {
	const n = Number(value);
	return n === MENU_TYPE.DIR || n === MENU_TYPE.BUTTON ? n : MENU_TYPE.MENU;
}

/**
 * 「切换用户(运维)」的权限点 —— **客户端与服务端共用这一份**。
 *
 * ⚠️ 别把它写在 `lib/auth-debug.ts` 里:那个文件 import 了 `#/lib/auth` → `#/db` → mysql2,
 * 客户端组件一旦 import 它,浏览器里没有 `Buffer.prototype`,整个应用直接崩
 * (同 AGENTS「认证」那两条硬约束的坑)。所以权限码这种"两边都要用的字符串"放这里。
 */
export const IMPERSONATE_PERM = "sys:user:impersonate";
