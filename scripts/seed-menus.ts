/**
 * 菜单种子脚本 —— 把静态配置 `NAV_NODES` 写成 `sys_menu` 表的行(幂等,**只补不覆盖**)。
 *
 * 为什么要这个脚本:菜单表是运行时来源,但它刚建好时是空的;空表会退回静态菜单,
 * 于是"库里那份"和"代码里那份"就永远对不上了。这里把它们对齐一次,之后就以库为准:
 * 改名字 / 调顺序 / 下线(`visible = 0`)随便改,**再跑本脚本也不会覆盖你的改动**。
 *
 * 判重口径(**业务键,不是主键**):
 *  - 有 `path` 的节点 → 按 `path` 认;
 *  - 纯分组(没有 `path`)→ 按 `name` 认。
 *  主键是 nanoid,每次生成都不同,**绝不能拿它当判重依据**(那样每跑一次就多出一份菜单)。
 *  这也正是把 id 换成 nanoid 之后本脚本必须改的地方。
 *
 * 用法:
 *   pnpm db:seed:menus
 */
import "dotenv/config";

import { NAV_NODES, type NavNode } from "../src/components/layout/nav-config.ts";
import { sysMenu } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";

type ExistingRow = { id: string; parent_id: string | null; name: string; path: string };
type DraftRow = { key: string; parentKey: string | null; name: string; path: string; icon: string };

/**
 * 深度优先展平。`key` 就是 `path`。
 *
 * ⚠️ 表定义里 `path` 是 **not null + 唯一**,而 `NAV_NODES` 里有**纯分组**(没有自己的路由,
 * 如「框架能力 / Demo」)。早期实现是把它们**连同子树一起跳过**,后果是:
 * 分组下的页面永远进不了 `sys_menu` ⇒ 权限体系一开(侧边栏以库为准)**整枝消失**,
 * 而且授权树里也没有它们,自然授不了按钮权限。实测踩过(见 `doc/测试数据/README.md`)。
 *
 * 现在的做法:给纯分组一个**合成 path** `#group/<名字>`(与按钮的 `#perm/<权限码>` 同一套思路 ——
 * 表上要求非空,那就给个"不是真实路由"的占位),然后**照常往下走**。
 * 合成 path 不会被当成跳转目标:`sidebar.tsx` 判断顺序是「先看有没有 children,再看 path」,
 * 有子节点的行永远渲染成可展开分组。
 */
function flatten(
	nodes: readonly NavNode[],
	parentKey: string | null,
	out: DraftRow[] = [],
	renamed: string[] = [],
): DraftRow[] {
	const used = new Set(out.map((row) => row.key));
	nodes.forEach((node) => {
		let key = node.path;
		if (!key) {
			// 纯分组:合成 path 兜底(同名分组加序号,保证唯一)
			key = `#group/${node.name}`;
			let n = 2;
			while (used.has(key)) key = `#group/${node.name}-${n++}`;
			renamed.push(node.name);
		}
		used.add(key);
		out.push({ key, parentKey, name: node.name, path: key, icon: node.icon });
		if (node.children?.length) flatten(node.children, key, out, renamed);
	});
	return out;
}

const existing: ExistingRow[] = await db
	.select({ id: sysMenu.id, parent_id: sysMenu.parent_id, name: sysMenu.name, path: sysMenu.path })
	.from(sysMenu);
/** path → 已存在的行(有 path 的节点按它认) */
const byPath = new Map(existing.map((row) => [row.path, row]));

const grouped: string[] = [];
const drafts = flatten(NAV_NODES, null, [], grouped);
/** 业务键 → 该节点最终用的主键(nanoid) */
const idByKey = new Map<string, string>();
const toInsert: Array<typeof sysMenu.$inferInsert> = [];

for (const [index, draft] of drafts.entries()) {
	// 按 path 认(表定义里 path 唯一)
	const found = byPath.get(draft.path);
	if (found) {
		idByKey.set(draft.key, found.id);
		continue; // 已存在的行**一个字段都不动**
	}
	const id = newId();
	idByKey.set(draft.key, id);
	toInsert.push({
		id,
		parent_id: draft.parentKey ? (idByKey.get(draft.parentKey) ?? null) : null,
		name: draft.name,
		path: draft.path,
		icon: draft.icon,
		sort: index,
		visible: 1,
	});
}

if (toInsert.length > 0) await db.insert(sysMenu).values(toInsert);

const all = await db.select({ id: sysMenu.id }).from(sysMenu);
console.log(
	`✓ 菜单种子完成:配置里 ${drafts.length} 个有路由的节点,本次新增 ${toInsert.length} 行,表内共 ${all.length} 行(已存在的未覆盖)` +
		(grouped.length > 0 ? `\n  把 ${grouped.length} 个纯分组用合成 path 并进了菜单树:${grouped.join("、")}` : ""),
);
process.exit(0);
