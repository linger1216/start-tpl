/**
 * 演示通知种子 —— 幂等「只补不覆盖」:某个账号**一条通知都没有**时才给他补 3 条。
 *
 * 为什么要种子:通知中心是"看得到才算存在"的功能,空库上铃铛永远是 0,
 * 没法验收"点一条跳转"这条路。其中一条**带 `path`**,专门用来演示跳转。
 */
import { eq } from "drizzle-orm";

import { db, dmPool } from "../src/db/index.ts";
import { sysNotice, sysUser } from "../src/db/data-base-schema.ts";
import { notify } from "../src/lib/notice.ts";

const DEMO: Array<{ title: string; body: string; path: string | null; level: "info" | "success" | "warn" | "danger" }> = [
	{
		title: "欢迎使用后台模板",
		body: "这条通知带跳转,点一下就跳到文件管理",
		path: "/settings/files",
		level: "info",
	},
	{
		title: "文件清理完成",
		body: "对象存储里的临时对象已按生命周期规则清掉",
		path: null,
		level: "success",
	},
	{
		title: "有 3 个账号还没有分配角色",
		body: "去用户管理给他们配上角色,否则他们看不到任何菜单",
		path: "/settings/users",
		level: "warn",
	},
];

async function main() {
	const users = await db.select({ id: sysUser.id, email: sysUser.email }).from(sysUser);
	let created = 0;
	for (const user of users) {
		const existing = await db.select({ id: sysNotice.id }).from(sysNotice).where(eq(sysNotice.user_id, user.id)).limit(1);
		if (existing.length > 0) continue;
		for (const item of DEMO) {
			await notify(user.id, item);
			created += 1;
		}
	}
	console.log(`✓ 通知种子完成:本次新增 ${created} 条(${users.length} 个账号,已有通知的跳过)`);
}

try {
	await main();
} finally {
	if (dmPool) await dmPool.close();
	else await db.$client.end();
}
