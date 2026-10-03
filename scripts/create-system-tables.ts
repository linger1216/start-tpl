/**
 * **系统表的建表脚本**(设置五张 + 认证四张 + 权限四张 + 数据权限两张 + `sys_file` / `sys_log` /
 * `sys_notice` + `demo_grid` = 19 张)—— 幂等,可重复执行。
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

/**
 * 列注释**不写在这里**:唯一真源是 `scripts/sync-table-meta.ts` 的 `COLUMN_COMMENTS`。
 * 建表末尾会调 `syncTableMeta()` 把库里的列注释对齐过去 —— 两边都写必然漂移、而且没人会发现。
 * 下面这些 CREATE 以及后面的补列 / 改列型定义,都只写结构、不带列注释。
 */
const TABLES: Array<{ name: string; ddl: string }> = [
	{
		name: "sys_menu",
		ddl: `create table if not exists \`sys_menu\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`parent_id\` varchar(32) collate utf8mb4_unicode_ci default null,
			\`name\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`path\` varchar(128) collate utf8mb4_unicode_ci not null,
			\`icon\` varchar(32) collate utf8mb4_unicode_ci default null,
			\`sort\` int not null default 0,
			\`visible\` tinyint(1) not null default 1,
			\`status\` tinyint not null default 1,
			\`create_time\` datetime(3) not null default current_timestamp(3),
			\`update_time\` datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
			primary key (\`id\`),
			unique key \`uk_sys_menu_path\` (\`path\`),
			key \`idx_sys_menu_parent_sort\` (\`parent_id\`, \`sort\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '菜单'`,
	},
	{
		name: "sys_dict",
		ddl: `create table if not exists \`sys_dict\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`code\` varchar(64) collate utf8mb4_unicode_ci not null,
			\`name\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`items\` json default null,
			\`remark\` varchar(255) character set utf8mb4 collate utf8mb4_unicode_ci default null,
			\`status\` tinyint not null default 1,
			\`create_time\` datetime default current_timestamp,
			\`update_time\` datetime default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_dict_code\` (\`code\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '系统字典(全系统共用)'`,
	},
	{
		name: "sys_para",
		ddl: `create table if not exists \`sys_para\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`para_key\` varchar(64) collate utf8mb4_unicode_ci not null,
			\`para_value\` text collate utf8mb4_unicode_ci not null,
			\`para_type\` tinyint not null,
			\`para_group\` varchar(32) collate utf8mb4_unicode_ci default null,
			\`status\` tinyint not null default 1,
			\`remark\` varchar(255) collate utf8mb4_unicode_ci default null,
			\`editable\` tinyint not null default 1,
			\`create_time\` datetime default current_timestamp,
			\`update_time\` datetime default current_timestamp on update current_timestamp,
			primary key (\`para_key\`),
			key \`idx_para_group\` (\`para_group\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '系统参数(系统设置 ▸ 参数管理)'`,
	},
	{
		name: "sys_tag",
		ddl: `create table if not exists \`sys_tag\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`parent_id\` varchar(32) collate utf8mb4_unicode_ci default null,
			\`label\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`value\` varchar(32) collate utf8mb4_unicode_ci default null,
			\`desc\` text collate utf8mb4_unicode_ci default null,
			\`sort\` int not null default 0,
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			key \`idx_sys_tag_parent_sort\` (\`parent_id\`, \`sort\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '标签体系(维度 → 标签 两级)'`,
	},
	{
		name: "sys_tag_relation",
		ddl: `create table if not exists \`sys_tag_relation\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`tag_id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`obj_id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`obj_type\` tinyint not null,
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_tag_rel_unique\` (\`tag_id\`, \`obj_type\`, \`obj_id\`),
			key \`idx_tag_rel_tag\` (\`tag_id\`),
			key \`idx_tag_rel_obj\` (\`obj_type\`, \`obj_id\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '标签与业务对象的关联(多态多对多)'`,
	},
	// ── 认证四表(Better Auth 内核;「形状」见 src/db/data-base-schema.ts)────────────
	// auth 是系统内部服务,所以和上面一样吃 sys_ 前缀、同样由本脚本维护(不进 drizzle 迁移)。
	// ⚠️ 前缀去掉之后 better-auth 就找不到模型了 —— 它按 `src/lib/auth.ts` 传进去的**键名**找表。
	{
		name: "sys_user",
		ddl: `create table if not exists \`sys_user\` (
			\`id\` varchar(36) not null,
			\`name\` varchar(128) not null,
			\`email\` varchar(255) not null,
			\`email_verified\` tinyint(1) not null default 0,
			\`image\` varchar(512) default null,
			\`created_at\` timestamp not null default current_timestamp,
			\`updated_at\` timestamp not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_user_email\` (\`email\`)
		)`,
	},
	{
		name: "sys_session",
		ddl: `create table if not exists \`sys_session\` (
			\`id\` varchar(36) not null,
			\`expires_at\` timestamp not null,
			\`token\` varchar(255) not null,
			\`ip_address\` text,
			\`user_agent\` text,
			\`user_id\` varchar(36) not null,
			\`created_at\` timestamp not null default current_timestamp,
			\`updated_at\` timestamp not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_session_token\` (\`token\`),
			key \`idx_sys_session_user\` (\`user_id\`),
			constraint \`fk_sys_session_user\` foreign key (\`user_id\`) references \`sys_user\` (\`id\`) on delete cascade
		)`,
	},
	{
		name: "sys_account",
		ddl: `create table if not exists \`sys_account\` (
			\`id\` varchar(36) not null,
			\`account_id\` varchar(255) not null,
			\`provider_id\` varchar(64) not null,
			\`user_id\` varchar(36) not null,
			\`access_token\` text,
			\`refresh_token\` text,
			\`id_token\` text,
			\`access_token_expires_at\` timestamp null default null,
			\`refresh_token_expires_at\` timestamp null default null,
			\`scope\` varchar(255) default null,
			\`password\` text,
			\`created_at\` timestamp not null default current_timestamp,
			\`updated_at\` timestamp not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_account_provider\` (\`provider_id\`, \`account_id\`),
			key \`idx_sys_account_user\` (\`user_id\`),
			constraint \`fk_sys_account_user\` foreign key (\`user_id\`) references \`sys_user\` (\`id\`) on delete cascade
		)`,
	},
	{
		name: "sys_verification",
		ddl: `create table if not exists \`sys_verification\` (
			\`id\` varchar(36) not null,
			\`identifier\` varchar(255) not null,
			\`value\` text not null,
			\`expires_at\` timestamp not null,
			\`created_at\` timestamp not null default current_timestamp,
			\`updated_at\` timestamp not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			key \`idx_sys_verification_identifier\` (\`identifier\`)
		)`,
	},
	// ── 权限四表(部门 / 角色;形状与理由见 src/db/data-base-schema.ts)──────────
	{
		name: "sys_dept",
		ddl: `create table if not exists \`sys_dept\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`parent_id\` varchar(32) collate utf8mb4_unicode_ci default null,
			\`name\` varchar(64) collate utf8mb4_unicode_ci not null,
			\`sort\` int not null default 0,
			\`status\` tinyint not null default 1,
			\`remark\` varchar(255) collate utf8mb4_unicode_ci default null,
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			key \`idx_sys_department_parent_sort\` (\`parent_id\`, \`sort\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '部门树'`,
	},
	{
		name: "sys_role",
		ddl: `create table if not exists \`sys_role\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`name\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`sort\` int not null default 0,
			\`status\` tinyint not null default 1,
			\`remark\` varchar(255) collate utf8mb4_unicode_ci default null,
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_role_name\` (\`name\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '角色(全局定义;谁有哪些角色见 sys_casbin_rule 的 g 行)'`,
	},
	{
		name: "sys_user_dept",
		ddl: `create table if not exists \`sys_user_dept\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`department_id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`user_id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_dm_unique\` (\`department_id\`, \`user_id\`),
			key \`idx_sys_dm_user\` (\`user_id\`),
			constraint \`fk_sys_dm_department\` foreign key (\`department_id\`) references \`sys_dept\` (\`id\`) on delete cascade,
			constraint \`fk_sys_dm_user\` foreign key (\`user_id\`) references \`sys_user\` (\`id\`) on delete cascade
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '部门成员(谁在哪个部门;角色是全局的,见 sys_casbin_rule 的 g 行)'`,
	},
	{
		name: "sys_casbin_rule",
		ddl: `create table if not exists \`sys_casbin_rule\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null,
			\`ptype\` varchar(8) collate utf8mb4_unicode_ci not null,
			\`v0\` varchar(80) collate utf8mb4_unicode_ci not null,
			\`v1\` varchar(128) collate utf8mb4_unicode_ci not null,
			\`v2\` varchar(16) collate utf8mb4_unicode_ci not null default '',
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_casbin_rule\` (\`ptype\`, \`v0\`, \`v1\`, \`v2\`),
			key \`idx_sys_casbin_rule_v0\` (\`ptype\`, \`v0\`),
			key \`idx_sys_casbin_rule_v1\` (\`ptype\`, \`v1\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '功能权限策略(Casbin;判定与存储同一处,见 src/lib/casbin.ts)'`,
	},
	/** 文件元数据(字节存 MinIO;见 doc/文件管理.md) */
	{
		name: "sys_file",
		ddl: `create table if not exists \`sys_file\` (
      \`id\` varchar(32) collate utf8mb4_unicode_ci not null,
      \`bucket\` varchar(64) collate utf8mb4_unicode_ci not null,
      \`object_key\` varchar(512) collate utf8mb4_unicode_ci not null,
      \`origin_name\` varchar(255) collate utf8mb4_unicode_ci not null,
      \`ext\` varchar(16) collate utf8mb4_unicode_ci default null,
      \`content_type\` varchar(128) collate utf8mb4_unicode_ci default null,
      \`size\` bigint not null default 0,
      \`hash\` char(64) collate utf8mb4_unicode_ci default null,
      \`status\` tinyint not null default 0,
      \`create_time\` datetime not null default current_timestamp,
      \`update_time\` datetime not null default current_timestamp on update current_timestamp,
      primary key (\`id\`),
      unique key \`uk_sys_file_object\` (\`bucket\`, \`object_key\`),
      key \`idx_sys_file_status\` (\`status\`, \`create_time\`),
      key \`idx_sys_file_hash\` (\`hash\`)
    ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '文件元数据(字节存 MinIO,见 doc/文件管理.md)'`,
	},
	/** 审计日志(谁在什么时候对什么做了什么;只增不改,见 doc/审计日志.md) */
	{
		name: "sys_log",
		ddl: `create table if not exists \`sys_log\` (
    \`id\` varchar(32) collate utf8mb4_unicode_ci not null,
    \`trace_id\` varchar(32) collate utf8mb4_unicode_ci default null,
    \`path\` varchar(64) collate utf8mb4_unicode_ci not null,
    \`label\` varchar(64) collate utf8mb4_unicode_ci default null,
    \`type\` varchar(16) collate utf8mb4_unicode_ci default null,
    \`operator_id\` varchar(32) collate utf8mb4_unicode_ci default null,
    \`operator_name\` varchar(64) collate utf8mb4_unicode_ci default null,
    \`ip\` varchar(64) collate utf8mb4_unicode_ci default null,
    \`target\` varchar(255) collate utf8mb4_unicode_ci default null,
    \`status\` tinyint not null default 1,
    \`error_code\` varchar(48) collate utf8mb4_unicode_ci default null,
    \`error_message\` varchar(255) collate utf8mb4_unicode_ci default null,
    \`input\` text,
    \`duration_ms\` int default null,
    \`create_time\` datetime not null default current_timestamp,
    primary key (\`id\`),
    key \`idx_sys_log_time\` (\`create_time\`),
    key \`idx_sys_log_operator\` (\`operator_id\`, \`create_time\`),
    key \`idx_sys_log_path\` (\`path\`, \`create_time\`)
  ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '审计日志(只增不改;见 doc/审计日志.md)'`,
	},
	/** 站内通知(一条通知一个收件人;已读 = read_at,见 doc/通知中心.md) */
	{
		name: "sys_notice",
		ddl: `create table if not exists \`sys_notice\` (
    \`id\` varchar(32) collate utf8mb4_unicode_ci not null,
    \`user_id\` varchar(32) collate utf8mb4_unicode_ci not null,
    \`title\` varchar(128) collate utf8mb4_unicode_ci not null,
    \`body\` varchar(255) collate utf8mb4_unicode_ci default null,
    \`path\` varchar(255) collate utf8mb4_unicode_ci default null,
    \`level\` varchar(16) collate utf8mb4_unicode_ci not null default 'info',
    \`read_at\` datetime default null,
    \`create_time\` datetime not null default current_timestamp,
    primary key (\`id\`),
    key \`idx_sys_notice_user\` (\`user_id\`, \`read_at\`, \`create_time\`)
  ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '站内通知(一条一个收件人,见 doc/通知中心.md)'`,
	},
	/** Demo:综合网格履职(见 doc/测试数据/README.md) */
	{
		name: "demo_grid",
		ddl: `create table if not exists \`demo_grid\` (
    \`id\` varchar(32) collate utf8mb4_unicode_ci not null,
    \`name\` varchar(64) collate utf8mb4_unicode_ci not null,
    \`town_name\` varchar(32) collate utf8mb4_unicode_ci default null,
    \`town_id\` varchar(32) collate utf8mb4_unicode_ci default null,
    \`owner_name\` varchar(32) collate utf8mb4_unicode_ci default null,
    \`owner_id\` varchar(32) collate utf8mb4_unicode_ci default null,
    \`duty\` varchar(64) collate utf8mb4_unicode_ci default null,
    \`remark\` varchar(255) collate utf8mb4_unicode_ci default null,
    \`create_time\` datetime not null default current_timestamp,
    \`update_time\` datetime not null default current_timestamp on update current_timestamp,
    primary key (\`id\`),
    key \`idx_demo_grid_town\` (\`town_id\`),
    key \`idx_demo_grid_owner\` (\`owner_id\`)
  ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = 'Demo:综合网格履职'`,
	},
	/**
	 * 数据权限:**规则**(谁看得到哪些行,见 `src/lib/data-scope.ts`)。
	 *
	 * 合法形状只有三种(`lib/data-scope-spec.ts` 的 `validatePolicyCombo()` 是唯一实现):
	 *  - `column` / `plugin_key` 都不填 = 整类可见;
	 *  - `column` + `plugin_key`(插件填了域 = 「给值」)= `<column> in 插件(我)`;
	 *  - `plugin_key`(插件填了资源表 = 「给行」,不填 column)= `<主键> in 插件(我, 资源)`。
	 *
	 * m23422 起插件那句读作 `<column> in 插件(我).value_key` —— 规则多一列 `value_key`,
	 * 说"从插件输出的每行里取哪个 key 的值";留空 = 老规则,按 `<column>` 推断。
	 */
	{
		name: "sys_data_policy",
		ddl: `create table if not exists \`sys_data_policy\` (
    \`id\` varchar(32) collate utf8mb4_unicode_ci not null,
    \`status\` tinyint not null default 1,
    \`subject\` varchar(48) collate utf8mb4_unicode_ci not null,
    \`resource\` varchar(64) collate utf8mb4_unicode_ci not null,
    \`column\` varchar(64) collate utf8mb4_unicode_ci default null,
    \`value_key\` varchar(64) collate utf8mb4_unicode_ci default null,
    \`plugin_key\` varchar(64) collate utf8mb4_unicode_ci default null,
    \`remark\` varchar(255) collate utf8mb4_unicode_ci default null,
    \`create_time\` datetime not null default current_timestamp,
    \`update_time\` datetime not null default current_timestamp on update current_timestamp,
    primary key (\`id\`),
    key \`idx_sys_data_policy_resource\` (\`resource\`, \`status\`)
  ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '数据权限规则(谁看得到哪些行,见 src/lib/data-scope.ts)'`,
	},
	/**
	 * 数据权限:**值域插件登记**(见 `src/lib/data-scope-plugins.ts`)。
	 *
	 * **v2(m20034)起**:这张表登记的**只能是「指定清单」(fixed)类**插件。
	 * 用户在表单里**逐行手填** `[{key, value}]`,存进 `output_values` json 列;
	 * 函数体(`fn` / `code`)已删——那是地基内置插件的事,在 `lib/data-scope-plugins.ts` 的代码里:
	 * `self` / `my_departments` / `my_dept_ancestors` / `my_street` 四个。
	 * 引擎按 `output_values` 拼 SQL 的 `in (...)`,再丢到规则的 `column` 列上去比
	 * —— 「值」是**插件的属性**,不是规则的属性。
	 */
	{
		name: "sys_data_plugin",
		ddl: `create table if not exists \`sys_data_plugin\` (
    \`id\` varchar(32) collate utf8mb4_unicode_ci not null,
    \`plugin_key\` varchar(64) collate utf8mb4_unicode_ci not null,
    \`label\` varchar(64) collate utf8mb4_unicode_ci not null,
    \`output_values\` json default null,
    \`status\` tinyint not null default 1,
    \`remark\` varchar(255) collate utf8mb4_unicode_ci default null,
    \`create_time\` datetime not null default current_timestamp,
    \`update_time\` datetime not null default current_timestamp on update current_timestamp,
    primary key (\`id\`),
    unique key \`uk_sys_data_plugin_key\` (\`plugin_key\`)
  ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '数据权限值域插件登记(v2 起:只能登记指定清单(由用户编辑 output_values);函数体走内置,见 src/lib/data-scope-plugins.ts)'`,
	},
];

