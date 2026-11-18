/**
 * 系统字典种子(`sys_dict`)—— 幂等,可重复执行。
 *
 * 字典定义维护在 `rows`,新增业务字典也沿用同一套只补不覆盖规则。
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

/** 闵行街镇及片区:同名片区按所属街镇区分,重复来源行只保留一次。 */
const minhangAreas = [
	["七宝镇", ["中春片区", "九星片区", "吴宝片区", "新镇片区", "沪星片区", "航华片区", "静安片区"]],
	["华漕镇", ["华漕东片区", "纪王东片区", "纪王西片区", "诸翟北片区", "诸翟南片区"]],
	["古美路街道", ["东兰苑片区", "平阳里片区", "美乐汇片区"]],
	["吴泾镇", ["永德片区", "紫竹片区", "莲花片区", "龙吴片区"]],
	["新虹街道", ["华美片区", "枢纽片区", "爱博片区", "航华片区"]],
	["梅陇镇", ["南方片区", "春申片区", "晶城片区", "曹行东片区", "曹行南片区", "曹行西片区", "老梅陇片区"]],
	[
		"江川路街道",
		["凤庆片区", "沧源片区", "碧江（东）片区", "碧江（西）片区", "金平（北）片区", "金平（南）片区", "闵开发片区"],
	],
	["浦江镇", ["临陈片区", "兴农片区", "杜航片区", "永康片区", "浦航片区", "瑞和片区", "闵东片区"]],
	["浦锦街道", ["锦中片区", "锦北片区", "锦南片区"]],
	["莘庄工业区", ["申北（北部）片区", "鑫都（南部）片区"]],
	["莘庄镇", ["商务片区", "康城片区", "春申片区", "水清片区", "沁春片区", "莘光片区", "莘庄片区", "莘松片区"]],
	["虹桥镇", ["古北片区", "紫藤片区", "虹梅片区", "金汇片区"]],
	["颛桥镇", ["北桥片区", "君莲片区", "田园片区", "都市片区", "颛桥片区"]],
	["马桥镇", ["元江片区", "邻松片区", "银春片区"]],
] as const;

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
	{
		code: "minhang_towns",
		name: "闵行区街镇",
		items: minhangAreas.map(([town]) => ({ label: town, value: town })),
		remark: "14 个街镇（含莘庄工业区）",
	},
	{
		code: "minhang_areas",
		name: "闵行区街镇片区",
		items: minhangAreas.flatMap(([town, areas]) =>
			areas.map((area) => ({
				label: `${town} · ${area}`,
				value: `${town} · ${area}`,
			})),
		),
		remark: "片区名称包含所属街镇；相同街镇及片区的重复记录已去重",
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
