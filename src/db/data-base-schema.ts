/**
 * **系统表**的 drizzle 定义 —— 九张:
 *  - 系统设置五张:`sys_menu` / `sys_dict` / **`sys_para`**(参数,旧名 `sys_config`)/ `sys_tag`(标签树)/
 *    `sys_tag_relation`(标签 ↔ 业务对象 的关系);
 *  - 认证四张(Better Auth 内核):`sys_user` / `sys_session` / `sys_account` / `sys_verification`。
 *
 * 为什么单独一个文件、而不是并进 `src/db/schema.ts`:
 *   这几张表的 DDL 由**建表脚本**维护(`scripts/create-system-tables.ts`,幂等
 *   `create table if not exists`),**不进 drizzle 迁移**。
 *   `drizzle.config.ts` 的 `schema` 只指向 `./src/db/schema.ts`(现在只剩 `todos` 示例表);
 *   若把这些表并进去,下次 `pnpm db:generate` 会生成 CREATE,而库里已存在
 *   → `pnpm db:migrate` 直接 1050 报错。
 *   所以这里只定义「读写的形状」,迁移边界一行不改。
 *   ⚠️ 改这里的列之后,**还要去建表脚本补 ALTER**(或手工 ALTER 库),否则两边会漂移。
 *
 * 派生新项目时,这几张表基本可以直接复用:
 *  - `sys_menu` 侧边栏 / 面包屑 / 模块概览的运行时来源(`NAV_NODES` 只是兜底);
 *  - `sys_dict` 全系统共用的字典(`useDict` 读它);
 *  - `sys_para` 「系统设置 ▸ 参数管理」的数据源(`para_key` / `para_value` / `para_type`);
 *  - `sys_tag` / `sys_tag_relation` 标签体系与"对象打了哪些标签"。
 *
 * 时间列(`create_time` / `update_time`)由 DDL 的 `DEFAULT CURRENT_TIMESTAMP`
 * / `ON UPDATE CURRENT_TIMESTAMP` 提供 —— drizzle 的 mysql `datetime` 没有
 * `defaultNow` / `onUpdateNow`,所以这里不写,留给 MySQL 填。
 *
 * ⚠️ **API 协议 vs DB 列名的分层**:DB 走 snake_case;前端 API 协议(本文件 consumer)
 * 走 camelCase,翻译点在 `src/integrations/trpc/routers/{menu,dict,para,tag}.ts`。
 */
import {
	boolean,
	datetime,
	index,
	int,
	json,
	mysqlTable,
	text,
	timestamp,
	tinyint,
	uniqueIndex,
	varchar,
} from "drizzle-orm/mysql-core";

// ── 菜单表 ───────────────────────────────────────────────

/**
 * 菜单表(`sys_menu`)—— 侧边栏 / 面包屑 / 模块概览的**运行时来源**。
 *
 * 树靠自关联 `parent_id`,排序用 `sort`,上下线用 `visible`(0 = 隐藏,连同其子树一起不显示)。
 *
 * 与静态配置的关系:`src/components/layout/nav-config.ts` 的 `NAV_NODES` 仍是
 * **兜底 + 权限点派生 + 种子来源**;表里**有数据时以表为准**(见 `nav-menu.ts` 的 `buildNavTree`)。
 * 所以「菜单」这张表可以放心改:改名字 / 调顺序 / 下线一项,刷新页面即生效;
 * 表被清空也不会白屏,会自动退回静态菜单。
 */
