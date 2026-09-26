/**
 * **系统表的建表脚本**(系统设置五张 + 认证四张)—— 幂等,可重复执行。
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
			key \`idx_sys_menu_parent_sort\` (\`parent_id\`, \`sort\`)
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
			key \`idx_sys_tag_parent_sort\` (\`parent_id\`, \`sort\`)
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
	// ── 认证四表(Better Auth 内核;「形状」见 src/db/data-base-schema.ts)────────────
	// auth 是系统内部服务,所以和上面一样吃 sys_ 前缀、同样由本脚本维护(不进 drizzle 迁移)。
	// ⚠️ 前缀去掉之后 better-auth 就找不到模型了 —— 它按 `src/lib/auth.ts` 传进去的**键名**找表。
	{
		name: "sys_user",
		ddl: `create table if not exists \`sys_user\` (
			\`id\` varchar(36) not null comment '主键(better-auth 生成)',
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
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`parent_id\` varchar(32) collate utf8mb4_unicode_ci default null comment '上级部门 id;null = 顶级',
			\`name\` varchar(64) collate utf8mb4_unicode_ci not null comment '部门名',
			\`sort\` int not null default 0 comment '同级排序,越小越靠前',
			\`status\` tinyint not null default 1 comment '1 启用 / 0 停用',
			\`remark\` varchar(255) collate utf8mb4_unicode_ci default null comment '备注',
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			key \`idx_sys_department_parent_sort\` (\`parent_id\`, \`sort\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '部门树'`,
	},
	{
		name: "sys_role",
		ddl: `create table if not exists \`sys_role\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`code\` varchar(64) collate utf8mb4_unicode_ci not null comment '角色标识(业务键),如 sys_admin',
			\`name\` varchar(32) collate utf8mb4_unicode_ci not null comment '角色名(中文)',
			\`sort\` int not null default 0 comment '排序,越小越靠前',
			\`status\` tinyint not null default 1 comment '1 启用 / 0 停用',
			\`remark\` varchar(255) collate utf8mb4_unicode_ci default null comment '说明',
			\`data_scope\` varchar(32) collate utf8mb4_unicode_ci not null default 'all' comment '数据范围:all / dept_below / dept / self',
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_role_code\` (\`code\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '角色(全局定义;谁有哪些角色见 sys_user_role)'`,
	},
	{
		name: "sys_user_dept",
		ddl: `create table if not exists \`sys_user_dept\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`department_id\` varchar(32) collate utf8mb4_unicode_ci not null comment '部门 id → sys_dept.id(级联删除)',
			\`user_id\` varchar(32) collate utf8mb4_unicode_ci not null comment '用户 id → sys_user.id(级联删除)',
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_dm_unique\` (\`department_id\`, \`user_id\`),
			key \`idx_sys_dm_user\` (\`user_id\`),
			constraint \`fk_sys_dm_department\` foreign key (\`department_id\`) references \`sys_dept\` (\`id\`) on delete cascade,
			constraint \`fk_sys_dm_user\` foreign key (\`user_id\`) references \`sys_user\` (\`id\`) on delete cascade
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '部门成员(谁在哪个部门;角色是全局的,见 sys_user_role)'`,
	},
	{
		name: "sys_user_role",
		ddl: `create table if not exists \`sys_user_role\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`user_id\` varchar(32) collate utf8mb4_unicode_ci not null comment '用户 id → sys_user.id(级联删除)',
			\`role_id\` varchar(32) collate utf8mb4_unicode_ci not null comment '角色 id → sys_role.id(还有人用着就不让删)',
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_ur_unique\` (\`user_id\`, \`role_id\`),
			key \`idx_sys_ur_user\` (\`user_id\`),
			key \`idx_sys_ur_role\` (\`role_id\`),
			constraint \`fk_sys_ur_user\` foreign key (\`user_id\`) references \`sys_user\` (\`id\`) on delete cascade,
			constraint \`fk_sys_ur_role\` foreign key (\`role_id\`) references \`sys_role\` (\`id\`)
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '用户 → 角色(全局;权限取这些角色授权的并集)'`,
	},
	{
		name: "sys_role_menu",
		ddl: `create table if not exists \`sys_role_menu\` (
			\`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
			\`role_id\` varchar(32) collate utf8mb4_unicode_ci not null comment '角色 id → sys_role.id(级联删除)',
			\`menu_id\` varchar(32) collate utf8mb4_unicode_ci not null comment '菜单/按钮 id → sys_menu.id(级联删除)',
			\`create_time\` datetime not null default current_timestamp,
			\`update_time\` datetime not null default current_timestamp on update current_timestamp,
			primary key (\`id\`),
			unique key \`uk_sys_role_menu\` (\`role_id\`, \`menu_id\`),
			key \`idx_sys_role_menu_menu\` (\`menu_id\`),
			constraint \`fk_sys_role_menu_role\` foreign key (\`role_id\`) references \`sys_role\` (\`id\`) on delete cascade,
			constraint \`fk_sys_role_menu_menu\` foreign key (\`menu_id\`) references \`sys_menu\` (\`id\`) on delete cascade
		) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '角色 → 菜单/按钮授权(同时表达「菜单可见」与「按钮可用」)'`,
	},
/** 文件元数据(字节存 MinIO;见 doc/文件管理.md) */
  {
    name: "sys_file",
    ddl: `create table if not exists \`sys_file\` (
      \`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
      \`bucket\` varchar(64) collate utf8mb4_unicode_ci not null comment '桶名(app-public 公开 / app-private 私有)',
      \`object_key\` varchar(512) collate utf8mb4_unicode_ci not null comment '对象键:{yyyy}/{MM}/{nanoid}.{ext}',
      \`origin_name\` varchar(255) collate utf8mb4_unicode_ci not null comment '原始文件名(下载时进 Content-Disposition)',
      \`ext\` varchar(16) collate utf8mb4_unicode_ci default null comment '小写后缀(不带点)',
      \`content_type\` varchar(128) collate utf8mb4_unicode_ci default null comment 'MIME 类型(以对象存储回的为准)',
      \`size\` bigint not null default 0 comment '字节数(confirm 时校准)',
      \`hash\` char(64) collate utf8mb4_unicode_ci default null comment '内容 sha256(仅元数据,不自动去重)',
      \`status\` tinyint not null default 0 comment '0 待确认 / 1 正常 / 2 已删除',
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
    \`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
    \`trace_id\` varchar(32) collate utf8mb4_unicode_ci default null comment '与后端日志同值的追踪号',
    \`path\` varchar(64) collate utf8mb4_unicode_ci not null comment 'tRPC 路径(如 role.create)',
    \`label\` varchar(64) collate utf8mb4_unicode_ci default null comment '中文动作名',
    \`type\` varchar(16) collate utf8mb4_unicode_ci default null comment 'query / mutation',
    \`operator_id\` varchar(32) collate utf8mb4_unicode_ci default null comment '操作人 id',
    \`operator_name\` varchar(64) collate utf8mb4_unicode_ci default null comment '操作人姓名快照',
    \`ip\` varchar(64) collate utf8mb4_unicode_ci default null comment '来源 IP',
    \`target\` varchar(255) collate utf8mb4_unicode_ci default null comment '目标描述(尽力而为)',
    \`status\` tinyint not null default 1 comment '1 成功 / 0 失败',
    \`error_code\` varchar(48) collate utf8mb4_unicode_ci default null comment '错误码',
    \`error_message\` varchar(255) collate utf8mb4_unicode_ci default null comment '错误消息(已脱敏截断)',
    \`input\` text comment '入参快照(已脱敏、截断 2000 字符)',
    \`duration_ms\` int default null comment '耗时(毫秒)',
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
    \`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
    \`user_id\` varchar(32) collate utf8mb4_unicode_ci not null comment '收件人 id',
    \`title\` varchar(128) collate utf8mb4_unicode_ci not null comment '标题',
    \`body\` varchar(255) collate utf8mb4_unicode_ci default null comment '可选正文',
    \`path\` varchar(255) collate utf8mb4_unicode_ci default null comment '点击跳转的站内路径(必须 / 开头)',
    \`level\` varchar(16) collate utf8mb4_unicode_ci not null default 'info' comment 'info / success / warn / danger',
    \`read_at\` datetime default null comment '已读时间;null = 未读',
    \`create_time\` datetime not null default current_timestamp,
    primary key (\`id\`),
    key \`idx_sys_notice_user\` (\`user_id\`, \`read_at\`, \`create_time\`)
  ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = '站内通知(一条一个收件人,见 doc/通知中心.md)'`,
},
/** Demo:综合网格履职(行级数据权限落点;见 doc/测试数据/README.md) */
{
	name: "demo_grid",
	ddl: `create table if not exists \`demo_grid\` (
    \`id\` varchar(32) collate utf8mb4_unicode_ci not null comment '主键(nanoid,由代码生成)',
    \`name\` varchar(64) collate utf8mb4_unicode_ci not null comment '网格名称(片区名)',
    \`town_name\` varchar(32) collate utf8mb4_unicode_ci default null comment '所属街镇(文本)',
    \`town_id\` varchar(32) collate utf8mb4_unicode_ci default null comment '所属街镇 → sys_dept.id(展示/统计用)',
    \`group_id\` varchar(32) collate utf8mb4_unicode_ci default null comment '管理单元 → sys_dept.id(行级范围按它过滤)',
    \`owner_name\` varchar(32) collate utf8mb4_unicode_ci default null comment '网格长姓名',
    \`owner_id\` varchar(32) collate utf8mb4_unicode_ci default null comment '负责人 → sys_user.id(self 档用)',
    \`duty\` varchar(64) collate utf8mb4_unicode_ci default null comment '工作职务',
    \`remark\` varchar(255) collate utf8mb4_unicode_ci default null comment '备注',
    \`create_time\` datetime not null default current_timestamp,
    \`update_time\` datetime not null default current_timestamp on update current_timestamp,
    primary key (\`id\`),
    key \`idx_demo_grid_town\` (\`town_id\`),
    key \`idx_demo_grid_group\` (\`group_id\`),
    key \`idx_demo_grid_owner\` (\`owner_id\`)
  ) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_unicode_ci comment = 'Demo:综合网格履职(行级数据权限落点)'`,
},
];;

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
 * **老库改表名** —— `create table if not exists` 只认新名字,**老库里还叫旧名的表它管不着**:
 * 结果就是老库"没这张表"被当成新库重新建一份,新表空着、旧表的数据没人读。
 * 表改名时在这里登记一条,幂等(新名已存在就跳过)。
 */
