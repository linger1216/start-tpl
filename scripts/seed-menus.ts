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

import { type NavNode, NAV_NODES } from "../src/components/layout/nav-config.ts";
import { sysMenu } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";

type ExistingRow = { id: string; parent_id: string | null; name: string; path: string };
type DraftRow = { key: string; parentKey: string | null; name: string; path: string; icon: string };

/**
 * 深度优先展平。`key` 就是 `path`。
 *
 * ⚠️ 表定义里 `path` 是 **not null + 唯一**,所以**没有 path 的节点(如「组件展示 / 框架能力」
 * 这两个纯分组)连同其子树一起跳过** —— 它们只活在代码兜底 `NAV_NODES` 里,
 * 能进库的必然有路由。跳过的节点会打印出来,别让"少了一枝"变成静默行为。
 */
function flatten(nodes: readonly NavNode[], parentKey: string | null, out: DraftRow[] = [], skipped: string[] = []): DraftRow[] {
	nodes.forEach((node) => {
		if (!node.path) {
			skipped.push(node.name);
			return; // 连子树一起跳过
		}
		out.push({ key: node.path, parentKey, name: node.name, path: node.path, icon: node.icon });
		if (node.children?.length) flatten(node.children, node.path, out, skipped);
	});
	return out;
}

const existing: ExistingRow[] = await db
	.select({ id: sysMenu.id, parent_id: sysMenu.parent_id, name: sysMenu.name, path: sysMenu.path })
	.from(sysMenu);
/** path → 已存在的行(有 path 的节点按它认) */
const byPath = new Map(existing.map((row) => [row.path, row]));

const skipped: string[] = [];
const drafts = flatten(NAV_NODES, null, [], skipped);
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
			(skipped.length > 0 ? `\n  跳过 ${skipped.length} 个没有 path 的节点(path 是表上的非空唯一键):${skipped.join("、")}` : ""),
);
process.exit(0);
