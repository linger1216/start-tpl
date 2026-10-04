/**
 * **演示数据种子**(通知 + 网格履职)—— 幂等「只补不覆盖」。
 *
 * 原来分成 `seed-notices.ts` 与 `seed-demo-grid.ts` 两个脚本:两个文件的头部
 * (`import db, dmPool`)、收尾(`main()` + `try/finally`)**逐字相同**,合并后少一份重复样板,
 * 也少一个「该跑哪个」的判断。两段各自幂等:
 *
 *  · **通知**:某个账号**一条通知都没有**时才给他补 3 条(其中一条带 `path`,演示跳转);
 *  · **网格**:按 `name + town_name` 判重,只补不覆盖 —— 你在界面上改过的 `owner_id` 不会被冲掉。
 *
 * 两段都只碰演示数据,不涉及任何初始化必需的表结构 / 权限。
 * 判重一律只看**活着的行**(`deleted_at is null`):软删的用户 / 部门 / 网格都不该再被拿来当锚点。
 */
import { eq } from "drizzle-orm";
import * as XLSXNS from "xlsx";
import { sysDemoGrid, sysDept, sysNotice, sysUser } from "../src/db/data-base-schema.ts";
import { db, dmPool } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";
import { notify } from "../src/lib/notice.ts";
import { alive } from "../src/lib/soft-delete.ts";

// ── 一、演示通知 ────────────────────────────────────────────────

const DEMO_NOTICES: Array<{
	title: string;
	body: string;
	path: string | null;
	level: "info" | "success" | "warn" | "danger";
}> = [
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

async function seedNotices(): Promise<void> {
	// 只给活着的账号补通知(软删账号不用再收到演示通知)
	const users = await db.select({ id: sysUser.id, email: sysUser.email }).from(sysUser).where(alive(sysUser));
	let created = 0;
	for (const user of users) {
		const existing = await db
			.select({ id: sysNotice.id })
			.from(sysNotice)
			.where(eq(sysNotice.user_id, user.id))
			.limit(1);
		if (existing.length > 0) continue;
		for (const item of DEMO_NOTICES) {
			await notify(user.id, item);
			created += 1;
		}
	}
	console.log(`✓ 通知种子完成:本次新增 ${created} 条(${users.length} 个账号,已有通知的跳过)`);
}

// ── 二、演示网格(从 doc/测试数据 的 xlsx 导入)─────────────────────

// xlsx@0.18 是 CJS:Node 里 `import *` 拿到的是命名空间,函数在 `.default` 上(踩过)
const XLSX = ((XLSXNS as unknown as { default?: typeof XLSXNS }).default ?? XLSXNS) as typeof XLSXNS;
const GRID_FILE = "doc/测试数据/综合网格履职情况列表.xlsx";

const text = (v: unknown) => String(v ?? "").trim();

async function seedDemoGrid(): Promise<void> {
	const book = XLSX.readFile(GRID_FILE);
	const sheet = book.Sheets[book.SheetNames[0] as string];
	const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
	const data = rows.slice(2).filter((row) => text(row[2]));

	// 街镇 → dept.id:优先「镇、街道」这个分组下的节点(那才是街镇),否则按名字兜底
	// 只认活着的部门:软删的街镇不能再被写成新网格的 town_id
	const depts = await db.select().from(sysDept).where(alive(sysDept));
	const group = depts.find((d) => d.name === "镇、街道");
	const townIdOf = (name: string): string | null => {
		const under = depts.find((d) => d.name === name && d.parent_id === group?.id);
		if (under) return under.id;
		return depts.find((d) => d.name === name)?.id ?? null;
	};

	const existing = await db
		.select({ name: sysDemoGrid.name, town: sysDemoGrid.town_name })
		.from(sysDemoGrid)
		.where(alive(sysDemoGrid));
	const seen = new Set(existing.map((r) => `${r.name}|${r.town ?? ""}`));
	const missingTowns = new Set<string>();
	let created = 0;
	for (const row of data) {
		const name = text(row[2]);
		const townName = text(row[1]);
		if (seen.has(`${name}|${townName}`)) continue;
		const townId = townIdOf(townName);
		if (!townId) missingTowns.add(townName);
		await db.insert(sysDemoGrid).values({
			id: newId(),
			name,
			town_name: townName,
			town_id: townId,
			owner_name: text(row[3]),
			owner_id: null, // 由界面指派(Excel 的网格长是真实姓名,与系统账号不是一回事)
			duty: text(row[4]),
			create_time: new Date(),
			update_time: new Date(),
		});
		seen.add(`${name}|${townName}`);
		created += 1;
	}
	console.log(`✓ 网格种子完成:本次新增 ${created} 行,表内有效 ${existing.length + created} 行`);
	console.log(`  xlsx 数据行 ${data.length} 行;街镇 ${new Set(data.map((r) => text(r[1]))).size} 个`);
	if (missingTowns.size > 0) {
		console.log(`  ⚠️ 这些街镇在部门树里没找到(已写成 town_id = null):${[...missingTowns].join(" / ")}`);
	}
}

// ── 收尾:两个种子依次跑(任一失败都会走 finally 关连接)──────────────

try {
	await seedNotices();
	await seedDemoGrid();
} finally {
	if (dmPool) await dmPool.close();
	else await db.$client.end();
}
