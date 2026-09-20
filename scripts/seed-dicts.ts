/**
 * 系统字典种子(`sys_dict`)—— 幂等,可重复执行。
 *
 * 模板只放一个**示例字典**,演示「字段管理」页的数据形状;真实项目把自己的枚举加进 `rows` 即可。
 * **只补不覆盖**:字典项被人在库里改过(增删 / 改中文名)之后再跑本脚本不会回滚你的改动,
 * 只有在字典**整行不存在**时才插入。
 *
 * 用法:`pnpm db:seed:dicts`
 */
import "dotenv/config";

import { eq } from "drizzle-orm";

import { sysDict } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";

const rows = [
	{
		id: "yes_no",
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
	const [existing] = await db.select({ id: sysDict.id }).from(sysDict).where(eq(sysDict.id, row.id)).limit(1);
	if (existing) continue;
	await db.insert(sysDict).values({ ...row, status: 1 });
	inserted += 1;
}

const all = await db.select({ id: sysDict.id }).from(sysDict);
console.log(`✓ 字典种子完成:本次新增 ${inserted} 条,表内共 ${all.length} 条`);
process.exit(0);
