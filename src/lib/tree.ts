/**
 * 平铺行 → 树(自关联表的统一拼法)。
 *
 * 以前这套逻辑在项目里**存在五份**(菜单导航 / 菜单管理 / 部门 / 标签 / 角色的权限树),
 * 每份都自己写"按 parentId 分组 + 同级排序 + 递归",于是**各自漏了不同的东西**:
 *
 *  - 只有部门树做了「父不存在 → 提到一级」的容错(父被删时,别的树那一枝会**整块消失** ——
 *    数据在、界面上谁也看不见,最难排查);
 *  - 只有菜单管理树有**环保护**(脏数据里出现 A→B→A 时,别处会**无限递归**)。
 *
 * 收成一处之后两个坑一起补上,五处调用点只剩"传进来的排序口径"和"节点长什么样"两件事。
 *
 * 与「禁止薄封装」不冲突:删掉它,五个调用点各自要重复**分组 + 排序 + 递归 + 环保护 + 孤儿提升**
 * —— 这是**逻辑**,不是别名转发。
 */

/** 能拼成树的行的最小要求(项目的自关联表都满足) */
export type TreeRow = {
	id: string;
	parentId: string | null;
};

/** 通用节点形态:行字段原样展开 + 树特有字段 */
export type TreeNode<T extends TreeRow> = T & {
	depth: number;
	children: TreeNode<T>[];
};

/**
 * 只做「分组 + 同级排序 + 父不存在时提升为根」这一半 ——
 * 节点形状**不通用**的树(如角色的权限树只有 `{ id, name, children }`)用这一段,
 * 自己递归;形状是 `{...row, depth, children}` 的树直接用 `buildTree`。
 */
export function groupByParent<T extends TreeRow>(
	rows: readonly T[],
	options?: {
		/** 顶层行的 `parentId` 值(默认 `null`;菜单 / 部门 / 权限树用的是 `""`) */
		rootKey?: string | null;
		/** 同级排序(默认不排;调用方一般传"sort 升序,再按名字/标签") */
		compare?: (left: T, right: T) => number;
		/**
		 * `parentId` 指向一个**不存在的行**时,把这一行提到一级(默认 `true`)。
		 * 关掉会整枝消失 —— 只有"本来就按可见性过滤过行"的导航树才该关。
		 */
		promoteOrphans?: boolean;
	},
): { byParent: Map<string | null, T[]>; roots: T[] } {
	const rootKey = options?.rootKey ?? null;
	const byParent = new Map<string | null, T[]>();
	for (const row of rows) {
		const key = row.parentId ?? rootKey;
		const bucket = byParent.get(key);
		if (bucket) bucket.push(row);
		else byParent.set(key, [row]);
	}
	if (options?.compare) {
		const compare = options.compare;
		for (const list of byParent.values()) list.sort(compare);
	}

	const roots = [...(byParent.get(rootKey) ?? [])];
	if (options?.promoteOrphans !== false) {
		const known = new Set(rows.map((row) => row.id));
		// parentId 非空、但父不在这批行里 → 当一级(否则整枝消失)
		for (const row of rows) if (row.parentId != null && !known.has(row.parentId)) roots.push(row);
	}
	return { byParent, roots };
}

/**
 * 平铺行 → `{ tree, byId }`。
 *
 * `byId` 顺手带走:详情面板 / 选中态恢复都要按 id 反查,以前每个调用点自己再遍历一遍。
 * 带**环保护** —— 数据里出现环时停在该层,不会把栈打爆。
 */
export function buildTree<T extends TreeRow>(
	rows: readonly T[],
	options?: {
		rootKey?: string | null;
		compare?: (left: T, right: T) => number;
		promoteOrphans?: boolean;
	},
): { tree: TreeNode<T>[]; byId: Map<string, TreeNode<T>> } {
	const { byParent, roots } = groupByParent(rows, options);
	const byId = new Map<string, TreeNode<T>>();
	const expanding = new Set<string>();

	const make = (row: T, depth: number): TreeNode<T> => {
		const node: TreeNode<T> = { ...row, depth, children: [] };
		byId.set(row.id, node);
		if (expanding.has(row.id)) return node; // 环:停在这里,别把栈打爆
		expanding.add(row.id);
		// 同级已在 `groupByParent` 里排好,这里不再排一次(传 undefined 会退化成字符串排序)
		node.children = (byParent.get(row.id) ?? []).map((child) => make(child, depth + 1));
		expanding.delete(row.id);
		return node;
	};

	return { tree: roots.map((row) => make(row, 0)), byId };
}

/** 同级排序的通用口径:`sort` 升序,相同再按名字(中文按拼音) */
export function bySortThenName<T extends { sort: number; name: string }>(left: T, right: T): number {
	return left.sort - right.sort || left.name.localeCompare(right.name, "zh-Hans-CN");
}

/** 同上,但字段叫 `label`(标签表) */
export function bySortThenLabel<T extends { sort: number; label: string }>(left: T, right: T): number {
	return left.sort - right.sort || left.label.localeCompare(right.label, "zh-Hans-CN");
}
