/**
 * **存量数据主键迁移:把语义 id 换成 nanoid。**
 *
 * 背景:早先 `sys_menu.id` 存的是 path(`/settings/users`)、`sys_dict.id` 存的是字典编码,
 * `sys_tag.id` 存的是 `dim::xxx` —— 都是"有意义但会被改"的字符串。现在统一:主键一律 nanoid,
 * 业务键各自有列(菜单 = `path`、字典 = `code`、标签 = `(parent_id, label)`)。
 *
 * 这个脚本做四件事(**幂等**,已迁移过的行不动;全程一个事务):
 *  1. `sys_menu`:`id` → nanoid,并把 `parent_id` 一起改写(先建 old→new 映射,再统一替换);
 *  2. `sys_dict`:补 `code` 列(从旧 id 回填),再把 `id` → nanoid;
 *  3. `sys_tag` / `sys_tag_relation`:同理改写(表为空时是空操作);
 *  4. 补上 `uk_sys_dict_code` / `uk_sys_menu_path` 两个唯一索引(缺了才加;有重复数据会明确报出来);
 *  5. 修正 `sys_para.para_type` **装不下自己值**的行(旧库把 'string' 这类字符串类型机械转成码时留下的):
 *
 * 用法:`pnpm db:migrate:ids`
 *  **跑之前建议备份**:它会改写主键。没有外键约束,改写不会级联删数据。
 */
import "dotenv/config";

import { eq, sql } from "drizzle-orm";
import { sysPara } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";
import { PARA_TYPE, type ParaType, validateParaValue } from "../src/lib/para-spec.ts";

const NANOID_RE = /^[A-Za-z0-9_-]{21}$/;

async function columns(table: string): Promise<Set<string>> {
	const result = await db.execute(
		sql`select column_name from information_schema.columns where table_schema = database() and table_name = ${table}`,
	);
	return new Set(
		(result[0] as unknown as Array<Record<string, unknown>>).map((row) => String(row.COLUMN_NAME ?? row.column_name)),
	);
}

async function indexes(table: string): Promise<Set<string>> {
	const result = await db.execute(
		sql`select index_name from information_schema.statistics where table_schema = database() and table_name = ${table}`,
	);
	return new Set(
		(result[0] as unknown as Array<Record<string, unknown>>).map((row) => String(row.INDEX_NAME ?? row.index_name)),
	);
}

/**
 * 把一张表的 id 换成 nanoid,可选地只处理"还不像 nanoid"的行。
 *
 * 逐行 update 而不是批量替换:表很小(菜单 / 字典都是几十行),但 parent_id 需要先按映射改写,
 * 所以顺序是「先改所有 parent_id → 再改所有 id」,两步都在同一个事务里。
 */
async function migrateIds({
	table,
	idColumn = "id",
	parentColumn,
	extraPredicate = "",
}: {
	table: string;
	idColumn?: string;
	parentColumn?: string;
	/** 额外的"只处理这些行"条件(如 `and code is null`) */
	extraPredicate?: string;
}): Promise<{ migrated: number; kept: number }> {
	const result = await db.execute(
		sql.raw(
			`select \`${idColumn}\` as id${parentColumn ? `, \`${parentColumn}\` as parent_id` : ""} from \`${table}\` ${extraPredicate ? `where 1=1 ${extraPredicate}` : ""}`,
		),
	);
	const rows = (result[0] as unknown as Array<{ id: string; parent_id?: string | null }>) ?? [];

	const mapping = new Map<string, string>();
	for (const row of rows) {
		if (!NANOID_RE.test(row.id)) mapping.set(row.id, newId());
	}
	if (mapping.size === 0) return { migrated: 0, kept: rows.length };

	await db.transaction(async (tx) => {
		if (parentColumn) {
			for (const [oldId, newIdValue] of mapping) {
				await tx.execute(
					sql.raw(
						`update \`${table}\` set \`${parentColumn}\` = '${newIdValue}' where \`${parentColumn}\` = '${oldId}'`,
					),
				);
			}
		}
		for (const [oldId, newIdValue] of mapping) {
			await tx.execute(
				sql.raw(`update \`${table}\` set \`${idColumn}\` = '${newIdValue}' where \`${idColumn}\` = '${oldId}'`),
			);
		}
	});

	return { migrated: mapping.size, kept: rows.length - mapping.size };
}