/**
 * **老库改表名** —— 必须跑在**建表之前**,否则必然失效:
 * `create table if not exists` 会先把**新名字**那张空表建出来,接着改名就会看到「新旧两张表同时存在」
 * 而不敢合并 —— 数据留在旧表里、新表空着,而且**每次执行都重复这一幕**。
 * 先改名再建表:老库把旧表搬成新名(`rename table`,数据原样保留),随后建表只是"已存在"。
 *
 * `create table if not exists` 只认新名字,**老库里还叫旧名的表它管不着**,所以才需要这张登记表。
 * 幂等(旧名不在 → 跳过;新旧同时存在 → 跳过并要求人工确认,不自动合并)。
 */
const TABLE_RENAMES: Array<{ from: string; to: string }> = [
	{ from: "sys_department", to: "sys_dept" },
	{ from: "sys_department_member", to: "sys_user_dept" },
	// 功能权限策略表改名:补上 `sys_` 前缀 —— 这个前缀在本仓库就是「系统表、不进 drizzle 迁移」的标记,
	// 它是唯一一张漏了的。Casbin 官方 SQL adapter 习惯叫 `casbin_rule`,但我们用的是自写 adapter
	// (见 `lib/casbin.ts`),那条惯例换不来任何东西。
	{ from: "casbin_rule", to: "sys_casbin_rule" },
];

