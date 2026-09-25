import { MENU_TYPE } from "#/lib/menu-spec";
import { bySortThenName, groupByParent } from "#/lib/tree";
import { NAV_ICON_MAP, type NavIcon, type NavNode } from "./nav-config";

/**
 * 「菜单表 → 导航树」的**唯一转换处**。
 *
 * 输入是 `menu` 表的一行行平铺记录(`parentId` 自关联),输出就是侧边栏 / 面包屑 /
 * 模块概览已经在用的 `NavNode[]` —— 所以渲染层一行不用改,换的是数据来源。
 *
 * 三条容错(菜单是**人手工在库里维护**的,不能假设数据永远干净):
 *  0. **按钮(`type = 3`)不进导航** —— 它是权限点,不是页面(授权树里才看得见它);
 *  1. `visible = 0` 的节点**连同其子树**一起不出现(下线一个分组 = 整块下线);
 *  2. `icon` 认不出来(拼错 / 用了未登记的图标名)→ 退回默认图标,不让整棵树挂掉;
 *  3. `parentId` 指向一个不存在的节点(父被删了)→ 当一级菜单处理;数据成环也不会无限递归。
 */

/** 菜单表的一行(tRPC 出参的形状;前端只依赖结构,不 import 服务端) */
export type MenuRow = {
	id: string;
	parentId: string | null;
	name: string;
	path: string | null;
	icon: string | null;
	sort: number;
	visible: number;
	/** 1 目录 / 2 菜单 / 3 按钮 */
	type: number;
	/** 权限标识(只有按钮一定有) */
	perm: string | null;
	/** 创建 / 更新时间(ISO 字符串;「编辑」面板底部统一展示) */
	createTime: string | null;
	updateTime: string | null;
};

/** icon 认不出来时的兜底图标 */
export const DEFAULT_MENU_ICON: NavIcon = "file-text";

/** 图标名 → 已登记的图标;不认识的退回默认 */
export function menuIconOf(icon: string | null | undefined): NavIcon {
	if (icon && icon in NAV_ICON_MAP) return icon as NavIcon;
	return DEFAULT_MENU_ICON;
}

/**
 * 平铺记录 → 导航树。
 *
 * 排序:同级按 `sort` 升序(相同再按名称),不依赖数据库返回顺序。
 */
export function buildNavTree(rows: readonly MenuRow[]): NavNode[] {
	const visibleRows = rows.filter((row) => Number(row.visible) !== 0 && Number(row.type) !== MENU_TYPE.BUTTON);
	// 分组 + 同级排序 + 孤儿提升都走 lib/tree.ts(五套树算法收成一处,见那里的注释)
	const { byParent, roots } = groupByParent(visibleRows, { rootKey: "", compare: bySortThenName });

	/** 正在展开的节点:防 `parentId` 成环(脏数据下只是少一层,不会栈溢出) */
	const expanding = new Set<string>();
	const toNode = (row: MenuRow): NavNode => {
		const node: NavNode = {
			name: row.name,
			icon: menuIconOf(row.icon),
		};
		if (row.path) node.path = row.path;
		if (!expanding.has(row.id)) {
			expanding.add(row.id);
			const children = byParent.get(row.id) ?? [];
			if (children.length > 0) node.children = children.map(toNode);
			expanding.delete(row.id);
		}
		return node;
	};

	// 一级菜单由 `groupByParent` 给出(含"父被删 → 子升为一级",免得整枝消失)
	return roots.map(toNode);
}

/**
 * 管理页用的树节点:比展示树多带 `id` / `visible` / `depth`,而且**不过滤隐藏项**
 * (菜单管理要看得见并操作 `visible = 0` 的行)。
 */
export type MenuTreeNode = MenuRow & {
	children: MenuTreeNode[];
	/** 层级(0 = 一级);拖拽时用来判断"是不是同一级" */
	depth: number;
};
