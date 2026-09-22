/**
 * 参数种子 —— 把代码内置的默认参数(`lib/sys-para.ts` 的 `PARA_DEFAULTS`)落到库里。
 *
 * **只补不覆盖**:库里已存在的参数一条都不动(你在「参数管理」页调过的值不会被打回默认)。
 *
 * 表是 `sys_para`(旧名 `sys_config`):
 *  - 主键 `para_key`;`id` 是 not null 的普通列,**没有默认值,必须自己生成**(`newId()`);
 *  - `para_type` 是 tinyint 码(1 int / 2 bool / 3 string / 4 json),来自 `PARA_DEFAULTS` 的 `type`。
 *
 * 用法:`pnpm db:seed:paras`
 */
import "dotenv/config";

import { sysPara } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";
import { PARA_DEFAULTS } from "../src/lib/sys-para.ts";

const existing = new Set((await db.select().from(sysPara)).map((row) => row.para_key));

let inserted = 0;
for (const [key, item] of Object.entries(PARA_DEFAULTS)) {
	if (existing.has(key)) continue;
	await db.insert(sysPara).values({
		// 主键是 para_key;id 没有默认值 —— 每一处 insert 都必须自己生成
		id: newId(),
		para_key: key,
		para_value: item.value,
		para_type: item.type,
		para_group: item.group,
		remark: item.remark,
		editable: 1,
	});
	inserted += 1;
}

const all = await db.select({ key: sysPara.para_key }).from(sysPara);
console.log(`✓ 参数种子完成:本次新增 ${inserted} 条,表内共 ${all.length} 条`);

// 显式退出:MySQL 连接池是空闲句柄,不关进程不退出(其它 seed 脚本同理)
process.exit(0);
