/**
 * **系统设置相关表的建表脚本** —— 幂等,可重复执行。
 *
 * 为什么需要它:`src/db/data-base-schema.ts` 里写着「DDL 由建表脚本维护」,但仓库里
 * 一直没有这个脚本(旧注释指向的 `doc/表结构设计.sql` 已经归档),于是 `sys_tag` 从来没在库里建起来 ——
 * 「标签管理」页一打开就报错,而代码侧看着一切正常。本脚本补上这一环。
 *
 * 口径:
 *  - **只 `create table if not exists`**:已存在的表一个字节都不动,不会丢数据;
 *  - 建完表会调 `syncTableMeta()`:把**列注释与索引名**对齐到最新口径(见 `sync-table-meta.ts`)——
 *    表名/列名改过之后,注释和索引名不会自动跟着变,那是最容易误导人的残留;
 *  - 表结构必须与 `src/db/data-base-schema.ts` **逐列对齐**(改了那边记得回来改这里,
 *    并在开头补一条 ALTER,给已经建过表的环境用);
 *  - 表名/列名以**最新 DDL** 为准:`sys_para`(旧 `sys_config`,列 `para_key` / `para_value` / `para_type`);
 *  - 不 drop、不 truncate、不 seed —— 灌种子走 `pnpm db:seed:menus` / `db:seed:dicts` /
 *    `db:seed:paras` / `db:seed:tags`。
 *
 * 用法:`pnpm db:create`
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { syncTableMeta } from "./sync-table-meta.ts";

const TABLES: Array<{ name: string; ddl: string }> = [
	{
		name: "sys_menu",
		ddl: `create table if not exists \`sys_menu\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`parent_id\` varchar(32) collate utf8mb4_unicode_ci default null comment '父菜单 id(nanoid);null = 一级菜单',
			\`name\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`path\` varchar(128) collate utf8mb4_unicode_ci not null comment '业务键:页面路由(not null + 唯一)',
			\`icon\` varchar(32) collate utf8mb4_unicode_ci default null,
			\`sort\` int not null default 0,
			\`visible\` tinyint(1) not null default 1,
			\`status\` tinyint not null default 1 comment '1 启用 / 0 停用',
			\`create_time\` datetime(3) not null default current_timestamp(3),
			\`update_time\` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
			primary key (\`id\`),
			unique key \`uk_sys_menu_path\` (\`path\`),
			key \`idx_sys_menu_parent\` (\`parent_id\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '菜单'`,
	},
	{
		name: "sys_dict",
		ddl: `create table if not exists \`sys_dict\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`code\` varchar(64) collate utf8mb4_unicode_ci not null comment '字典编码(业务键),如 entity_category',
			\`name\` varchar(32) collate utf8mb4_unicode_ci not null comment '字典名称(中文)',
			\`items\` json default null comment '字典项:[{label,value}]',
			\`remark\` varchar(255) character set utf8mb4 collate utf8mb4_unicode_ci default null comment '说明',
			\`status\` tinyint not null default 1 comment '1 启用 / 0 停用',
			\`create_time\` datetime default current_timestamp,
			\`update_time\` datetime default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_dict_code\` (\`code\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '系统字典(全系统共用)'`,
	},
	{
		name: "sys_para",
		ddl: `create table if not exists \`sys_para\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`para_key\` varchar(64) collate utf8mb4_unicode_ci not null comment '参数名,如 raw.retention.soft_days',
			\`para_value\` text collate utf8mb4_unicode_ci not null,
			\`para_type\` tinyint not null comment '1:int 2:bool 3:string 4:json',
			\`para_group\` varchar(32) collate utf8mb4_unicode_ci default null comment '分组',
			\`status\` tinyint not null default 1 comment '1 启用 / 0 停用',
			\`remark\` varchar(255) collate utf8mb4_unicode_ci default null comment '给人看的说明(界面直接展示)',
			\`editable\` tinyint not null default 1 comment '0 = 代码内置不允许改',
			\`create_time\` datetime default current_timestamp,
			\`update_time\` datetime default current_timestamp on update current_timestamp,
			primary key (\`para_key\`),
			key \`idx_para_group\` (\`para_group\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '系统参数(系统设置 ▸ 参数管理)'`,
	},
	{
		name: "sys_tag",
		ddl: `create table if not exists \`sys_tag\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`parent_id\` varchar(32) collate utf8mb4_unicode_ci default null comment '父节点 id(nanoid);null = 维度(一级节点)',
			\`label\` varchar(32) collate utf8mb4_unicode_ci not null comment '展示名(维度名 / 标签名)',
			\`value\` varchar(32) collate utf8mb4_unicode_ci default null comment '取值(可空)',
			\`desc\` text collate utf8mb4_unicode_ci default null comment '含义说明',
			\`sort\` int not null default 0 comment '同级排序,越小越靠前',
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			key \`idx_sys_tag_parent\` (\`parent_id\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '标签体系(维度 → 标签 两级)'`,
	},
	{
		name: "sys_tag_relation",
		ddl: `create table if not exists \`sys_tag_relation\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`tag_id\` varchar(32) collate utf8mb4_unicode_ci not null comment '标签 id → sys_tag.id(叶子标签)',
			\`obj_id\` varchar(32) collate utf8mb4_unicode_ci not null comment '业务对象主键',
			\`obj_type\` tinyint not null comment '业务对象类型(tinyint 码,各业务自己约定)',
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_tag_rel_unique\` (\`tag_id\`, \`obj_type\`, \`obj_id\`),
			key \`idx_tag_rel_tag\` (\`tag_id\`),
			key \`idx_tag_rel_obj\` (\`obj_type\`, \`obj_id\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '标签与业务对象的关联(多态多对多)'`,
	},
];

const before = new Set(
	((await db.execute(sql`show tables`))[0] as unknown as Array<Record<string, unknown>>).map((row) =>
		String(Object.values(row)[0]),
	),
);

for (const table of TABLES) {
	await db.execute(sql.raw(table.ddl));
	const created = !before.has(table.name);
	console.log(`${created ? "✓ 新建" : "· 已存在"} ${table.name}`);
}

// 建完表再对齐一次列注释 / 索引名:老库通常是在更早的 DDL 下建的,注释里会留着旧列名
await syncTableMeta();

const after = ((await db.execute(sql`show tables`))[0] as unknown as Array<Record<string, unknown>>).map((row) =>
	String(Object.values(row)[0]),
);
console.log(`\n库里现有表:${after.sort().join(", ")}`);
console.log("提示:建好后灌种子 —— `pnpm db:seed:menus` / `db:seed:dicts` / `db:seed:paras` / `db:seed:tags`。");
process.exit(0);
