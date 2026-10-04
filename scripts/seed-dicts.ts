/**
 * 系统字典种子(`sys_dict`)—— 幂等,可重复执行。
 *
 * 模板只放一个**示例字典**,演示「字段管理」页的数据形状;真实项目把自己的枚举加进 `rows` 即可。
 * **只补不覆盖**:字典项被人在库里改过(增删 / 改中文名)之后再跑本脚本不会回滚你的改动,
 * 只有在字典**整行不存在**时才插入。
 *
 * 判重口径:`code`(字典编码,业务键)。主键是 nanoid,每次生成都不同,拿它判重会每跑一次多一行。
 * **只认活着的行**(`deleted_at is null`):编码被软删之后,本脚本要能把它重建出来,
 * 否则「删掉 → 想用同一个 code 再建」永远建不出来(编码还没被 tombstone 让开)。
 *
 * 用法:`pnpm db:seed:dicts`
 */
import "dotenv/config";

import { and, eq } from "drizzle-orm";

import { sysDict } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";
import { alive } from "../src/lib/soft-delete.ts";

const rows = [
	{
		code: "yes_no",
		name: "是否",
		items: [
			{ label: "是", value: "1" },
			{ label: "否", value: "0" },
		],
		remark: "通用布尔字典示例 —— 派生新项目时替换成自己的枚举",
	},
];

let inserted = 0;
for (const row of rows) {
	const [existing] = await db
		.select({ id: sysDict.id })
		.from(sysDict)
		.where(and(eq(sysDict.code, row.code), alive(sysDict)))
		.limit(1);
	if (existing) continue;
	await db.insert(sysDict).values({ ...row, id: newId(), status: 1 });
	inserted += 1;
}

const all = await db.select({ id: sysDict.id }).from(sysDict).where(alive(sysDict));
console.log(`✓ 字典种子完成:本次新增 ${inserted} 条,表内有效 ${all.length} 条`);
process.exit(0);