export const sysMenu = mysqlTable(
	"sys_menu",
	{
		/**
		 * 主键:**nanoid**(无意义随机串,见 `lib/ids.ts` 的 `newId()`)。
		 * 早先这里存的是 path / `@名称` 这种语义串,现在统一成 nanoid —— **业务键是 `path`**,
		 * 认节点用 id、认路由用 path,两者不再混用。
		 */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 父菜单 id(同样是 nanoid);null = 一级菜单 */
		parent_id: varchar("parent_id", { length: 32 }),
		name: varchar("name", { length: 32 }).notNull(),
		/**
		 * 页面路由(**业务键**):菜单靠它认路由,`pnpm db:seed:menus` 也靠它判重
		 * (不能靠 id —— id 是随机串,每次生成都不同)。
		 *
		 * ⚠️ 表定义里是 `not null` + 唯一:**没有"没有 path 的分组"这一档**。
		 * 想表达"只是个分组、点了不跳页",给一个不指向任何路由的占位 path,不要留空。
		 */
		path: varchar("path", { length: 128 }).notNull(),
		/** 图标名(小写 kebab-case,与 `NAV_ICON_MAP` 的键一致);不认识的会退回默认图标 */
		icon: varchar("icon", { length: 32 }),
		/** 同级排序,越小越靠前 */
		sort: int("sort").notNull().default(0),
		/** 1 显示 / 0 隐藏(隐藏的分组连带子树一起不显示) */
		visible: tinyint("visible").notNull().default(1),
		/**
		 * 1 启用 / 0 停用。
		 *
		 * ⚠️ 表里有这一列,但**当前没有任何代码读它**:「上线 / 下线」仍然走 `visible`
		 * (那是 0/1 且带子树语义的口径)。要不要把 status 接进菜单页,是另一件事 —— 别在
		 * 这里顺手加过滤,否则运维把一行停用后菜单会静默消失。
		 */
		status: tinyint("status").notNull().default(1),
		create_time: datetime("create_time", { mode: "date", fsp: 3 }),
		update_time: datetime("update_time", { mode: "date", fsp: 3 }),
	},
	(table) => [index("idx_sys_menu_parent").on(table.parent_id), uniqueIndex("uk_sys_menu_path").on(table.path)],
);

// ── 字典表 ───────────────────────────────────────────────

/**
 * 系统字典(`sys_dict`)—— **全系统共用**的一张字典表。
 *
 * 一个字典一行:`code` 是**字典编码**(如 `entity_category`,人填、对外引用),
 * `items` 是 `[{label, value}]` 数组。第一处用途是「下拉候选值的统一来源」;
 * 以后接入方式、状态码这类枚举都可以放进来,不必每个业务再各建一张小表。
 *
 * 两个键的分工(踩过坑,别合回去):
 *  - `id` = **nanoid 主键**,只用来定位行,不对外暴露;
 *  - `code` = 业务键,**所有读写都按它**(`dict.byCode` / 规则里写 `spec.category = ...`)。
 *    以前 `id` 身兼两职,于是"改编码"等于"改主键",谁引用过就一起断。
 */
export const sysDict = mysqlTable(
	"sys_dict",
	{
		/** 主键:nanoid(见 `lib/ids.ts` 的 `newId()`) */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 字典编码:小写字母/数字/下划线,业务侧按它引用(唯一) */
		code: varchar("code", { length: 64 }).notNull(),
		name: varchar("name", { length: 32 }).notNull(),
		items: json("items").$type<Array<{ label: string; value: string }> | null>(),
		remark: varchar("remark", { length: 255 }),
		status: tinyint("status").notNull().default(1),
		create_time: datetime("create_time", { mode: "date" }),
		update_time: datetime("update_time", { mode: "date" }),
	},
	(table) => [uniqueIndex("uk_sys_dict_code").on(table.code)],
);

// ── 系统参数表 ────────────────────────────────────────────

/**
 * 系统参数(`sys_para`)—— 「系统设置 ▸ 参数管理」的数据源。
 *
 * 模板内置默认参数(`lib/para-spec.ts` 的 `PARA_DEFAULTS`)在库里没记录时生效。
 * 改值不重新发版(运维口径),带 30 秒内存缓存(见 `lib/sys-para.ts` 的 `getParaMap`)。
 *
 * 表定义改过一轮(旧名 `sys_config` / `cfg_*` 列),现在的口径:
 *  - **主键是 `para_key`**(参数名),`id` 只是 `not null` 的普通列(nanoid,由代码填);
 *    所以**每一处 insert 都必须自己生成 `id`**,漏了就是 "Field 'id' doesn't have a default value";
 *  - `para_value` 是 `text`(不再受 4000 字符列宽限制);
 *  - `para_type` 是 **tinyint 码**,不是字符串:`1 int / 2 bool / 3 string / 4 json`
 *    (码 ↔ 中文名 ↔ 校验都在 `lib/para-spec.ts`,别在页面里再写一张映射表);
 *  - `status` / `editable` 与其它表同口径,当前代码只读 `editable`。
 */