for (const rename of TABLE_RENAMES) {
	const present = (
		await db.execute(sql`select table_name as name from information_schema.tables where table_schema = database()`)
	)[0] as unknown as Array<{ name: string }>;
	const names = new Set(present.map((row) => row.name));
	if (!names.has(rename.from)) {
		console.log(`· ${rename.from} 不存在(已是新名或新库),跳过`);
		continue;
	}
	if (names.has(rename.to)) {
		console.log(`· ${rename.from} 与 ${rename.to} 同时存在 —— 不自动合并,请人工确认后处理`);
		continue;
	}
	await db.execute(sql.raw(`rename table \`${rename.from}\` to \`${rename.to}\``));
	console.log(`✓ 表改名 ${rename.from} → ${rename.to}`);
}

// 快照取在改名**之后** —— 否则刚搬过去的表会被报成「✓ 新建」(它此前的名字不在这份名单里)。
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

/**
 * **老库补列** —— `create table if not exists` **不会**给已存在的表加列。
 * 往 `data-base-schema.ts` 加列之后,必须在这里登记一条,老库(以及已经有了 sys_session 的环境)才能跟上。
 * 幂等:列已存在就跳过。
 */
const COLUMN_UPGRADES: Array<{ table: string; column: string; ddl: string }> = [
	{
		table: "sys_menu",
		column: "type",
		ddl: "tinyint not null default 2",
	},
	{
		table: "sys_menu",
		column: "perm",
		ddl: "varchar(64) collate utf8mb4_unicode_ci default null",
	},
	// 数据权限 v2 (m20034):「输出值」搬到 plugin.output_values(原 plugin.fn / rule.params 已删)
	{
		table: "sys_data_plugin",
		column: "output_values",
		ddl: "json default null",
	},
	// 数据权限 m23422:规则多一列「从插件输出行里取哪个 key」
	{
		table: "sys_data_policy",
		column: "value_key",
		ddl: "varchar(64) collate utf8mb4_unicode_ci default null",
	},
];

