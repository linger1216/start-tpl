/**
 * **把库里的列注释 / 索引名对齐到最新口径** —— 幂等,只在不一致时 ALTER。
 *
 * 为什么单独一个脚本:表结构会改名、改列(`sys_config` → `sys_para`、`cfg_*` → `para_*`),
 * 但**列注释和索引名不会跟着变** —— MySQL 不认这种关联,于是库里留下一堆"描述旧列名"的残留:
 *  · `sys_dict.id` 还写着「字典编码(主键)」,而它早就是 nanoid、编码搬去了 `code`;
 *  · `sys_tag.id` 还写着「维度用 dim::xxx」,那是语义 id 时代的事;
 *  · `sys_para` 的索引还叫 `idx_cfg_group`(`cfg_` 是旧列名前缀)。
 * 这类残留比"没注释"更糟 —— 它**主动误导**后来的人。
 *
 * 两张表(desired)与库(current)比对后逐个 ALTER;跑第二遍不会再改任何东西。
 * `pnpm db:create` 建完表也会调这里,所以新库和旧库最终长得一样。
 *
 * 用法:`pnpm db:sync:meta`
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../src/db/index.ts";

/** 列注释的准绳(**唯一真源**)—— 想加注释改这里,不要再往 CREATE 语句里塞 */
const COLUMN_COMMENTS: Array<{ table: string; column: string; comment: string }> = [
	// sys_menu
	{ table: "sys_menu", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_menu", column: "parent_id", comment: "父菜单 id(nanoid);null = 一级菜单" },
	{ table: "sys_menu", column: "name", comment: "菜单名(侧边栏展示名)" },
	{ table: "sys_menu", column: "path", comment: "业务键:页面路由(not null + 唯一;纯分组请给占位路径)" },
	{ table: "sys_menu", column: "icon", comment: "图标名(小写 kebab-case,与 NAV_ICON_MAP 的键一致)" },
	{ table: "sys_menu", column: "sort", comment: "同级排序,越小越靠前" },
	{ table: "sys_menu", column: "visible", comment: "1 显示 / 0 隐藏(隐藏的分组连带子树一起不显示)" },
	{ table: "sys_menu", column: "status", comment: "1 启用 / 0 停用(当前代码没读它)" },
	{ table: "sys_menu", column: "create_time", comment: "创建时间" },
	{ table: "sys_menu", column: "update_time", comment: "更新时间" },
	// sys_dict
	{ table: "sys_dict", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_dict", column: "code", comment: "字典编码(业务键),如 entity_category —— 读写都按它" },
	{ table: "sys_dict", column: "name", comment: "字典名称(中文)" },
	{ table: "sys_dict", column: "items", comment: "字典项:[{label,value}]" },
	{ table: "sys_dict", column: "remark", comment: "说明" },
	{ table: "sys_dict", column: "status", comment: "1 启用 / 0 停用" },
	{ table: "sys_dict", column: "create_time", comment: "创建时间" },
	{ table: "sys_dict", column: "update_time", comment: "更新时间" },
	// sys_para
	{ table: "sys_para", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_para", column: "para_key", comment: "参数名,如 raw.retention.soft_days(表的主键)" },
	{ table: "sys_para", column: "para_value", comment: "参数值(text,不受 4000 字符列宽限制)" },
	{ table: "sys_para", column: "para_type", comment: "类型码:1:int 2:bool 3:string 4:json(见 lib/para-spec.ts)" },
	{ table: "sys_para", column: "para_group", comment: "分组(参数管理页按它归堆)" },
	{ table: "sys_para", column: "status", comment: "1 启用 / 0 停用(当前代码没读它)" },
	{ table: "sys_para", column: "remark", comment: "给人看的说明(界面直接展示)" },
	{ table: "sys_para", column: "editable", comment: "0 = 代码内置不允许改" },
	{ table: "sys_para", column: "create_time", comment: "创建时间" },
	{ table: "sys_para", column: "update_time", comment: "更新时间" },
	// sys_tag
	{ table: "sys_tag", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_tag", column: "parent_id", comment: "父节点 id(nanoid);null = 维度(一级节点)" },
	{ table: "sys_tag", column: "label", comment: "展示名(维度名 / 标签名);同级内唯一,种子按 (parent_id,label) 判重" },
	{ table: "sys_tag", column: "value", comment: "取值(可空)" },
	{ table: "sys_tag", column: "desc", comment: "含义说明" },
	{ table: "sys_tag", column: "sort", comment: "同级排序,越小越靠前" },
	{ table: "sys_tag", column: "create_time", comment: "创建时间" },
	{ table: "sys_tag", column: "update_time", comment: "更新时间" },
	// sys_tag_relation
	{ table: "sys_tag_relation", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_tag_relation", column: "tag_id", comment: "标签 id → sys_tag.id(只允许叶子标签)" },
	{ table: "sys_tag_relation", column: "obj_id", comment: "业务对象主键(字符串,兼容 nanoid / 编号)" },
	{ table: "sys_tag_relation", column: "obj_type", comment: "业务对象类型(tinyint 码,各业务自己约定;如 1 档案 / 2 数据源)" },
	{ table: "sys_tag_relation", column: "create_time", comment: "创建时间" },
	{ table: "sys_tag_relation", column: "update_time", comment: "更新时间" },
];

/**
 * 索引改名 —— 名字也是"说明文字"的一部分:`idx_cfg_group` 会让人以为还有 `cfg_group` 这一列。
 * 只改名字,不动列;目标名已存在就跳过。
 */
const INDEX_RENAMES: Array<{ table: string; from: string; to: string }> = [
	{ table: "sys_para", from: "idx_cfg_group", to: "idx_para_group" },
];

async function currentComments(table: string): Promise<Map<string, string>> {
	const rows = (
		await db.execute(
			sql`select column_name as name, column_comment as comment from information_schema.columns where table_schema = database() and table_name = ${table}`,
		)
	)[0] as unknown as Array<{ name: string; comment: string }>;
	return new Map(rows.map((row) => [row.name, row.comment ?? ""]));
}

async function indexNames(table: string): Promise<Set<string>> {
	const rows = (
		await db.execute(
			sql`select distinct index_name as name from information_schema.statistics where table_schema = database() and table_name = ${table}`,
		)
	)[0] as unknown as Array<{ name: string }>;
	return new Set(rows.map((row) => row.name));
}

/** 需要补的列类型(改注释时 MySQL 要求重复列定义,所以从 information_schema 取回来) */
async function columnTypes(table: string): Promise<Map<string, { type: string; nullable: string; default_: string | null }>> {
	const rows = (
		await db.execute(
			sql`select column_name as name, column_type as type, is_nullable as nullable, column_default as def from information_schema.columns where table_schema = database() and table_name = ${table}`,
		)
	)[0] as unknown as Array<{ name: string; type: string; nullable: string; def: string | null }>;
	return new Map(rows.map((row) => [row.name, { type: row.type, nullable: row.nullable, default_: row.def }]));
}

export async function syncTableMeta(): Promise<void> {
	let changed = 0;

	// ── 1) 列注释 ──
	const byTable = new Map<string, typeof COLUMN_COMMENTS>();
	for (const item of COLUMN_COMMENTS) {
		byTable.set(item.table, [...(byTable.get(item.table) ?? []), item]);
	}
	for (const [table, items] of byTable) {
		const current = await currentComments(table);
		const types = await columnTypes(table);
		for (const item of items) {
			if (!current.has(item.column)) {
				console.warn(`⚠️ ${table}.${item.column} 不存在,跳过(表结构可能还没升到最新)`);
				continue;
			}
			if (current.get(item.column) === item.comment) continue;
			const meta = types.get(item.column);
			if (!meta) continue;
			// ALTER 改注释必须把列定义重写一遍:类型 + null + 默认值,少一个都会被改坏
			const nullable = meta.nullable === "NO" ? "not null" : "null";
			const def = meta.default_ === null ? "" : ` default ${meta.default_.startsWith("CURRENT_TIMESTAMP") ? meta.default_ : `'${meta.default_}'`}`;
			await db.execute(
				sql.raw(
					`alter table \`${table}\` modify column \`${item.column}\` ${meta.type} ${nullable}${def} comment '${item.comment.replace(/'/g, "''")}'`,
				),
			);
			console.log(`· ${table}.${item.column}:「${current.get(item.column) || "(无)"}」→「${item.comment}」`);
			changed += 1;
		}
	}

	// ── 2) 索引改名 ──
	for (const item of INDEX_RENAMES) {
		const names = await indexNames(item.table);
		if (names.has(item.to)) {
			console.log(`· ${item.table}.${item.to} 已是目标名,跳过`);
			continue;
		}
		if (!names.has(item.from)) {
			console.log(`· ${item.table}.${item.from} 不存在,跳过`);
			continue;
		}
		await db.execute(sql.raw(`alter table \`${item.table}\` rename index \`${item.from}\` to \`${item.to}\``));
		console.log(`· ${item.table}:索引 ${item.from} → ${item.to}`);
		changed += 1;
	}

	console.log(changed === 0 ? "✓ 列注释与索引名已是最新,无需改动" : `✓ 已对齐 ${changed} 处(列注释 / 索引名)`);
}

// 直接执行时跑一次;被 db:create 引用时由那边调用
if (import.meta.url === `file://${process.argv[1]}`) {
	await syncTableMeta();
	process.exit(0);
}
