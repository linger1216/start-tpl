/**
 * 「参数化菜单路径」约定 —— 菜单 `path` 里嵌记录 id 的一类菜单。
 *
 * 典型场景:某条菜单不是打开一个固定页面,而是「打开某条记录的明细页」,
 * 于是 `menu.path = <前缀>/<记录 id>`(如 `/data/raw/SRC-260920-153045`)。
 *
 * 为什么值得单独约定(踩过两个坑):
 *  1. **不能按 path 派生权限点** —— 派生出来是 `data:raw:SRC-260920-153045`,
 *     授权页根本无法表达这种码,于是整条菜单永远授权不了(`nav-config.ts` 里跳过派生);
 *  2. **路径冲突要说人话** —— 用户看到"路径被占用"会去改路径,其实是"这条记录已经挂在一处了",
 *     服务端要能识别出来并给出正确提示(`trpc/routers/menu.ts`);
 *  3. 菜单管理页要能把它标出来(区别于普通页面菜单),否则管理员会去手改它的 path。
 *
 * 换项目时:把 `MENU_DETAIL_PATH_PREFIX` 改成你自己的前缀即可(只此一处)。
 * 不用这类菜单的项目:本文件可以整个删掉,同时移除 `nav-config.ts` 与
 * `trpc/routers/menu.ts` 里对应的两处引用。
 */

/** 参数化菜单路径的前缀 —— 改这一行即可换成新项目的约定 */
const MENU_DETAIL_PATH_PREFIX = "/data/raw/";

/** 明细页路径 → 记录 id;不是这种路径(或没有后缀)时返回 `null` */
export function recordIdFromMenuDetailPath(path: string | null | undefined): string | null {
	if (!path || !path.startsWith(MENU_DETAIL_PATH_PREFIX)) return null;
	const id = path.slice(MENU_DETAIL_PATH_PREFIX.length);
	return id || null;
}