for (const upgrade of COLUMN_UPGRADES) {
	const cols = (
		await db.execute(
			sql`select column_name as name from information_schema.columns where table_schema = database() and table_name = ${upgrade.table}`,
		)
	)[0] as unknown as Array<{ name: string }>;
	if (cols.some((row) => row.name === upgrade.column)) {
		console.log(`· ${upgrade.table}.${upgrade.column} 已存在,跳过`);
		continue;
	}
	await db.execute(sql.raw(`alter table \`${upgrade.table}\` add column \`${upgrade.column}\` ${upgrade.ddl}`));
	console.log(`✓ ${upgrade.table} 补列 ${upgrade.column}`);
}

/**
 * **老库改列型** —— `create table if not exists` 既不加列、也**不会**改已存在列的型。
 *
 * 与 `COLUMN_UPGRADES` 的分工:那个补**新列**,这个修**旧列的型**。什么时候需要:
 * 库里的型与 `data-base-schema.ts` / 上面的 DDL 对不上 —— 最典型的是 `sys_dict.items`:
 * 老库里是 `text`,而 schema 声明 `json(...)`。MySQL 驱动**只对真正的 json 列**做解析,
 * 声明成 `json()` 却落在 `text` 列上,读出来是**字符串**而不是数组 —— `items.length` 成了字符个数,
 * 字典下拉会在运行时炸(测试里表现为 `actual: 53, expected: 2`)。
 *
 * 幂等:`data_type` 已是目标型就跳过。注意改型前库里必须都是合法 JSON,否则 MySQL 会拒绝。
 */
