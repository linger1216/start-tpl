/**
 * **把库里的表注释 / 列注释 / 索引名对齐到最新口径** —— 幂等,只在不一致时 ALTER。
 *
 * 为什么单独一个脚本:表结构会改名、改列(`sys_config` → `sys_para`、`cfg_*` → `para_*`、
 * `user` → `sys_user`),但**表注释、列注释和索引名不会跟着变** —— 数据库不认这种关联,
 * 于是库里留下一堆"描述旧列名"的残留:
 *  · `sys_dict.id` 还写着「字典编码(主键)」,而它早就是 nanoid、编码搬去了 `code`;
 *  · `sys_tag.id` 还写着「维度用 dim::xxx」,那是语义 id 时代的事;
 *  · `sys_para` 的索引还叫 `idx_cfg_group`(`cfg_` 是旧列名前缀)。
 * 这类残留比"没注释"更糟 —— 它**主动误导**后来的人。
 *
 * **注释的唯一真源就是这个文件**(表注释 `TABLE_COMMENTS` + 列注释 `COLUMN_COMMENTS`)。
 * 想加/改注释改这里,不要再往建表脚本的 CREATE 里塞 —— 两处写就会漂移,而漂移了没人会发现。
 * 两张表(desired)与库(current)比对后逐个 ALTER;跑第二遍不会再改任何东西。
 * `pnpm db:create` 建完表也会调这里,所以新库和旧库最终长得一样。
 *
 * **两个方言都支持**(按 `DATABASE_URL` 前缀分支):
 *  · MySQL:`alter table ... comment = '…'` / `alter table ... modify column … comment '…'`
 *    —— MySQL 没有 `comment on` 语法,改注释**必须把列定义整条重写**,见下面 `buildMySqlColumnDef()`;
 *  · 达梦:`comment on table …` / `comment on column …`(Oracle 那套,不用重写列定义)。
 * 达梦的注释视图分两套字段名(实测):表注释看 `SYS.ALL_TAB_COMMENTS.OWNER`(就是模式名),
 * 列注释看 `SYS.ALL_COL_COMMENTS.SCHEMA_NAME` —— 用错字段会「无效的列名」。
 *
 * 用法:`pnpm db:sync:meta`
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../src/db/index.ts";

/** 表注释(10 张表全要有) */
const TABLE_COMMENTS: Record<string, string> = {
	sys_menu: "后台菜单(侧边栏 / 面包屑 / 模块概览的运行时来源;代码里的 NAV_NODES 只是兜底)",
	sys_dict: "系统字典(全系统共用的枚举;读写走 hooks/use-dict)",
	sys_para: "系统参数(「系统设置 ▸ 参数管理」的数据源)",
	sys_tag: "标签树(维度 = 一级节点,标签 = 叶子)",
	sys_tag_relation: "标签与业务对象的关联(某个对象打了哪些标签)",
	sys_file: "文件元数据(字节存 MinIO;见 doc/文件管理.md)",
	sys_log: "审计日志(只增不改;见 doc/审计日志.md)",
	sys_user: "用户(Better Auth 内核四表之一;auth 是系统内部服务,故吃 sys_ 前缀)",
	sys_session: "登录会话(每个设备 / 浏览器一行;user_id 级联删除)",
	sys_account: "登录账号(一个用户可绑多种登录方式;邮箱密码登录的 provider_id = 'credential')",
	sys_verification: "验证码 / 一次性令牌(邮箱验证、改密、二次验证都用它)",
	sys_dept: "部门树(组织架构;谁是成员见 sys_user_dept)",
	sys_role: "角色(全局定义 —— 不随部门数增长;谁有哪些角色见 sys_user_role)",
	sys_user_dept: "部门成员(谁在哪个部门;只管组织架构,不携带角色)",
	sys_user_role: "用户 → 角色(全局;权限 = 这些角色授权的并集)",
	sys_role_menu: "角色 → 菜单/按钮授权(一条表同时表达「菜单可见」与「按钮可用」)",
	todos: "模板示例表(demo 用;删 demo 时一并删)",
};

