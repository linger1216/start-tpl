/**
 * **一次性迁移:把 `sys_user_role` / `sys_role_menu` 搬进 `casbin_rule`。**
 *
 * 功能权限从"自家两张关系表"换成 Casbin 之后,策略表里存的是:
 *
 *   p, role:<角色 code>, menu:<菜单 id>, access      ← 原 `sys_role_menu`
 *   g, user:<用户 id>,  role:<角色 code>             ← 原 `sys_user_role`
 *
 * 形状变了,老数据得搬一次。三条纪律:
 *
 *   ① **先查再插**(不用 `on duplicate key update` —— 达梦不认),所以跑第二遍不会多出行;
 *   ② **只加不删**:`casbin_rule` 里已有的行(手工加的、上一轮搬过的)一行都不动;
 *   ③ **不自动删老表**:要删得显式带 `--drop`。不删也不影响运行(schema 里已经没有这两张表了),
 *      留着只是让 `sys_user` / `sys_role` / `sys_menu` 上还挂着几条没人用的外键。
 *
 * 为什么读老表用裸 SQL:它们已经从 `src/db/data-base-schema.ts` 里删掉了,drizzle 查不了。
 *
 * 用法:
 *   pnpm db:migrate:casbin             # 只搬数据
 *   pnpm db:migrate:casbin -- --drop   # 搬完把两张老表 drop 掉
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { addRoleMenus, addUserRole } from "../src/lib/casbin.ts";

const OLD_TABLES = ["sys_user_role", "sys_role_menu"] as const;

/** 表在不在 —— 老库有,新建的库从没建过(所以"没得搬"是正常情况,不是错误) */
async function tableExists(table: string): Promise<boolean> {
	try {
		await db.execute(sql.raw(`select count(*) as n from ${table}`));
		return true;
	} catch {
		return false;
	}
}

/**
 * 裸 SQL 读一批行。
 *
 * 列名统一转小写:MySQL 回原样(`user_id`)、达梦回大写(`USER_ID`)—— 不统一的话,
 * 下面每处都要写两份字段名。
 */
async function readRows<T>(query: string): Promise<T[]> {
	const result = (await db.execute(sql.raw(query)))[0] as unknown as Record<string, unknown>[] | undefined;
	return (result ?? []).map((row) =>
		Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])),
	) as T[];
}

/** 策略表里 `p` / `g` 各有多少行(用来报"这一趟搬进去多少") */
async function policyCounts(): Promise<{ p: number; g: number }> {
	const [row] = await readRows<{ p?: unknown; g?: unknown }>(
		"select sum(case when ptype = 'p' then 1 else 0 end) as p, sum(case when ptype = 'g' then 1 else 0 end) as g from casbin_rule",
	);
	return { p: Number(row?.p ?? 0), g: Number(row?.g ?? 0) };
}

async function main(): Promise<void> {
	const drop = process.argv.includes("--drop");
	const exists = {
		sys_user_role: await tableExists("sys_user_role"),
		sys_role_menu: await tableExists("sys_role_menu"),
	};
	if (!exists.sys_user_role && !exists.sys_role_menu) {
		console.log("✓ 两张老表都不在 —— 没有要搬的东西(`casbin_rule` 里已有的行保持不动)");
		process.exit(0);
	}

	const before = await policyCounts();

	// ① 用户 ↔ 角色:源表存的是 role_id,策略表要的是**角色 code**(角色改了 code,老行就认不出来了)
	if (exists.sys_user_role) {
		const list = await readRows<{ user_id: string; code: string | null }>(
			"select r.user_id as user_id, o.code as code from sys_user_role r join sys_role o on o.id = r.role_id",
		);
		const matched = list.filter((row) => row.code);
		for (const row of matched) await addUserRole(row.user_id, row.code as string);
		console.log(`  sys_user_role  → g 行:读出 ${list.length} 条,角色还在的 ${matched.length} 条`);
		if (list.length > matched.length) console.log(`      ⚠️ ${list.length - matched.length} 条指向的角色已不存在,跳过`);
	}

	// ② 角色 ↔ 菜单 / 按钮授权:同理,源表存 role_id → 策略表要角色 code
	if (exists.sys_role_menu) {
		const list = await readRows<{ code: string | null; menu_id: string }>(
			"select o.code as code, m.menu_id as menu_id from sys_role_menu m join sys_role o on o.id = m.role_id",
		);
		const byRole = new Map<string, string[]>();
		let orphan = 0;
		for (const row of list) {
			if (!row.code) {
				orphan += 1;
				continue;
			}
			byRole.set(row.code, [...(byRole.get(row.code) ?? []), row.menu_id]);
		}
		for (const [roleCode, menuIds] of byRole) await addRoleMenus(roleCode, menuIds);
		console.log(`  sys_role_menu  → p 行:读出 ${list.length} 条 → ${byRole.size} 个角色`);
		if (orphan > 0) console.log(`      ⚠️ ${orphan} 条指向的角色已不存在,跳过`);
	}

	const after = await policyCounts();
	console.log(
		`\n✓ 迁移完成:casbin_rule 的 g 行 ${before.g} → ${after.g}(+${after.g - before.g})、` +
			`p 行 ${before.p} → ${after.p}(+${after.p - before.p})`,
	);
	// 指向已删菜单的 `p` 行这里不校验 —— `lib/casbin.ts` 装载时会 warn(`casbin.menu_missing`)并跳过
	if (after.p === 0) {
		console.log("⚠️ `p` 行仍是 0 ⇒ 功能权限处于**未启用**(空表放行)状态,所有账号照旧全通。");
	}

	if (drop) {
		for (const table of OLD_TABLES) {
			if (!exists[table]) continue;
			await db.execute(sql.raw(`drop table ${table}`));
			console.log(`  drop table ${table}`);
		}
		console.log("  ⚠️ 两张老表已删除 —— `pnpm db:create` 不会再把它们建回来(schema 里已经没有了)");
	}
	process.exit(0);
}

main().catch((error) => {
	console.error("迁移失败:", error);
	process.exit(1);
});