const TABLE_RENAMES: Array<{ from: string; to: string }> = [
	{ from: "sys_department", to: "sys_dept" },
	{ from: "sys_department_member", to: "sys_user_dept" },
];

for (const rename of TABLE_RENAMES) {
	const present = (
		await db.execute(
			sql`select table_name as name from information_schema.tables where table_schema = database()`,
		)
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

/**
 * **老库补列** —— `create table if not exists` **不会**给已存在的表加列。
 * 往 `data-base-schema.ts` 加列之后,必须在这里登记一条,老库(以及已经有了 sys_session 的环境)才能跟上。
 * 幂等:列已存在就跳过。
 */
const COLUMN_UPGRADES: Array<{ table: string; column: string; ddl: string }> = [
	{
		table: "sys_menu",
		column: "type",
		ddl: "tinyint not null default 2 comment '1 目录 / 2 菜单 / 3 按钮(按钮只是权限点,不进侧边栏)'",
	},
	{
		table: "sys_menu",
		column: "perm",
		ddl: "varchar(64) collate utf8mb4_unicode_ci default null comment '权限标识,如 sys:role:write;前端 useHasPerm() 认它'",
	},
	{
		table: "sys_role",
		column: "data_scope",
		ddl: "varchar(32) collate utf8mb4_unicode_ci not null default 'all' comment '数据范围:all / self / dept / dept_below'",
	},
	{
		table: "demo_grid",
		column: "group_id",
		ddl: "varchar(32) collate utf8mb4_unicode_ci default null comment '管理单元 → sys_dept.id(行级范围按它过滤)'",
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
 * **老库删列** —— 列被合并 / 废弃时要在这里登记一条。不登记的话老库里那列会一直留着:
 * 它多半是 `not null` 而新代码不再写它,**下一次插入就会违反非空约束**(静默失败最烦人)。
 * 幂等:列不存在就跳过。MySQL 上一列若还挂在某个外键下,必须先删外键再删列。
 */
const COLUMN_DROPS: Array<{ table: string; column: string; constraint?: string }> = [
	{ table: "sys_user_dept", column: "role_id", constraint: "fk_sys_dm_role" },
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

// 建完表再对齐一次列注释 / 索引名:老库通常是在更早的 DDL 下建的,注释里会留着旧列名
await syncTableMeta();

const after = ((await db.execute(sql`show tables`))[0] as unknown as Array<Record<string, unknown>>).map((row) =>
	String(Object.values(row)[0]),
);
console.log(`\n库里现有表:${after.sort().join(", ")}`);
console.log("提示:建好后灌种子 —— `pnpm db:seed:menus` / `db:seed:dicts` / `db:seed:paras` / `db:seed:tags`。");
process.exit(0);