const COLUMN_TYPE_FIXES: Array<{ table: string; column: string; type: string; ddl: string }> = [
	{
		table: "sys_dict",
		column: "items",
		type: "json",
		ddl: "json default null",
	},
];

for (const fix of COLUMN_TYPE_FIXES) {
	const cols = (
		await db.execute(
			sql`select data_type as type from information_schema.columns
				where table_schema = database() and table_name = ${fix.table} and column_name = ${fix.column}`,
		)
	)[0] as unknown as Array<{ type: string }>;
	const current = cols[0]?.type;
	if (current === undefined) {
		console.log(`· ${fix.table}.${fix.column} 不存在,跳过`);
		continue;
	}
	if (current === fix.type) {
		console.log(`· ${fix.table}.${fix.column} 已是 ${fix.type},跳过`);
		continue;
	}
	await db.execute(sql.raw(`alter table \`${fix.table}\` modify column \`${fix.column}\` ${fix.ddl}`));
	console.log(`✓ ${fix.table}.${fix.column} 列型 ${current} → ${fix.type}`);
}

/**
 * **老库改列名** —— 字段被重命名时在这里登记一条。
 *
 * `column_rename` 用的也是 `ALTER TABLE ... CHANGE` 语法,MySQL 上它既能改列名、也能
 * 顺手改型 —— 数据原样保留(`new_type` 兼容时才安全,`TEXT` ↔ `TEXT` 没问题)。
 *
 * 幂等:`from` 列不在 + `to` 列已在 ⇒ 跳过(已经改过了)。
 */
