/**
 * 从 `doc/测试数据/综合网格履职情况列表.xlsx` 导入网格。
 *
 * 幂等:**按 `name + town_name` 判重,只补不覆盖** —— 已经导过的行不会被动,
 * 你在界面上改过的 `owner_id` 也不会被冲掉。
 *
 * 只取 5 列(街镇 / 网格名 / 网格长 / 职务),Excel 后面 17 列月度统计不建字段。
 */
import * as XLSXNS from "xlsx";

import { db, dmPool } from "../src/db/index.ts";
import { sysDemoGrid, sysDept } from "../src/db/data-base-schema.ts";
import { newId } from "../src/lib/ids.ts";

// xlsx@0.18 是 CJS:Node 里 `import *` 拿到的是命名空间,函数在 `.default` 上(踩过)
const XLSX = ((XLSXNS as unknown as { default?: typeof XLSXNS }).default ?? XLSXNS) as typeof XLSXNS;
const FILE = "doc/测试数据/综合网格履职情况列表.xlsx";

const text = (v: unknown) => String(v ?? "").trim();

async function main() {
	const book = XLSX.readFile(FILE);
	const sheet = book.Sheets[book.SheetNames[0] as string];
	const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
	const data = rows.slice(2).filter((row) => text(row[2]));

	// 街镇 → dept.id:优先「镇、街道」这个分组下的节点(那才是 14 个街镇),否则按名字兜底
	const depts = await db.select().from(sysDept);
	const group = depts.find((d) => d.name === "镇、街道");
	const townIdOf = (name: string): string | null => {
		const under = depts.find((d) => d.name === name && d.parent_id === group?.id);
		if (under) return under.id;
		return depts.find((d) => d.name === name)?.id ?? null;
	};

	const existing = await db.select({ name: sysDemoGrid.name, town: sysDemoGrid.town_name }).from(sysDemoGrid);
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
	console.log(`✓ 网格种子完成:本次新增 ${created} 行,表内共 ${existing.length + created} 行`);
	console.log(`  xlsx 数据行 ${data.length} 行;街镇 ${new Set(data.map((r) => text(r[1]))).size} 个`);
	if (missingTowns.size > 0) {
		console.log(`  ⚠️ 这些街镇在部门树里没找到(已写成 town_id = null):${[...missingTowns].join(" / ")}`);
	}
}

try {
	await main();
} finally {
	if (dmPool) await dmPool.close();
	else await db.$client.end();
}
