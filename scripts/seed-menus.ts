/**
 * 菜单种子脚本 —— 把静态配置 `NAV_NODES` 写成 `sys_menu` 表的行(幂等,**只补不覆盖**)。
 *
 * 为什么要这个脚本:菜单表是运行时来源,但它刚建好时是空的;空表会退回静态菜单,
 * 于是"库里那份"和"代码里那份"就永远对不上了。这里把它们对齐一次,之后就以库为准:
 * 改名字 / 调顺序 / 下线(`visible = 0`)随便改,**再跑本脚本也不会覆盖你的改动**
 * (`insert ignore`,按 id 判重 —— 已存在的行一个字段都不动)。
 *
 * id 规则(与名字无关,改名字不会产生重复行):
 *  - 叶子:`path` 本身就是 id(如 `/settings/users`);
 *  - 分组:取其**第一个有 path 的后代**的两段前缀(如 `/settings`);取不到才退回 `@名称`;
 *  - 万一与别的节点撞 id,追加 `#2`、`#3`… 保证唯一。
 *
 * 用法:
 *   pnpm db:seed:menus
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { type NavNode, NAV_NODES } from "../src/components/layout/nav-config.ts";
import { sysMenu } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";

/** 取第一个有 path 的后代,拼出两段前缀作为分组 id */
function groupIdFrom(node: NavNode): string | null {
	const firstPath = findFirstPath(node);
	if (!firstPath) return null;
	const segments = firstPath.split("/").filter(Boolean);
	return segments.length > 0 ? `/${segments[0]}` : null;
}

function findFirstPath(node: NavNode): string | null {
	if (node.path) return node.path;
	for (const child of node.children ?? []) {
		const found = findFirstPath(child);
		if (found) return found;
	}
	return null;
}

type MenuRow = {
	id: string;
	parentId: string | null;
	name: string;
	path: string | null;
	icon: string;
	sort: number;
};

/** 深度优先展平;id 在同一层内去重 */
function flatten(nodes: readonly NavNode[], parentId: string | null, out: MenuRow[] = []): MenuRow[] {
	const taken = new Set(out.map((row) => row.id));
	nodes.forEach((node, index) => {
		const base = node.path ?? groupIdFrom(node) ?? `@${node.name}`;
		let id = base;
		let suffix = 2;
		while (taken.has(id)) {
			id = `${base}#${suffix}`;
			suffix += 1;
		}
		taken.add(id);
		out.push({
			id,
			parentId,
			name: node.name,
			path: node.path ?? null,
			icon: node.icon,
			sort: index,
		});
		if (node.children?.length) flatten(node.children, id, out);
	});
	return out;
}

const rows = flatten(NAV_NODES, null);

const inserted = await db
	.insert(sysMenu)
	.values(rows.map((row) => ({ ...row, visible: 1 })))
	.onDuplicateKeyUpdate({ set: { id: sql`${sysMenu.id}` } });

const all = await db.select({ id: sysMenu.id }).from(sysMenu);
console.log(`✓ 菜单种子完成:配置里 ${rows.length} 个节点,表内共 ${all.length} 行(已存在的未覆盖)`);
void inserted;
process.exit(0);