const COLUMN_RENAMES: Array<{
	table: string;
	from: string;
	to: string;
	newType: string;
}> = [
	// 数据权限 v1.3 (m18228):`code` → `fn`(user:字段名是函数体,叫 fn 更贴切)
	{
		table: "sys_data_plugin",
		from: "code",
		to: "fn",
		newType: "text",
	},
];

for (const ren of COLUMN_RENAMES) {
	const cols = (
		await db.execute(
			sql`select column_name as name from information_schema.columns
				where table_schema = database() and table_name = ${ren.table}`,
		)
	)[0] as unknown as Array<{ name: string }>;
	const names = new Set(cols.map((c) => c.name));
	if (names.has(ren.to) && !names.has(ren.from)) {
		console.log(`· ${ren.table}.${ren.from} → ${ren.to} 已改过,跳过`);
		continue;
	}
	if (!names.has(ren.from)) {
		console.log(`· ${ren.table}.${ren.from} 不存在(可能新表),跳过`);
		continue;
	}
	if (names.has(ren.from) && names.has(ren.to)) {
		console.log(`· ${ren.table} 同时存在 ${ren.from} 和 ${ren.to},人工处理`);
		continue;
	}
	await db.execute(sql.raw(`alter table \`${ren.table}\` change column \`${ren.from}\` \`${ren.to}\` ${ren.newType}`));
	console.log(`✓ ${ren.table}.${ren.from} → ${ren.to}`);
}

/**
 * **老库删列** —— 列被合并 / 废弃时要在这里登记一条。不登记的话老库里那列会一直留着:
 * 它多半是 `not null` 而新代码不再写它,**下一次插入就会违反非空约束**(静默失败最烦人)。
 * 幂等:列不存在就跳过。MySQL 上一列若还挂在某个外键下,必须先删外键再删列。
 *
 * `rename`(从 `code` → `fn`)不在这里 —— 字段重命名归「老库改列名」管,
 * 见上面 `COLUMN_RENAMES` 那一段。`COLUMN_DROPS` 只管**真删**。
 */
