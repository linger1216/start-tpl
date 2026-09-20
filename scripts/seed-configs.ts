/**
 * 参数种子 —— 把代码内置的默认参数(`lib/sys-config.ts` 的 `CONFIG_DEFAULTS`)落到库里。
 *
 * **只补不覆盖**:库里已存在的参数一条都不动(你在「参数管理」页调过的值不会被打回默认)。
 * 用法:`pnpm db:seed:configs`
 */
import "dotenv/config";

import { sysConfig } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { CONFIG_DEFAULTS } from "../src/lib/sys-config.ts";

const existing = new Set((await db.select().from(sysConfig)).map((row) => row.cfg_key));

let inserted = 0;
for (const [key, item] of Object.entries(CONFIG_DEFAULTS)) {
	if (existing.has(key)) continue;
	await db.insert(sysConfig).values({
		cfg_key: key,
		cfg_value: item.value,
		value_type: item.type,
		cfg_group: item.group,
		remark: item.remark,
		editable: 1,
	});
	inserted += 1;
}

const all = await db.select({ id: sysConfig.cfg_key }).from(sysConfig);
console.log(`✓ 参数种子完成:本次新增 ${inserted} 条,表内共 ${all.length} 条`);
process.exit(0);