/**
 * 列注释的准绳 —— **唯一真源**,想加注释改这里,不要再往 CREATE 语句里塞。
 * ⚠️ 认证四表(`sys_user` / `sys_session` / `sys_account` / `sys_verification`)的**列名**
 * 是 better-auth 写死的,别改(注释随便改)。
 */
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
	{ table: "sys_menu", column: "type", comment: "1 目录 / 2 菜单 / 3 按钮(按钮只是权限点,不进侧边栏)" },
	{ table: "sys_menu", column: "perm", comment: "权限标识,如 sys:role:write;前端 useHasPerm() 认它" },
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
	// sys_user(Better Auth 内核)
	{ table: "sys_user", column: "id", comment: "主键(better-auth 生成的字符串)" },
	{ table: "sys_user", column: "name", comment: "显示名(顶栏用户菜单展示的就是它)" },
	{ table: "sys_user", column: "email", comment: "邮箱(登录标识;唯一)" },
	{ table: "sys_user", column: "email_verified", comment: "邮箱是否已验证(0 未验证 / 1 已验证;drizzle 侧映射成布尔)" },
	{ table: "sys_user", column: "image", comment: "头像 URL(可空)" },
	{ table: "sys_user", column: "created_at", comment: "创建时间(better-auth 口径,注意不是 create_time)" },
	{ table: "sys_user", column: "updated_at", comment: "更新时间(better-auth 口径)" },
	// sys_session
	{ table: "sys_session", column: "id", comment: "主键(better-auth 生成)" },
	{ table: "sys_session", column: "expires_at", comment: "过期时间(过了它 better-auth 就不再认这条会话)" },
	{ table: "sys_session", column: "token", comment: "会话令牌(浏览器 cookie 里带的就是它;唯一)" },
	{ table: "sys_session", column: "ip_address", comment: "登录来源 IP(可空)" },
	{ table: "sys_session", column: "user_agent", comment: "登录来源 UA(可空)" },
	{ table: "sys_session", column: "user_id", comment: "用户 id → sys_user.id(级联删除)" },
	{ table: "sys_session", column: "created_at", comment: "创建时间(better-auth 口径)" },
	{ table: "sys_session", column: "updated_at", comment: "更新时间(better-auth 口径)" },
	// sys_account
	{ table: "sys_account", column: "id", comment: "主键(better-auth 生成)" },
	{ table: "sys_account", column: "account_id", comment: "外部账号标识(邮箱密码登录时 = 邮箱)" },
	{ table: "sys_account", column: "provider_id", comment: "登录方式标识(邮箱密码 = 'credential';第三方 = 厂商名)" },
	{ table: "sys_account", column: "user_id", comment: "用户 id → sys_user.id(级联删除)" },
	{ table: "sys_account", column: "access_token", comment: "OAuth 访问令牌(邮箱密码登录时为 null)" },
	{ table: "sys_account", column: "refresh_token", comment: "OAuth 刷新令牌" },
	{ table: "sys_account", column: "id_token", comment: "OIDC id_token" },
	{ table: "sys_account", column: "access_token_expires_at", comment: "访问令牌过期时间" },
	{ table: "sys_account", column: "refresh_token_expires_at", comment: "刷新令牌过期时间" },
	{ table: "sys_account", column: "scope", comment: "OAuth 授权范围" },
	{ table: "sys_account", column: "password", comment: "密码哈希(better-auth 自己的 scrypt;**不可与其它系统的哈希混用**)" },
	{ table: "sys_account", column: "created_at", comment: "创建时间(better-auth 口径)" },
	{ table: "sys_account", column: "updated_at", comment: "更新时间(better-auth 口径)" },
	// sys_verification
	{ table: "sys_verification", column: "id", comment: "主键(better-auth 生成)" },
	{ table: "sys_verification", column: "identifier", comment: "要对谁验证(邮箱 / 手机号等)" },
	{ table: "sys_verification", column: "value", comment: "验证码 / 一次性令牌的值" },
	{ table: "sys_verification", column: "expires_at", comment: "过期时间" },
	{ table: "sys_verification", column: "created_at", comment: "创建时间(better-auth 口径)" },
	{ table: "sys_verification", column: "updated_at", comment: "更新时间(better-auth 口径)" },
	// sys_dept
	{ table: "sys_dept", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_dept", column: "parent_id", comment: "上级部门 id;null = 顶级" },
	{ table: "sys_dept", column: "name", comment: "部门名" },
	{ table: "sys_dept", column: "sort", comment: "同级排序,越小越靠前" },
	{ table: "sys_dept", column: "status", comment: "1 启用 / 0 停用" },
	{ table: "sys_dept", column: "remark", comment: "备注" },
	{ table: "sys_dept", column: "create_time", comment: "创建时间" },
	{ table: "sys_dept", column: "update_time", comment: "更新时间" },
	// sys_role
	{ table: "sys_role", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_role", column: "code", comment: "角色标识(业务键),如 sys_admin —— 程序里认它" },
	{ table: "sys_role", column: "name", comment: "角色名(中文)" },
	{ table: "sys_role", column: "sort", comment: "排序,越小越靠前" },
	{ table: "sys_role", column: "status", comment: "1 启用 / 0 停用" },
	{ table: "sys_role", column: "remark", comment: "说明" },
	{ table: "sys_role", column: "create_time", comment: "创建时间" },
	{ table: "sys_role", column: "update_time", comment: "更新时间" },
	// sys_user_dept
	{ table: "sys_user_dept", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_user_dept", column: "department_id", comment: "部门 id → sys_dept.id(级联删除)" },
	{ table: "sys_user_dept", column: "user_id", comment: "用户 id → sys_user.id(级联删除)" },
	{ table: "sys_user_dept", column: "create_time", comment: "创建时间" },
	{ table: "sys_user_dept", column: "update_time", comment: "更新时间" },

	// sys_user_role
	{ table: "sys_user_role", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_user_role", column: "user_id", comment: "用户 id → sys_user.id(级联删除)" },
	{ table: "sys_user_role", column: "role_id", comment: "角色 id → sys_role.id(还有人用着就不让删)" },
	{ table: "sys_user_role", column: "create_time", comment: "创建时间" },
	{ table: "sys_user_role", column: "update_time", comment: "更新时间" },
	// sys_role_menu
	{ table: "sys_role_menu", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_role_menu", column: "role_id", comment: "角色 id → sys_role.id(级联删除)" },
	{ table: "sys_role_menu", column: "menu_id", comment: "菜单/按钮 id → sys_menu.id(级联删除)" },
	{ table: "sys_role_menu", column: "create_time", comment: "创建时间" },
	{ table: "sys_role_menu", column: "update_time", comment: "更新时间" },
	// todos(示例表)
	{ table: "todos", column: "id", comment: "主键(自增;示例表)" },
	{ table: "todos", column: "title", comment: "待办标题" },
	{ table: "todos", column: "created_at", comment: "创建时间" },
	{ table: "sys_file", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_file", column: "bucket", comment: "桶名(app-public 公开直链 / app-private 私有预签名)" },
	{ table: "sys_file", column: "object_key", comment: "对象键:{yyyy}/{MM}/{nanoid}.{ext}" },
	{ table: "sys_file", column: "origin_name", comment: "原始文件名(下载时进 Content-Disposition)" },
	{ table: "sys_file", column: "ext", comment: "小写后缀(不带点)" },
	{ table: "sys_file", column: "content_type", comment: "MIME 类型(以对象存储回的为准)" },
	{ table: "sys_file", column: "size", comment: "字节数(confirm 时校准)" },
	{ table: "sys_file", column: "hash", comment: "内容 sha256(仅元数据,不自动去重)" },
	{ table: "sys_file", column: "status", comment: "0 待确认 / 1 正常 / 2 已删除" },
	{ table: "sys_file", column: "create_time", comment: "创建时间" },
	{ table: "sys_file", column: "update_time", comment: "更新时间" },
	{ table: "sys_log", column: "id", comment: "主键(nanoid,由代码生成)" },
	{ table: "sys_log", column: "trace_id", comment: "与后端日志同值的追踪号" },
	{ table: "sys_log", column: "path", comment: "tRPC 路径(如 role.create)" },
	{ table: "sys_log", column: "label", comment: "中文动作名" },
	{ table: "sys_log", column: "type", comment: "query / mutation" },
	{ table: "sys_log", column: "operator_id", comment: "操作人 id" },
	{ table: "sys_log", column: "operator_name", comment: "操作人姓名快照" },
	{ table: "sys_log", column: "ip", comment: "来源 IP" },
	{ table: "sys_log", column: "target", comment: "目标描述(尽力而为)" },
	{ table: "sys_log", column: "status", comment: "1 成功 / 0 失败" },
	{ table: "sys_log", column: "error_code", comment: "错误码" },
	{ table: "sys_log", column: "error_message", comment: "错误消息(已脱敏截断)" },
	{ table: "sys_log", column: "input", comment: "入参快照(已脱敏、截断 2000 字符)" },
	{ table: "sys_log", column: "duration_ms", comment: "耗时(毫秒)" },
	{ table: "sys_log", column: "create_time", comment: "创建时间" },
];

/**
 * 索引改名 —— 名字也是"说明文字"的一部分:`idx_cfg_group` 会让人以为还有 `cfg_group` 这一列。
 * 只改名字,不动列;目标名已存在就跳过。(只有 MySQL 走这里;达梦的索引名在建表时就写对了。)
 */
const INDEX_RENAMES: Array<{ table: string; from: string; to: string }> = [
	{ table: "sys_para", from: "idx_cfg_group", to: "idx_para_group" },
];

/**
 * **结构修复**:MySQL 上被 `modify column` 弄坏的列 —— 带**完整目标定义**,连精度一起补回来。
 *
 * 起因(真实踩过,而且悄无声息):MySQL 没有 `comment on`,改注释只能
 * `alter table … modify column …`,而**必须把列定义整条重写**。早先的实现漏了 `EXTRA`,
 * 于是设置表的 `update_time datetime(3) not null default current_timestamp(3) on update current_timestamp(3)`
 * 被改成了 `datetime null default CURRENT_TIMESTAMP` —— **精度没了、not null 没了、自动更新也没了**。
 * 这种损伤只有对着 `show create table` 才看得出来,所以这里逐列校验 + 补回。
 * 现在 `buildMySqlColumnDef()` 会保留 `EXTRA`,不会再制造新的同类损坏。
 */
const COLUMN_REPAIRS: Array<{ table: string; column: string; ddl: string }> = [
	{ table: "sys_menu", column: "update_time", ddl: "datetime(3) not null default current_timestamp(3) on update current_timestamp(3)" },
	{ table: "sys_dict", column: "update_time", ddl: "datetime(3) not null default current_timestamp(3) on update current_timestamp(3)" },
	{ table: "sys_para", column: "update_time", ddl: "datetime(3) not null default current_timestamp(3) on update current_timestamp(3)" },
	{ table: "sys_tag", column: "update_time", ddl: "datetime(3) not null default current_timestamp(3) on update current_timestamp(3)" },
	{ table: "sys_tag_relation", column: "update_time", ddl: "datetime(3) not null default current_timestamp(3) on update current_timestamp(3)" },
];

const IS_DM = (process.env.DATABASE_URL ?? "").startsWith("dm://");
/** 达梦:注释语句要带模式名,从连接串的 `?schema=` 取 */
const DM_SCHEMA =
	new URLSearchParams((process.env.DATABASE_URL ?? "").split("?")[1] ?? "").get("schema") ?? "eg";

/** 单引号转义 + 压成单行(注释里不该有换行,换行会让某些客户端显示错乱) */
const q = (text: string) => text.replace(/'/g, "''").replace(/\s+/g, " ").trim();

type ColMeta = { type: string; nullable: string; def: string | null; extra: string | null; coll: string | null };

/** 取列定义(改注释时必须整条重写,少一个子句都会把列改坏)
 *  ⚠️ `extra` 必须显式 `as extra` 起别名:`information_schema` 的字段名是**大写 `EXTRA`**,
 *  不写别名读到的就是 `undefined` → `not null` / `auto_increment` / `on update` 会被**静默丢掉**(踩过)。 */
async function mysqlColumnMeta(table: string): Promise<Map<string, ColMeta>> {
	const rows = (
		await db.execute(
			sql`select column_name as name, column_type as type, is_nullable as nullable, column_default as def, extra as extra, collation_name as coll
				from information_schema.columns where table_schema = database() and table_name = ${table}`,
		)
	)[0] as unknown as Array<{ name: string } & ColMeta>;
	return new Map(rows.map((row) => [row.name, { type: row.type, nullable: row.nullable, def: row.def, extra: row.extra, coll: row.coll }]));
}

/**
 * 把一列的完整定义拼出来。
 * ⚠️ `EXTRA` 不能原样照抄:MySQL 会在里面塞 `DEFAULT_GENERATED`(来自 `DEFAULT (now())`)
 * 这种**只在 information_schema 里存在**的标记,写进 DDL 会语法错误。只认这两类能落地的。
 */
function buildMySqlColumnDef(meta: ColMeta, comment: string, extraOverride?: string): string {
	const nullable = meta.nullable === "NO" ? "not null" : "null";
	const coll = meta.coll ? ` collate ${meta.coll}` : "";
	let def = "";
	if (meta.def !== null) {
		def = /^(current_timestamp|now\(\))/i.test(meta.def) ? ` default ${meta.def}` : ` default '${String(meta.def).replace(/'/g, "''")}'`;
	}
	const parts: string[] = [];
	const raw = `${meta.extra ?? ""}${extraOverride ? ` ${extraOverride}` : ""}`;
	if (/auto_increment/i.test(raw)) parts.push("auto_increment");
	const onUpdate = raw.match(/on update (current_timestamp(?:\(\d+\))?)/i);
	if (onUpdate) parts.push(`on update ${onUpdate[1]}`);
	const extra = parts.length ? ` ${parts.join(" ")}` : "";
	return `${meta.type}${coll} ${nullable}${def}${extra} comment '${q(comment)}'`;
}

async function currentTableComments(): Promise<Map<string, string>> {
	if (IS_DM) {
		const rows = (
			await db.execute(sql.raw(`select TABLE_NAME as t, COMMENTS as c from SYS.ALL_TAB_COMMENTS where OWNER='${DM_SCHEMA}'`))
		)[0] as unknown as Array<{ t: string; c: string | null }>;
		return new Map(rows.map((row) => [row.t, row.c ?? ""]));
	}
	const rows = (
		await db.execute(
			sql`select table_name as t, table_comment as c from information_schema.tables where table_schema = database()`,
		)
	)[0] as unknown as Array<{ t: string; c: string | null }>;
	return new Map(rows.map((row) => [row.t, row.c ?? ""]));
}

async function currentColumnComments(table: string): Promise<Map<string, string>> {
	if (IS_DM) {
		const rows = (
			await db.execute(
				sql.raw(`select COLUMN_NAME as c, COMMENTS as m from SYS.ALL_COL_COMMENTS where SCHEMA_NAME='${DM_SCHEMA}' and TABLE_NAME='${table}'`),
			)
		)[0] as unknown as Array<{ c: string; m: string | null }>;
		return new Map(rows.map((row) => [row.c, row.m ?? ""]));
	}
	const rows = (
		await db.execute(
			sql`select column_name as c, column_comment as m from information_schema.columns where table_schema = database() and table_name = ${table}`,
		)
	)[0] as unknown as Array<{ c: string; m: string | null }>;
	return new Map(rows.map((row) => [row.c, row.m ?? ""]));
}

async function indexNames(table: string): Promise<Set<string>> {
	const rows = (
		await db.execute(
			sql`select distinct index_name as name from information_schema.statistics where table_schema = database() and table_name = ${table}`,
		)
	)[0] as unknown as Array<{ name: string }>;
	return new Set(rows.map((row) => row.name));
}

/** 写一条表注释(方言差异就这一处) */
async function setTableComment(table: string, comment: string): Promise<void> {
	await db.execute(
		IS_DM
			? sql.raw(`comment on table "${DM_SCHEMA}"."${table}" is '${q(comment)}'`)
			: sql.raw(`alter table \`${table}\` comment = '${q(comment)}'`),
	);
}

/** 写一条列注释(MySQL 要把列定义整条重写;达梦只需要 comment on) */
async function setColumnComment(table: string, column: string, comment: string, meta?: ColMeta, extraOverride?: string): Promise<void> {
	if (IS_DM) {
		await db.execute(sql.raw(`comment on column "${DM_SCHEMA}"."${table}"."${column}" is '${q(comment)}'`));
		return;
	}
	await db.execute(sql.raw(`alter table \`${table}\` modify column \`${column}\` ${buildMySqlColumnDef(meta as ColMeta, comment, extraOverride)}`));
}

export async function syncTableMeta(): Promise<void> {
	let changed = 0;
	const target = IS_DM ? `达梦(${DM_SCHEMA})` : "MySQL";

	// ── 1) 表注释 ──
	const tables = await currentTableComments();
	for (const [table, comment] of Object.entries(TABLE_COMMENTS)) {
		if (!tables.has(table)) {
			console.warn(`⚠️ 表 ${table} 不存在,跳过(先跑建表脚本)`);
			continue;
		}
		if (tables.get(table) === comment) continue;
		await setTableComment(table, comment);
		console.log(`· 表 ${table}:「${tables.get(table) || "(无)"}」→「${comment}」`);
		changed += 1;
	}

	// ── 2) 列注释 ──
	const byTable = new Map<string, typeof COLUMN_COMMENTS>();
	for (const item of COLUMN_COMMENTS) byTable.set(item.table, [...(byTable.get(item.table) ?? []), item]);
	for (const [table, items] of byTable) {
		if (!tables.has(table)) continue; // 表注释那轮已经告警过一次了,别逐列再刷一遍
		const current = await currentColumnComments(table);
		const meta = IS_DM ? undefined : await mysqlColumnMeta(table);
		for (const item of items) {
			if (!current.has(item.column)) {
				console.warn(`⚠️ ${table}.${item.column} 不存在,跳过(表结构可能还没升到最新)`);
				continue;
			}
			if (current.get(item.column) === item.comment) continue;
			const m = meta?.get(item.column);
			if (!IS_DM && !m) continue;
			await setColumnComment(table, item.column, item.comment, m);
			console.log(`· ${table}.${item.column}:「${current.get(item.column) || "(无)"}」→「${item.comment}」`);
			changed += 1;
		}
	}

	// ── 3) 结构修复:被改坏的时间列(MySQL)──
	if (!IS_DM) {
		for (const item of COLUMN_REPAIRS) {
			const meta = await mysqlColumnMeta(item.table);
			const m = meta.get(item.column);
			if (!m) continue;
			// 期望的精度与 ON UPDATE 子句都在 → 跳过(幂等)
			const precision = item.ddl.match(/\((\d+)\)/)?.[1];
			const wantOnUpdate = item.ddl.match(/on update (\S+)/i)?.[1] ?? "";
			const okPrecision = !precision || m.type.includes(`(${precision})`);
			// ⚠️ 别用 new RegExp(`on update ${wantOnUpdate}`):wantOnUpdate 里的括号会被当成**正则分组**,
			// 于是永远匹配不上、每跑一次都重复 ALTER(踩过)。用大小写无关的 includes 最稳。
			const okOnUpdate = (m.extra ?? "").toLowerCase().includes(`on update ${wantOnUpdate}`.toLowerCase());
			if (okPrecision && okOnUpdate) continue;
			const comment = (await currentColumnComments(item.table)).get(item.column) ?? "";
			await db.execute(
				sql.raw(`alter table \`${item.table}\` modify column \`${item.column}\` ${item.ddl} comment '${q(comment)}'`),
			);
			console.log(`· ${item.table}.${item.column}:结构补回(${m.type} → ${item.ddl.split(" ")[0]})`);
			changed += 1;
		}
	}

	// ── 4) 索引改名(MySQL)──
	if (!IS_DM) {
		for (const item of INDEX_RENAMES) {
			const names = await indexNames(item.table);
			if (names.has(item.to)) continue;
			if (!names.has(item.from)) continue;
			await db.execute(sql.raw(`alter table \`${item.table}\` rename index \`${item.from}\` to \`${item.to}\``));
			console.log(`· ${item.table}:索引 ${item.from} → ${item.to}`);
			changed += 1;
		}
	}

	console.log(
		changed === 0
			? `✓ ${target} 的表注释 / 列注释 / 索引名已是最新,无需改动`
			: `✓ ${target} 已对齐 ${changed} 处(表注释 / 列注释 / 索引名)`,
	);
}

// 直接执行时跑一次;被 db:create 引用时由那边调用
if (import.meta.url === `file://${process.argv[1]}`) {
	syncTableMeta()
		.then(() => process.exit(0))
		.catch((error) => {
			console.error(error);
			process.exit(1);
		});
}