export const sysPara = mysqlTable(
	"sys_para",
	{
		/** 普通列(非主键):无意义短串(nanoid);业务永远按 `para_key` 找参数 */
		id: varchar("id", { length: 32 }).notNull(),
		/** 参数名,如 `raw.retention.soft_days` —— **主键** */
		para_key: varchar("para_key", { length: 64 }).primaryKey(),
		/** 参数值(text,不限 4000) */
		para_value: text("para_value").notNull(),
		/** 类型码:1 int / 2 bool / 3 string / 4 json(见 `lib/para-spec.ts`) */
		para_type: tinyint("para_type").notNull(),
		para_group: varchar("para_group", { length: 32 }),
		/** 1 启用 / 0 停用(表里有,当前代码没读 —— 别顺手加过滤) */
		status: tinyint("status").notNull().default(1),
		/** 给人看的说明(界面直接展示,所以参数要自带文档) */
		remark: varchar("remark", { length: 255 }),
		/** 0 = 代码内置不允许改 */
		editable: tinyint("editable").notNull().default(1),
		create_time: datetime("create_time", { mode: "date" }),
		update_time: datetime("update_time", { mode: "date" }),
	},
	(table) => [index("idx_para_group").on(table.para_group)],
);

// ── 标签树表 ────────────────────────────────────────────

/**
 * 标签体系(`sys_tag`)—— 「系统设置 ▸ 标签管理」的**持久化来源**(自关联树)。
 *
 * 标签体系是树状的:顶层是「维度」(标签分类,如「场所风险等级」),其下挂若干「标签」(如「红色」)。
 * 所以一棵 `sys_tag` 树就是「维度 → 标签」两级:
 *  - `parent_id` 为 null 的行 = 维度(一级节点);
 *  - `parent_id` 指向某维度的行 = 该维度下的标签(叶子)。
 * 每个节点都有 `label`(展示名)/ `value`(取值,可空)/ `desc`(含义说明)。
 *
 * 与 `sys_menu` 同级:`drizzle.config.ts` 的 `schema` 不指向本文件,**不进迁移**(库里已存在,
 * 进迁移会 1050)。本文件只定义「读写的形状」。首次可用 `pnpm db:seed:tags` 灌种子。
 *
 * 时间列由 MySQL 的 `DEFAULT CURRENT_TIMESTAMP` / `ON UPDATE` 提供(同 `sys_menu`)。
 */
export const sysTag = mysqlTable(
	"sys_tag",
	{
		/** 主键:nanoid(见 `lib/ids.ts` 的 `newId()`);节点靠 id 认,靠 (parent_id, label) 判重 */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 父节点 id(同样是 nanoid);null = 维度(一级节点) */
		parent_id: varchar("parent_id", { length: 32 }),
		/** 展示名(维度名 / 标签名) */
		label: varchar("label", { length: 32 }).notNull(),
		/** 取值(同名字可空,或存编码值);叶子标签通常用得到 */
		value: varchar("value", { length: 32 }),
		/** 含义说明(hover / 详情用) */
		desc: text("desc"),
		/** 同级排序,越小越靠前 */
		sort: int("sort").notNull().default(0),
		create_time: datetime("create_time", { mode: "date", fsp: 3 }),
		update_time: datetime("update_time", { mode: "date", fsp: 3 }),
	},
	(table) => [index("idx_sys_tag_parent").on(table.parent_id)],
);

// ── 标签 → 对象 关系表 ───────────────────────────────────

/**
 * 标签与业务对象的**关联表**(多对多)—— 一行 = "某个对象被打上了某个标签"。
 *
 * 为什么是"多态关联"而不是给每张业务表加 `tag_ids` 列:
 *  - 被贴标签的对象五花八门(档案 / 数据源 / 某个业务记录),不可能每加一张表就改一次标签逻辑;
 *  - `obj_type` + `obj_id` 两列指向任意对象,`sys_tag.id` 只认标签本身 —— 解耦干净。
 *
 * 字段口径:
 *  - `tag_id` → `sys_tag.id`(**叶子标签**;给"维度"贴标签没有业务含义,由写入方自己把关);
 *  - `obj_type` → 业务对象类型,表上是 **tinyint 码**(不是字符串!):各业务自己约定
 *    (建议集中登记成一份常量,别把魔数散在调用点);
 *  - `obj_id` → 业务对象主键(字符串,兼容 nanoid / 编号两种口径);
 *  - `id` → 无意义主键(nanoid,见 `lib/ids.ts` 的 `newId()`);
 *  - 唯一键 `(tag_id, obj_type, obj_id)` = 同一个对象贴同一个标签只允许一行(重复插入应当被拦下)。
 *
 * ⚠️ 目前**只有表,没有读写它的代码**:写入方(哪个业务动作会打标签)还没定。
 * 接的时候照 `trpc/routers/tag.ts` 起一个 `tagLink` 路由即可,别在业务页里各写一份 SQL。
 */
