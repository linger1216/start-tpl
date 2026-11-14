#!/usr/bin/env node
/**
 * **只读**检查:表的「形状」在四处是否一致。
 *
 * 一张表的定义散在四个文件里(见 `doc/数据库与认证.md`):
 *   1. `src/db/data-base-schema.ts` —— drizzle 形状(读写的真源)
 *   2. `scripts/create-system-tables.ts` —— MySQL 新库建表 DDL
 *   3. `scripts/create-better-auth-tables-dm.ts` —— 达梦新库建表 DDL
 *   4. `scripts/sync-table-meta.ts` —— 列注释(唯一真源)
 *
 * 少改一处不会有任何报错,只会在**建库 / 补列**时炸出来(或者更糟:悄悄漂移)。
 * 本脚本把这四处对齐,漂了就报出来并给出建议。
 *
 * 用法:`pnpm db:check`(不连库,纯静态比对;退出码 1 = 有漂移)
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** 去掉注释,避免注释里的表名 / 列名被当成真的定义 */
function stripComments(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * 解析 drizzle 的 `mysqlTable(...)`:返回 表名 → 列的 **SQL 名**集合。
 * 手工扫括号,不靠正则匹配整个块 —— 表多了正则必然漏。
 */
function parseDrizzleTables(text) {
	const tables = new Map();
	const re = /mysqlTable\(\s*"(\w+)"/g;
	for (const m of text.matchAll(re)) {
		const table = m[1];
		const open = text.indexOf("{", m.index);
		if (open < 0) continue;
		let depth = 0;
		let end = open;
		for (let i = open; i < text.length; i++) {
			const ch = text[i];
			if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		const body = text.slice(open, end);
		const columns = new Set();
		// `prop: varchar("sql_name", …)` / `prop: datetime("sql_name", …)`
		for (const c of body.matchAll(
			/(\w+):\s*(?:varchar|char|int|tinyint|bigint|text|json|datetime|timestamp|boolean)\(\s*"(\w+)"/g,
		)) {
			columns.add(c[2]);
		}
		tables.set(table, columns);
	}
	return tables;
}

/** 解析 MySQL 新库建表脚本:表名 → 列集合 */
function parseMysqlDdl(text) {
	const plain = stripComments(text).replace(/\\`/g, "`");
	const tables = new Map();
	const re = /create table if not exists `(\w+)` \(([\s\S]*?)\) engine/g;
	for (const m of plain.matchAll(re)) {
		const columns = new Set();
		// 列定义一定是「反引号名 + 类型」;索引名后面跟的是 `(`,不会被这里匹配到
		for (const c of m[2].matchAll(
			/`(\w+)`\s+(?:varchar|char|int|tinyint|bigint|text|json|datetime|timestamp|boolean)\b/g,
		)) {
			columns.add(c[1]);
		}
		tables.set(m[1], columns);
	}
	return tables;
}

/** 解析达梦新库建表脚本:表名 → 列集合 */
function parseDmDdl(text) {
	const plain = stripComments(text);
	const tables = new Map();
	const re = /create table if not exists \$\{S\}\."(\w+)" \(([\s\S]*?)\n\s*\)/g;
	for (const m of plain.matchAll(re)) {
		const columns = new Set();
		for (const c of m[2].matchAll(
			/"(\w+)"\s+(?:varchar|char|int|tinyint|bigint|text|json|datetime|timestamp|boolean)\b/g,
		)) {
			columns.add(c[1]);
		}
		tables.set(m[1], columns);
	}
	return tables;
}

/** 解析列注释真源:表名 → 列集合(只取 `COLUMN_COMMENTS` 那一段,别把别的数组也吃进来) */
function parseMeta(text) {
	const tables = new Map();
	const start = text.indexOf("const COLUMN_COMMENTS");
	const block = start < 0 ? text : text.slice(start, text.indexOf("\n];", start));
	for (const m of block.matchAll(/\{\s*table:\s*"(\w+)",\s*column:\s*"(\w+)"/g)) {
		if (!tables.has(m[1])) tables.set(m[1], new Set());
		tables.get(m[1]).add(m[2]);
	}
	return tables;
}

// `todos` 归 drizzle 迁移管(MySQL 建表脚本里没有它),不参与四处比对
const IGNORED_TABLES = new Set(["todos"]);
const schema = parseDrizzleTables(`${stripComments(read("src/db/data-base-schema.ts"))}\n${read("src/db/schema.ts")}`);
const mysql = parseMysqlDdl(read("scripts/create-system-tables.ts"));
const dm = parseDmDdl(read("scripts/create-better-auth-tables-dm.ts"));
const meta = parseMeta(read("scripts/sync-table-meta.ts"));

const problems = [];

for (const [table, columns] of schema) {
	if (IGNORED_TABLES.has(table)) continue;
	const my = mysql.get(table);
	const dmCols = dm.get(table);
	if (!my) problems.push(`表 ${table}:MySQL 建表脚本里没有这张表`);
	if (!dmCols) problems.push(`表 ${table}:达梦建表脚本里没有这张表`);
	if (my) {
		const missing = [...columns].filter((c) => !my.has(c));
		const extra = [...my].filter((c) => !columns.has(c));
		if (missing.length) problems.push(`表 ${table}(MySQL):schema 有、DDL 没有 → ${missing.join(", ")}`);
		if (extra.length) problems.push(`表 ${table}(MySQL):DDL 有、schema 没有 → ${extra.join(", ")}`);
	}
	if (dmCols) {
		const missing = [...columns].filter((c) => !dmCols.has(c));
		const extra = [...dmCols].filter((c) => !columns.has(c));
		if (missing.length) problems.push(`表 ${table}(达梦):schema 有、DDL 没有 → ${missing.join(", ")}`);
		if (extra.length) problems.push(`表 ${table}(达梦):DDL 有、schema 没有 → ${extra.join(", ")}`);
	}
	const metaCols = meta.get(table);
	if (!metaCols) {
		problems.push(`表 ${table}:没有列注释(元数据脚本里没登记)`);
		continue;
	}
	// 注释里有、表里没有的列 = 列已经删了但注释没清
	const stale = [...metaCols].filter((c) => !columns.has(c));
	if (stale.length) problems.push(`表 ${table}:列注释里还有已删列 → ${stale.join(", ")}`);
	const noComment = [...columns].filter((c) => !metaCols.has(c));
	if (noComment.length) problems.push(`表 ${table}:这些列没有注释 → ${noComment.join(", ")}`);
}

for (const [table] of mysql) {
	if (IGNORED_TABLES.has(table)) continue;
	if (!schema.has(table)) problems.push(`表 ${table}:建表脚本里有、schema 里没有`);
}

if (problems.length) {
	console.log("\n── 漂移(要修)──");
	for (const problem of problems) console.log(`✗ ${problem}`);
	console.log(`\n共 ${problems.length} 处。改形状时记得同步这四处:`);
	console.log("  src/db/data-base-schema.ts · scripts/create-system-tables.ts ·");
	console.log("  scripts/create-better-auth-tables-dm.ts · scripts/sync-table-meta.ts");
	process.exit(1);
}
console.log(
	`\n✓ 表结构一致:${schema.size} 张表 / ${[...schema.values()].reduce((n, c) => n + c.size, 0)} 列,四处对齐。`,
);