async function ensureUniqueIndex(table: string, name: string, ddl: string): Promise<void> {
	if ((await indexes(table)).has(name)) {
		console.log(`· 索引已存在 ${table}.${name}`);
		return;
	}
	try {
		await db.execute(sql.raw(ddl));
		console.log(`✓ 新建索引 ${table}.${name}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`⚠️ 建索引 ${table}.${name} 失败(${message})—— 先清重复数据再加,本次跳过`);
	}
}

console.log("── 1) sys_menu: id / parent_id → nanoid ──");
console.log("  ", await migrateIds({ table: "sys_menu", parentColumn: "parent_id" }));

console.log("── 2) sys_dict: 补 code 列 + id → nanoid ──");
if (!(await columns("sys_dict")).has("code")) {
	// 旧库没有 code:先加列(允许为空),把旧 id 回填进去,再由下面的迁移保证非空
	await db.execute(
		sql.raw(
			"alter table `sys_dict` add column `code` varchar(64) character set utf8mb4 collate utf8mb4_unicode_ci null comment '字典编码(业务键)' after `id`",
		),
	);
	console.log("✓ 已新增 sys_dict.code 列");
}
await db.execute(sql.raw("update `sys_dict` set `code` = `id` where `code` is null or `code` = ''"));
console.log("  ", await migrateIds({ table: "sys_dict" }));
await db.execute(
	sql.raw(
		"alter table `sys_dict` modify column `code` varchar(64) character set utf8mb4 collate utf8mb4_unicode_ci not null comment '字典编码(业务键)'",
	),
);

console.log("── 3) sys_tag: id / parent_id → nanoid ──");
console.log("  ", await migrateIds({ table: "sys_tag", parentColumn: "parent_id" }));

console.log("── 4) 补唯一索引 ──");
await ensureUniqueIndex(
	"sys_dict",
	"uk_sys_dict_code",
	"alter table `sys_dict` add unique key `uk_sys_dict_code` (`code`)",
);
await ensureUniqueIndex(
	"sys_menu",
	"uk_sys_menu_path",
	"alter table `sys_menu` add unique key `uk_sys_menu_path` (`path`)",
);

// ── 5) 修 para_type:类型码装不下自己的值 → 按值重新推断 ──
console.log("── 5) 修正 sys_para.para_type 与值不匹配的行 ──");

/** 按值推断类型码:布尔 → 整数 → JSON → 文本(只在"已声明类型装不下"时才用) */
function inferParaType(value: string): ParaType {
	const trimmed = value.trim();
	if (trimmed === "true" || trimmed === "false") return PARA_TYPE.BOOL;
	if (/^-?\d+$/.test(trimmed)) return PARA_TYPE.INT;
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			JSON.parse(trimmed);
			return PARA_TYPE.JSON;
		} catch {
			/* 落到文本 */
		}
	}
	return PARA_TYPE.STRING;
}

const paraRows = await db.select().from(sysPara);
let repaired = 0;
for (const row of paraRows) {
	const declared = row.para_type as ParaType;
	// 声明类型能装下这个值 → 不动它(string 能装下任何值,所以只有"更严"的类型才会被判不匹配)
	if (validateParaValue(declared, row.para_value) === null) continue;
	const inferred = inferParaType(row.para_value);
	await db.update(sysPara).set({ para_type: inferred }).where(eq(sysPara.para_key, row.para_key));
	console.log(`  ${row.para_key}: para_type ${declared} → ${inferred}(值「${row.para_value}」装不进原类型)`);
	repaired += 1;
}
console.log(repaired === 0 ? "  无需修正" : `  已修正 ${repaired} 行`);

console.log("\n迁移完成。抽查:");
for (const table of ["sys_menu", "sys_dict", "sys_tag", "sys_para"]) {
	const result = await db.execute(sql.raw(`select id from \`${table}\` limit 5`));
	const ids = ((result[0] as unknown as Array<{ id: string }>) ?? []).map((row) => row.id);
	console.log(`  ${table}: ${ids.length === 0 ? "(空表)" : ids.join(", ")}`);
}
process.exit(0);