export const sysTagRelation = mysqlTable(
	"sys_tag_relation",
	{
		id: varchar("id", { length: 32 }).primaryKey(),
		tag_id: varchar("tag_id", { length: 32 }).notNull(),
		obj_id: varchar("obj_id", { length: 32 }).notNull(),
		obj_type: tinyint("obj_type").notNull(),
		create_time: datetime("create_time", { mode: "date" }),
		update_time: datetime("update_time", { mode: "date" }),
	},
	(table) => [
		index("idx_tag_rel_tag").on(table.tag_id),
		index("idx_tag_rel_obj").on(table.obj_type, table.obj_id),
		uniqueIndex("uk_tag_rel_unique").on(table.tag_id, table.obj_type, table.obj_id),
	],
);

// ── 认证四表(Better Auth 内核)────────────────────────────
//
// 为什么在这儿:`auth` 是**系统的内部服务**,不是将来的业务应用 —— 所以和上面几张一样吃 `sys_` 前缀、
// 同样**不进 drizzle 迁移**(MySQL 由 `scripts/create-system-tables.ts` 建,达梦由
// `scripts/create-better-auth-tables-dm.ts` 建)。
//
// ⚠️ **本文件里唯独这四张表用驼峰属性名**(`emailVerified: boolean("email_verified")`)——
// 不是笔误,是 better-auth 的硬要求:它按 **drizzle 的属性名**去找模型字段,找不到就报
// `Drizzle schema mismatch / Missing columns: user.emailVerified …`,并顺带警告
// 「session.expires_at 是 BA 永远不会写的必填列」。DB 列名仍然是 snake_case(显式写在第二个参数里)。
// 另外**表名也不能左右它**:它按 `src/lib/auth.ts` 传给 adapter 的**映射键名**
// (`user` / `session` / `account` / `verification`)找表,所以 DB 表叫 `sys_user` 完全没问题。
//
// `email_verified` 保留 drizzle 的 `boolean`(别换成 tinyint):better-auth 的客户端契约是布尔,
// 换了 API 会开始返回 0/1。DDL 上它仍是 `tinyint(1)`。

/** 用户 —— better-auth `user` 模型 */
export const sysUser = mysqlTable(
	"sys_user",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		name: varchar("name", { length: 128 }).notNull(),
		email: varchar("email", { length: 255 }).notNull().unique(),
		emailVerified: boolean("email_verified").notNull().default(false),
		image: varchar("image", { length: 512 }),
		createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
	},
	(table) => [uniqueIndex("uk_sys_user_email").on(table.email)],
);

/** 会话 —— 每个登录设备 / 浏览器一行;`user_id` 级联删除 */
export const sysSession = mysqlTable(
	"sys_session",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		token: varchar("token", { length: 255 }).notNull().unique(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: varchar("user_id", { length: 36 })
			.notNull()
			.references(() => sysUser.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
	},
	(table) => [uniqueIndex("uk_sys_session_token").on(table.token), index("idx_sys_session_user").on(table.userId)],
);

/**
 * 账号 —— 一个用户可绑多个登录方式(邮箱密码算 `provider_id = 'credential'`),
 * `password` 是 better-auth 自己的 scrypt 哈希,**不可与其它系统的哈希混用**。
 * `(provider_id, account_id)` 唯一:同一来源的同一条外部账号只能绑一次。
 */
export const sysAccount = mysqlTable(
	"sys_account",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		accountId: varchar("account_id", { length: 255 }).notNull(),
		providerId: varchar("provider_id", { length: 64 }).notNull(),
		userId: varchar("user_id", { length: 36 })
			.notNull()
			.references(() => sysUser.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "date" }),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: "date" }),
		scope: varchar("scope", { length: 255 }),
		password: text("password"),
		createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
	},
	(table) => [
		uniqueIndex("uk_sys_account_provider").on(table.providerId, table.accountId),
		index("idx_sys_account_user").on(table.userId),
	],
);

/** 验证码 / 一次性令牌(邮箱验证、改密、二次验证都用这张表) */
export const sysVerification = mysqlTable(
	"sys_verification",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		identifier: varchar("identifier", { length: 255 }).notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
	},
	(table) => [index("idx_sys_verification_identifier").on(table.identifier)],
);