const COLUMN_DROPS: Array<{ table: string; column: string; constraint?: string }> = [
	{ table: "sys_user_dept", column: "role_id", constraint: "fk_sys_dm_role" },
	// 数据权限 v1.1:「给值 / 给行」不再是字段,改由 `domain` / `resource` 推导(`data-scope-spec.ts` 的 `producesOf()`)
	{ table: "sys_data_plugin", column: "produces" },
	// 数据权限 v1.2:插件只剩「一段函数体」一档,`declared`(登记取数)整档删掉 —— 这两列随之废弃
	{ table: "sys_data_plugin", column: "impl_kind" },
	{ table: "sys_data_plugin", column: "decl" },
	// 数据权限 v1.3 (m18228):user 明确「插件不需要域概念」 —— domain / resource 全砍;code → fn
	{ table: "sys_data_plugin", column: "domain" },
	{ table: "sys_data_plugin", column: "resource" },
	// 数据权限 v2 (m20034):user 明确「新建插件只允许指定清单(fixed)类」 —— 函数体那段(fn)不进库;
	// 「输出值」搬到 plugin.output_values,规则行的 params 删(规则不再带参数)。
	{ table: "sys_data_plugin", column: "fn" },
	{ table: "sys_data_policy", column: "params" },
];

for (const drop of COLUMN_DROPS) {
	const cols = (
		await db.execute(
			sql`select column_name as name from information_schema.columns where table_schema = database() and table_name = ${drop.table}`,
		)
	)[0] as unknown as Array<{ name: string }>;
	if (!cols.some((row) => row.name === drop.column)) {
		console.log(`· ${drop.table}.${drop.column} 不存在,跳过`);
		continue;
	}
	if (drop.constraint) {
		const fks = (
			await db.execute(
				sql`select constraint_name as name from information_schema.table_constraints
					where table_schema = database() and table_name = ${drop.table} and constraint_type = 'FOREIGN KEY'`,
			)
		)[0] as unknown as Array<{ name: string }>;
		if (fks.some((row) => row.name === drop.constraint)) {
			await db.execute(sql.raw(`alter table \`${drop.table}\` drop foreign key \`${drop.constraint}\``));
			console.log(`· ${drop.table} 先删外键 ${drop.constraint}`);
		}
	}
	await db.execute(sql.raw(`alter table \`${drop.table}\` drop column \`${drop.column}\``));
	console.log(`✓ ${drop.table} 删列 ${drop.column}`);
}

/**
 * 真删索引 —— 和列一起在 demo_grid 上撤掉的 `idx_demo_grid_group`(m24215:不再限制 demo_grid)。
 * 幂等:索引不存在就跳过。
 */
const INDEX_DROPS: Array<{ table: string; index: string }> = [
	// demo_grid 去 group_id 时连带的(`sys_data_policy` 已经拿不到这列当判据)
	{ table: "demo_grid", index: "idx_demo_grid_group" },
];

for (const drop of INDEX_DROPS) {
	const idxs = (
		await db.execute(
			sql`select index_name as name from information_schema.statistics where table_schema = database() and table_name = ${drop.table}`,
		)
	)[0] as unknown as Array<{ name: string }>;
	if (!idxs.some((row) => row.name === drop.index)) {
		console.log(`· ${drop.table}.${drop.index} 不存在,跳过`);
		continue;
	}
	await db.execute(sql.raw(`alter table \`${drop.table}\` drop index \`${drop.index}\``));
	console.log(`✓ ${drop.table} 删索引 ${drop.index}`);
}

// 建完表再对齐一次列注释 / 索引名:老库通常是在更早的 DDL 下建的,注释里会留着旧列名
await syncTableMeta();

const after = ((await db.execute(sql`show tables`))[0] as unknown as Array<Record<string, unknown>>).map((row) =>
	String(Object.values(row)[0]),
);
console.log(`\n库里现有表:${after.sort().join(", ")}`);
console.log("提示:建好后灌种子 —— `pnpm db:seed:menus` / `db:seed:dicts` / `db:seed:paras` / `db:seed:tags`。");
process.exit(0);
