/**
 * **系统表**的 drizzle 定义 —— 十九张:
 *  - 系统设置五张:`sys_menu` / `sys_dict` / **`sys_para`**(参数,旧名 `sys_config`)/ `sys_tag`(标签树)/
 *    `sys_tag_relation`(标签 ↔ 业务对象 的关系);
 *  - 认证四张(Better Auth 内核):`sys_user` / `sys_session` / `sys_account` / `sys_verification`;
 *  - 权限四张:`sys_dept` / `sys_role` / `sys_user_dept` /
 *    **`sys_casbin_rule`**(功能权限策略:谁有哪些角色 + 角色能进哪些菜单,见 `lib/casbin.ts`);
 *  - 数据权限两张:**`sys_data_policy`**(谁看到哪些行)/ **`sys_data_plugin`**(值域插件登记;
 *    加 / 改插件不用重启,见 `lib/data-scope.ts` + `lib/data-scope-plugins.ts`);
 *  - 运行记录三张:`sys_notice`(通知)/ `sys_log`(审计日志)/ `sys_file`(文件元数据);
 *  - 示例一张:**`demo_grid`**(演示业务;唯一不带 `sys_` 前缀的表)。
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
 *  - `sys_dict` 全系统共用的字典(`dict.byCode` 按编码取值);
 *  - `sys_para` 「系统设置 ▸ 参数管理」的数据源(`para_key` / `para_value` / `para_type`);
 *  - `sys_tag` / `sys_tag_relation` 标签体系与"对象打了哪些标签"。
 *
 * 时间列(`created_at` / `updated_at`)由 DDL 的 `DEFAULT CURRENT_TIMESTAMP`
 * / `ON UPDATE CURRENT_TIMESTAMP` 提供 —— drizzle 的 mysql `datetime` 没有
 * `defaultNow` / `onUpdateNow`,所以这里不写,留给 MySQL 填。
 *
 * ⚠️ **API 协议 vs DB 列名的分层**:DB 走 snake_case;前端 API 协议(本文件 consumer)
 * 走 camelCase,翻译点在 `src/integrations/trpc/routers/{menu,dict,para,tag}.ts`。
 */
import {
	bigint,
	boolean,
	char,
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
		/**
		 * 1 目录 / 2 菜单 / 3 按钮。
		 *
		 * 按钮不是导航 —— 它**只是权限点**(`perm` 才是程序认的键),侧边栏要把它排除掉
		 * (`buildNavTree` 里那一条过滤),角色授权时它作为叶子出现在权限树里。
		 * 现有行全是 2(菜单):加这一列不改变任何既有行为。
		 */
		type: tinyint("type").notNull().default(2),
		/** 权限标识(如 `sys:role:write`);前端 `useHasPerm()` 认的就是它。按钮必填,目录/菜单可空 */
		perm: varchar("perm", { length: 64 }),
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
		created_at: datetime("created_at", { mode: "date", fsp: 3 }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date", fsp: 3 }).$defaultFn(() => new Date()),
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
	},
	(table) => [
		index("idx_sys_menu_parent_sort").on(table.parent_id, table.sort),
		uniqueIndex("uk_sys_menu_path").on(table.path),
	],
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
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
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
		/** 参数名,如 `log.enabled` —— **主键** */
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
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
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
		created_at: datetime("created_at", { mode: "date", fsp: 3 }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date", fsp: 3 }).$defaultFn(() => new Date()),
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
	},
	(table) => [index("idx_sys_tag_parent_sort").on(table.parent_id, table.sort)],
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
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
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
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
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

/**
 * 登录失败计数 + 锁定(`email` 唯一) —— 模板里硬写的防爆破风控。
 *
 * 语义(详见 `lib/auth-lockout.ts` 的注释):
 *  - `failed_attempts` 累计连续失败次数(成功登录清零);
 *  - `locked_until` 超过阈值(默认 5)时被置 15 分钟后的未来时刻;
 *    期间内任何 /sign-in/email 走 `hooks.before` 拦截,直接抛 429(实测比 401 更准确);
 *  - `last_failed_at` / `last_ip` 仅作审计,告警阈值由业务另设(本模板不内置异常监控)。
 *
 * 为什么放在 better-auth 模型之外:better-auth 没有 `failedAttempts` 这个内置字段,
 * 自己加列会污染 `user` 模型(违反 §11.1「BA 写死四表」的原则),放一张独立表更轻。
 * `email` 唯一 ⇒ 同一邮箱最多一行;第一次失败走 INSERT 或 ON DUPLICATE。
 */
export const sysAccountLockout = mysqlTable(
	"sys_account_lockout",
	{
		email: varchar("email", { length: 255 }).primaryKey(),
		failedAttempts: int("failed_attempts").notNull().default(0),
		lockedUntil: timestamp("locked_until", { mode: "date" }),
		lastFailedAt: timestamp("last_failed_at", { mode: "date" }),
		lastFailedIp: varchar("last_failed_ip", { length: 64 }),
	},
	(table) => [index("idx_sys_account_lockout_until").on(table.lockedUntil)],
);

/**
 * 限流计数(better-auth 的 `secondaryStorage` 落地表 —— A1)
 *
 * - `key` 主键 + `count` 当前计数 + `expires_at` 过期时刻;
 * - 派生原子写 `seconds * 1000` 时刻 TTL(BA 的 `increment(key, ttl)` 只在**首次创建**时生效,
 *   后续增加不延长窗口);
 * - `src/lib/rate-limit-storage.ts` 把这张表包成 BA 的 `SecondaryStorage` 接口;
 * - 配合 `src/lib/auth.ts` 的 `rateLimit.customRules`,挂在 `/sign-in/*` 等端点上做
 *   「IP + 端点」粒度的滑动窗口限流 —— 内存版重启就清零,db 版多副本 / 进程崩溃都共享计数。
 *
 * 为什么不复用 better-auth 内置 `rateLimitSchema`(`@better-auth/core` 里有但没暴露 drizzle adapter
 * 生成脚本):模板期望「db:create 一条龙搞定」,靠内置 schema 反而要绕一圈;自己建表简单一行。
 */
export const sysRateLimit = mysqlTable("sys_rate_limit", {
	key: varchar("key", { length: 191 }).primaryKey(),
	count: int("count").notNull().default(0),
	value: text("value"),
	expiresAt: timestamp("expires_at", { mode: "date" }),
});

// ── 权限(部门 / 角色)────────────────────────────────────
//
// 模型(与 better-auth 的 organization **无关** —— 那套是"选中一个当前组织 + 租户隔离",
// 这里是"同时属于多个部门 + 权限取并集",语义不同,所以走项目自己的 `sys_*` 表):
//
//   sys_dept(树)                                    上海公司 / 武汉公司(可嵌套)
//   sys_role(全局定义)                                     管理员 / 员工 / 开发 …  ← 不随部门数增长
//   sys_user_dept(user_id, department_id)            张三:上海、武汉(角色不在这里)
//   sys_casbin_rule:g(user, role)                        张三 → 管理员(**权限 = 这些角色的并集**)
//   sys_casbin_rule:p(role, menu)                        角色能看见哪些菜单 / 能用哪些按钮
//
// 为什么角色是**全局定义**而不是"每个部门各建一套":后者会让角色行数 = 部门数 × 角色种类
// (上海管理员 / 武汉管理员 / …)。全局定义 + 分配时带部门,4 种角色在 100 个部门里也只有 4 行。
//
// 下面这张 `sys_user_dept` 承载"我属于哪些组织"(真实项目里由区里**每天推送覆盖**);
// **借调** = 给这个人再加一条指向对方的规则(不动编制,推送也冲不掉)—— 见 `doc/rbac-权限模型.md`。

/** 部门树(组织架构;形状对齐 `sys_menu` / `sys_tag`) */
export const sysDept = mysqlTable(
	"sys_dept",
	{
		id: varchar("id", { length: 32 }).primaryKey(),
		parent_id: varchar("parent_id", { length: 32 }),
		name: varchar("name", { length: 64 }).notNull(),
		sort: int("sort").notNull().default(0),
		status: tinyint("status").notNull().default(1),
		remark: varchar("remark", { length: 255 }),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
	},
	(table) => [index("idx_sys_department_parent_sort").on(table.parent_id, table.sort)],
);

/**
 * 角色(全局定义)。
 *
 * ⚠️ **同级/同部门重名不靠唯一索引**:`unique(parent_id, name)` 这类约束在 MySQL 上
 * 对 `parent_id is null`(顶级)不生效,是半吊子约束 —— 一律在 procedure 里查重。
 *
 * 角色**没有 `code` 列**:程序内部一律用 `id`(`varchar(32)` nanoid)引用 —— 策略表
 * `sys_casbin_rule.v0/v1` 里直接写 `role:<id>`,不必再维护一层"角色编码 → id"的映射。
 * 界面上按 `name` 展示,唯一性由 `uk_sys_role_name` 保证。
 */
export const sysRole = mysqlTable(
	"sys_role",
	{
		id: varchar("id", { length: 32 }).primaryKey(),
		name: varchar("name", { length: 32 }).notNull(),
		sort: int("sort").notNull().default(0),
		status: tinyint("status").notNull().default(1),
		remark: varchar("remark", { length: 255 }),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
	},
	(table) => [uniqueIndex("uk_sys_role_name").on(table.name)],
);

/**
 * 部门成员 —— "谁在哪个部门"。**只管组织架构,不携带角色**。
 *
 * 角色是**全局定义**的,和人属于哪个部门无关 —— 所以这里没有 `role_id`,
 * 用户与角色的关系在 `sys_casbin_rule` 的 `g` 行(`user:<id>` → `role:<id>`)。
 * `uk_sys_dm_unique(department_id, user_id)`:一个人不能重复加入同一个部门
 * (两个列都 not null,所以这个唯一键是真实生效的)。
 */
export const sysUserDept = mysqlTable(
	"sys_user_dept",
	{
		id: varchar("id", { length: 32 }).primaryKey(),
		department_id: varchar("department_id", { length: 32 })
			.notNull()
			.references(() => sysDept.id, { onDelete: "cascade" }),
		user_id: varchar("user_id", { length: 32 })
			.notNull()
			.references(() => sysUser.id, { onDelete: "cascade" }),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [
		uniqueIndex("uk_sys_dm_unique").on(table.department_id, table.user_id),
		index("idx_sys_dm_user").on(table.user_id),
	],
);

/**
 * **功能权限(Casbin 的策略表)** —— 「谁有哪些角色」与「角色能进哪些菜单 / 按哪些按钮」
 * 共用这一张表,Casbin 同时充当**策略存储**与**判定引擎**(模型与领域函数见 `lib/casbin.ts`)。
 *
 * 列名用 Casbin 的通用形状(`ptype` + 一串值),因为装载走 `loadPolicy`、
 * 写入走 `addPolicy(sec, ptype, rule)`:一行 = 一个 `ptype` + 若干值。
 *
 * | 列 | `p`(角色 → 权限) | `g`(用户 → 角色 / 角色 → 角色) |
 * | --- | --- | --- |
 * | `v0` sub | `role:<角色 id>` | `user:<用户 id>` 或 `role:<角色 id>` |
 * | `v1` obj | `menu:<菜单/按钮 id>` | `role:<角色 id>` |
 * | `v2` act | `access` | 空串 |
 *
 * ⚠️ **为什么 `v1` 存的是 `menu:<id>` 而不是权限码**:`sys_menu` 里目录 / 菜单 / 按钮
 * 是同一棵树、同一张表(`type` 1/2/3),勾选态必须按菜单 id 回读;而判定要的是权限码
 * (`sys:user:add` / `page:settings_users:view`)。两件事在 `loadPolicy` 里**当场展开**
 * (一个 `menu:<id>` 展开成 `menu:<id>` + 该行 `perm` + `pagePermOf(path)` 三条候选 obj,
 * 只在内存里,不落库),所以库里始终只有菜单 id 这一种写法 —— 改菜单 `perm` 不用回刷策略行。
 *
 * ⚠️ 因此**菜单增 / 删 / 改 / 排序后必须 `clearCasbinCache()`**(`lib/casbin.ts`):
 * 展开结果跟着 `sys_menu` 变,而这张表一行没动,不刷缓存就会拿旧快照判定。
 *
 * ⚠️ 删菜单时**没有外键兜底**(Casbin 的行不是关系行,MySQL 也不会替我们级联)——
 * `routers/menu.ts` 的 `delete` 必须显式调 `removeMenuPolicies(id)`。
 */
export const sysCasbinRule = mysqlTable(
	"sys_casbin_rule",
	{
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 规则类型:`p`(策略行)/ `g`(角色成员与继承) */
		ptype: varchar("ptype", { length: 8 }).notNull(),
		v0: varchar("v0", { length: 80 }).notNull(),
		v1: varchar("v1", { length: 128 }).notNull(),
		v2: varchar("v2", { length: 16 }).notNull().default(""),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [
		uniqueIndex("uk_sys_casbin_rule").on(table.ptype, table.v0, table.v1, table.v2),
		index("idx_sys_casbin_rule_v0").on(table.ptype, table.v0),
		index("idx_sys_casbin_rule_v1").on(table.ptype, table.v1),
	],
);

/**
 * 文件元数据 —— **字节存 MinIO,这里只存元数据**(见 `doc/文件管理.md`)。
 *
 * ⚠️ 只存 `bucket` + `object_key`,**绝不存 URL**:URL 会过期、换对外域名就全废,
 * 要 URL 的时候当场签(公开桶拼直链 / 私有桶签预签名 GET)。
 *
 * `status` 是三态而非软删时间列:上传是**两阶段**的,`0` 是"签发了但还没传上来"的正常中间态,
 * 清理任务就按 `(status, created_at)` 扫它。
 */
/**
 * 站内通知 —— 一条通知**只属于一个收件人**,所以「已读」就是这一行的 `read_at`:
 * 零附带表、零联合查询(群发 = 多插几行,`lib/notice.ts` 的 `notifyMany`)。
 *
 * 发送只在**服务端**发生(`lib/notice.ts` 的 `notify`),没有公开的创建接口 ——
 * 站内通知不该被前端随便造。
 */
export const sysNotice = mysqlTable(
	"sys_notice",
	{
		/** 主键:nanoid */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 收件人 —— 所有查询都以它为第一条件(别人的通知在 SQL 层就碰不到) */
		user_id: varchar("user_id", { length: 32 }).notNull(),
		/** 标题(一行字) */
		title: varchar("title", { length: 128 }).notNull(),
		/** 可选正文 */
		body: varchar("body", { length: 255 }),
		/** 点击后跳转的**站内路径**(如 `/settings/files`);写入时校验必须 `/` 开头 */
		path: varchar("path", { length: 255 }),
		/** info / success / warn / danger —— 决定图标与颜色(走 DESIGN 的语义色) */
		level: varchar("level", { length: 16 }).notNull().default("info"),
		/** null = 未读 */
		read_at: datetime("read_at", { mode: "date" }),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [index("idx_sys_notice_user").on(table.user_id, table.read_at, table.created_at)],
);

/**
 * 审计日志 —— **只增不改**:每一次「写调用」是谁、什么时候、对什么、成功没有。
 *
 * 它由 `init.ts` 的 `auditMiddleware` **结构性**写入(不靠每个 resolver 记得加);
 * 只记 mutation,默认跳过 `page.*` 这类高频 UI 偏好写入(见 `lib/audit.ts` 与 `doc/审计日志.md`)。
 */
export const sysLog = mysqlTable(
	"sys_log",
	{
		/** 主键:nanoid */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 与后端 stdout 日志同值 —— 一条审计能对上一次调用的全部日志 */
		trace_id: varchar("trace_id", { length: 32 }),
		/** tRPC 路径(如 `role.create`) */
		path: varchar("path", { length: 64 }).notNull(),
		/** 中文动作名(`lib/audit.ts` 的映射表给出,查不到落回 path) */
		label: varchar("label", { length: 64 }),
		/** query / mutation(只有 mutation 入库,留着便于将来放开) */
		type: varchar("type", { length: 16 }),
		/** 操作人(脚本 / 测试直调时为 null) */
		operator_id: varchar("operator_id", { length: 32 }),
		/** 操作人姓名**快照** —— 账号将来被删,历史记录仍读得懂 */
		operator_name: varchar("operator_name", { length: 64 }),
		/** 来源 IP(从请求头取;无请求上下文为 null) */
		ip: varchar("ip", { length: 64 }),
		/** 目标描述:**尽力而为**(从入参挑 id / ids / key,见 `describeTarget`) */
		target: varchar("target", { length: 255 }),
		/** 1 成功 / 0 失败(失败也包含权限被拒) */
		status: tinyint("status").notNull().default(1),
		error_code: varchar("error_code", { length: 48 }),
		error_message: varchar("error_message", { length: 255 }),
		/** **脱敏后**的入参快照(截断 2000 字符) */
		input: text("input"),
		/** 这次调用耗时(毫秒) */
		duration_ms: int("duration_ms"),
		/** 审计行不可变 —— 没有 updated_at */
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [
		index("idx_sys_log_time").on(table.created_at),
		index("idx_sys_log_operator").on(table.operator_id, table.created_at),
		index("idx_sys_log_path").on(table.path, table.created_at),
	],
);

/**
 * Demo:综合网格履职。
 *
 * 字段只保留方案里说的那几个 —— Excel 后面 17 列月度统计**不建**。
 * `town_id`(街镇)/ `owner_id`(负责人)本身只参与展示 / 筛选 / 统计,
 * 是**数据权限**(`sys_data_policy` + `sys_data_plugin`)拿它们当判据列来筛行,才产生过滤效果 ——
 * 也就是说:表结构里没有硬编码的过滤条件,过滤条件全在数据权限规则里(见 `doc/数据权限.md`)。
 * 这张表的注释是 `scripts/sync-table-meta.ts` 里那三行,改了记得两边一起改。
 */
export const sysDemoGrid = mysqlTable(
	"demo_grid",
	{
		/** 主键:nanoid */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 网格名称(就是片区名:中春片区 / 九星片区 …) */
		name: varchar("name", { length: 64 }).notNull(),
		/** 所属街镇(Excel 原样文本,便于列表直接展示) */
		town_name: varchar("town_name", { length: 32 }),
		/** 所属街镇 → `sys_dept.id`(行级数据权限的筛选键:插件按「我的部门及以下」命中它) */
		town_id: varchar("town_id", { length: 32 }),
		/** 网格长姓名(Excel 原样;92 位真实姓名里没几个能对上账号,所以另存 owner_id) */
		owner_name: varchar("owner_name", { length: 32 }),
		/** 负责人 → `sys_user.id`(行级数据权限的筛选键,与 town_id 同一套) */
		owner_id: varchar("owner_id", { length: 32 }),
		/** 工作职务(Excel 原样) */
		duty: varchar("duty", { length: 64 }),
		remark: varchar("remark", { length: 255 }),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
	},
	(table) => [index("idx_demo_grid_town").on(table.town_id), index("idx_demo_grid_owner").on(table.owner_id)],
);

export const sysFile = mysqlTable(
	"sys_file",
	{
		/** 主键:nanoid(见 `lib/ids.ts` 的 `newId()`) */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 桶名:`app-public` 公开直链 / `app-private` 私有预签名 —— **公开还是私有由它决定** */
		bucket: varchar("bucket", { length: 64 }).notNull(),
		/** 对象键:`{yyyy}/{MM}/{nanoid}.{ext}`(不用原文件名,躲开中文 / 特殊字符 / 重名) */
		object_key: varchar("object_key", { length: 512 }).notNull(),
		/** 原始文件名(下载时进 `Content-Disposition`) */
		origin_name: varchar("origin_name", { length: 255 }).notNull(),
		/** 小写后缀(不带点),便于按类型筛 */
		ext: varchar("ext", { length: 16 }),
		/** MIME 类型:`confirm` 时以对象存储回的为准,**不信客户端** */
		content_type: varchar("content_type", { length: 128 }),
		/** 字节数:`confirm` 时 `statObject` 校准 */
		size: bigint("size", { mode: "number" }).notNull().default(0),
		/** 内容 sha256 —— **仅元数据 / 查重钩子,不自动去重**(真要做秒传才加引用计数) */
		hash: char("hash", { length: 64 }),
		/** 0 待确认 / 1 正常 / 2 已删除 */
		status: tinyint("status").notNull().default(0),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [
		uniqueIndex("uk_sys_file_object").on(table.bucket, table.object_key),
		index("idx_sys_file_status").on(table.status, table.created_at),
		index("idx_sys_file_hash").on(table.hash),
	],
);

// ── 数据权限 ─────────────────────────────────────────────
//
// 只解决一件事:**list 的可见性**(这一行看不看得见)。只读 / 可编辑是**功能权限**
// (Casbin 在管),所以下面两张表里没有动作(action)概念 —— 别把它们和 RBAC 混起来。
//
// 与功能权限的第三层(读接口的 `PERM_BY_PATH`)是并行的两道闸:那个管"能不能调这个接口",
// 这里管"调了能看到哪些行"。求值在 `lib/data-scope.ts`,值域在 `lib/data-scope-plugins.ts`。

/**
 * 数据权限**规则** —— 一行 = 主体 + 资源 + (列 | 整行) + 值域插件 + 插件参数。形状:
 *
 *   `<资源表>.<列> in 插件(我)`           -- 插件产出 `value`
 *   `<资源表>.<主键> in 插件(我, 资源)`    -- 插件产出 `row`(逐行授权)
 *   (不配插件)                             -- 整类可见
 *
 * 三条的唯一判据在 `lib/data-scope-spec.ts` 的 `validatePolicyCombo()`(`column` 可空是刻意的)。
 *
 * ⚠️ **只存角色的 id,不存角色里的人**:`subject = role:<id>`,请求时才展开成"我有哪些角色"
 * ⇒ 角色加人减人不用回来改策略行。**这张表应该长期只有几十行**;涨到几千行,说明它被当成
 * 人员名单用了 —— 那是 `sys_user_dept` / Casbin 的 `g` 行该干的事。
 *
 * ⚠️ `column` 是 **MySQL 保留字**:裸写 SQL 时必须加反引号(drizzle 生成的语句会自动加)。
 */
export const sysDataPolicy = mysqlTable(
	"sys_data_policy",
	{
		/** 主键:nanoid */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 0 停用 / 1 启用 */
		status: tinyint("status").notNull().default(1),
		/** `*`(所有人)/ `user:<id>` / `role:<id>` / `dept:<id>` —— 见 `data-scope-spec.ts` 的 `parseSubject()` */
		subject: varchar("subject", { length: 48 }).notNull(),
		/** 资源 = 库里一张业务表的名字(如 `demo_grid`);界面上从 `information_schema` 里选 */
		resource: varchar("resource", { length: 64 }).notNull(),
		/** 拿资源的哪一列去比;插件产出 `row`(或整类可见)时留空 */
		column: varchar("column", { length: 64 }),
		/**
		 * 从值域插件的输出行里**取哪个 key** 的值去比(m23422)。
		 *
		 * 插件每行形如 `{ key: value }`(内置的是 `id` / `name` / `value`,自建「清单」是自己填的
		 * `town_id` / `risk_level` 之类),这一列说"这条规则认哪一类 key":
		 * `<column> in 插件的行[key]`。留空 = 老规则(NULL),引擎按 `<column>` 当 key 推断、
		 * 再兜 `value` —— 只为兼容旧行,表单保存时一定会写上一个具体 key。
		 */
		value_key: varchar("value_key", { length: 64 }),
		/** 值域插件的 key(内置四个 + `sys_data_plugin` 里登记的);留空 = 整类可见 */
		plugin_key: varchar("plugin_key", { length: 64 }),
		remark: varchar("remark", { length: 255 }),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
	},
	(table) => [index("idx_sys_data_policy_resource").on(table.resource, table.status)],
);

/**
 * 数据权限的**值域插件登记** —— 规则的右半边。
 *
 * **v2(m20034)起**:这张表登记**只能是「指定清单」(fixed)类**插件,
 * 由用户在表单里**逐行手填** `[{key,value}]`(走 `data-scope-spec.ts` 的
 * `parseItems` / `checkRuleItems` + `PLUGIN_ITEMS_MAX` / `PLUGIN_ITEM_*_MAX`)。
 *
 * 函数体(`new Function` 那套)**不再让用户编辑** —— 那是地基内置插件的事,
 * 在 `lib/data-scope-plugins.ts` 的代码里:`self` / `my_departments` /
 * `my_dept_ancestors` / `my_street` 四个。**规则下拉里**会同时显示这 4 个内置 +
 * 这张表里的所有 fixed 插件。
 *
 * 引擎(`lib/data-scope.ts` 的 `compileRule`)读规则时,直接拿 `row.output_values`
 * 拼 SQL,不再从规则行带任何「参数」过来 —— 「值」是**插件的属性**,不是规则的属性
 * (user 在 m20034 明确「数据范围里不需要输出值, 所有的值都在值域插件里面」)。
 */
export const sysDataPlugin = mysqlTable(
	"sys_data_plugin",
	{
		/** 主键:nanoid */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** 小写字母 / 数字 / 下划线,全局唯一 —— 策略行的 `plugin_key` 指向它 */
		plugin_key: varchar("plugin_key", { length: 64 }).notNull(),
		/** 界面名(如「用户的街镇」) */
		label: varchar("label", { length: 64 }).notNull(),
		/**
		 * 「指定清单」(`v2` 起新列):`[{key, value}]`,每行一个 `key/value`。
		 * - `key` 是「这行属于哪一类」(如 `town_id` / `risk_level`,任意字符串,
		 *   引擎不挑它去用它做 SQL 关键字 —— 引擎读规则行的 `column`);
		 * - `value` 是「这条规则在那一类里允许的值」(如 `310112003`)。
		 * 引擎按 `data-rule.value` 拼 SQL 的 `in (...)`,再丢到 `column` 列上去比。
		 * 读回来可能是字符串,一律走 `parseItems()` 兜底。
		 */
		output_values: json("output_values"),
		/** 0 停用 / 1 启用 */
		status: tinyint("status").notNull().default(1),
		remark: varchar("remark", { length: 255 }),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
		/** 软删除时间(null = 未删除);口径与理由见 `lib/soft-delete.ts` */
		deleted_at: datetime("deleted_at", { mode: "date" }),
	},
	(table) => [uniqueIndex("uk_sys_data_plugin_key").on(table.plugin_key)],
);

// ── 任务闭环(tc_close)─────────────────────────────────
//
// 三张表都是「不进 drizzle 迁移」,理由同本文件头注释;DDL 由
// `scripts/create-system-tables.ts` 维护(走 `pnpm db:create`),列注释由
// `scripts/sync-table-meta.ts` 维护 —— 别在下面 DDL 字面上塞 COLUMN COMMENT,
// 两边都写必然漂移。
// 详细设计:`doc/task-close.md`。

/** 状态图模板(payload 装整套 statuses / initial / edges 定义)。 */
export const taskCloseWorkflow = mysqlTable("tc_workflow", {
	id: varchar("id", { length: 191 }).primaryKey(),
	payload: json("payload").notNull(),
	created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
	updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
	deleted_at: datetime("deleted_at", { mode: "date" }),
});

/**
 * 任务本体 —— `workflow` 列是创建时从 `tc_workflow.payload` 复制的状态图快照;
 * 之后 `tc_workflow` 表怎么改都不影响已建任务。
 * `payload` 是用户自定义业务数据(JSON,可空)。
 * 软删:`deleted_at` 直接接 `lib/soft-delete.ts` 的 `alive()` / `softDeleted()`。
 *
 * `priority` —— `tinyint(1)` 存数字档位:`0` = P0(最高)、`1` = P1(高)、`2` = P2(普通);
 * 映射见 `lib/task-close-spec.ts` 的词表。允许 null:老数据没有,新建时可空。
 */
export const taskCloseTask = mysqlTable(
	"tc_task",
	{
		id: varchar("id", { length: 191 }).primaryKey(),
		name: varchar("name", { length: 255 }).notNull(),
		description: text("description"),
		status: varchar("status", { length: 32 }).notNull(),
		creator_id: varchar("creator_id", { length: 191 }).notNull(),
		due_at: datetime("due_at", { mode: "date" }),
		/** `0` = P0 / `1` = P1 / `2` = P2;null = 未设置 */
		priority: tinyint("priority"),
		payload: json("payload"),
		workflow: json("workflow").notNull(),
		deleted_at: datetime("deleted_at", { mode: "date" }),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [
		// DB 现状:`idx_task_status_created` 只索引 status(单列);`idx_task_creator_status` 双列索引保留
		index("idx_task_status_created").on(table.status),
		index("idx_task_creator_status").on(table.creator_id, table.status),
	],
);

/**
 * 外挂动作(审批 / 征询 / 监督同一种模式)。
 * - `serial_no`:同链共用,等于链首 action 的 id;
 * - `parent_action_id`:根级为 NULL,只有根级能推进 tc_task.status(子 action 的 from/to 必须 NULL);
 * - `is_locking`:挂载期间是否锁住任务状态。
 */
export const taskCloseAction = mysqlTable(
	"tc_action",
	{
		id: varchar("id", { length: 191 }).primaryKey(),
		task_id: varchar("task_id", { length: 191 }).notNull(),
		serial_no: varchar("serial_no", { length: 191 }).notNull(),
		parent_action_id: varchar("parent_action_id", { length: 191 }),
		is_locking: boolean("is_locking").notNull(),
		from_status: varchar("from_status", { length: 32 }),
		to_status: varchar("to_status", { length: 32 }),
		sequence: int("sequence").notNull(),
		created_id: varchar("created_id", { length: 191 }).notNull(),
		handle_id: varchar("handle_id", { length: 191 }).notNull(),
		status: varchar("status", { length: 16 }).notNull(),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [
		index("idx_action_task_serial").on(table.task_id, table.serial_no, table.sequence),
		index("idx_action_handle_status").on(table.handle_id, table.status),
		index("idx_action_parent").on(table.parent_action_id),
	],
);

/**
 * 任务-成员关系表 —— 谁对这个任务有哪些角色。
 *
 * `creator` 是任务固有属性(`tc_task.creator_id`),不入此表。
 * 角色 `participant` / `executor` 由此表维护。
 * 同一用户可同时拥有多个角色 —— UK 是 `(task_id, user_id, role)`,不是 `(task_id, user_id)`。
 * 不加 `deleted_at`(与 `sys_user_dept` 同档;纯关联表真删,审计走 `sys_log`)。
 * 不建外键(惯例:审计保留已删用户 / 已删任务)。
 * 「每个 task 至多 1 个主执行人」靠应用层事务保证;真出过脏数据再加 generated column + 单独 UK。
 */
export const taskCloseMember = mysqlTable(
	"tc_member",
	{
		id: varchar("id", { length: 191 }).primaryKey(),
		task_id: varchar("task_id", { length: 191 }).notNull(),
		// user_id 长度跟 sys_user.id 对齐(36,nanoid 21 字符留余地)
		user_id: varchar("user_id", { length: 36 }).notNull(),
		// varchar(16) + TS 联合类型:与 who 协议同形态,编译期挡拼写错
		role: varchar("role", { length: 16 }).notNull(),
		is_primary: tinyint("is_primary").notNull().default(0),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [
		/** 同一 task + user + role 唯一(同人同角色不重复入) */
		uniqueIndex("uk_member_unique").on(table.task_id, table.user_id, table.role),
		/** 「我作为 X 角色参与了哪些 task」(用户视角入口) */
		index("idx_member_user_role").on(table.user_id, table.role),
		/** 「这个 task 上的 X 角色有哪些人」(任务详情) */
		index("idx_member_task_role").on(table.task_id, table.role),
		/** 「这个 task 的主执行人」(dashboard 快查) */
		index("idx_member_task_primary").on(table.task_id, table.is_primary),
	],
);

/**
 * 任务评论 —— 所有可见该 task 的人都能评论(`tc_task.creator` / `tc_member` 任意 role /
 * RBAC 允许访客;svc 层做权限判定)。
 *
 * - `content` 存文字
 * - `attachments` 是 JSON 数组,每项为 `sys_file.id`(varchar 32);字节走 MinIO
 *   复用 `sys_file` 表,**不另建附件表**
 * - 软删:`deleted_at` 非 NULL 行,svc 层 list 过滤,author 或 task.creator 可标记删除
 * - 支持编辑:`updated_at` 自动更新
 */
export const taskCloseComment = mysqlTable(
	"tc_comment",
	{
		id: varchar("id", { length: 191 }).primaryKey(),
		task_id: varchar("task_id", { length: 191 }).notNull(),
		author_id: varchar("author_id", { length: 36 }).notNull(),
		content: text("content").notNull(),
		/** JSON array of sys_file.id(varchar 32 strings);svc 层 join sys_file 取详情 */
		attachments: json("attachments"),
		deleted_at: datetime("deleted_at", { mode: "date" }),
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
		updated_at: datetime("updated_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [
		/** 「这个 task 的评论列表」(按时间倒序) */
		index("idx_comment_task_created").on(table.task_id, table.created_at),
		/** 「我发过的评论」(作者视角) */
		index("idx_comment_author").on(table.author_id),
	],
);

/**
 * 任务闭环**活动日志** —— 只增不改:谁、什么时候、把什么从 A 改成了 B。
 *
 * 与 `sys_log` 的分工(别混):
 *  - `sys_log` 是**全站合规台账**:中间件写、fire-and-forget、粗粒度(path + 尽力而为的 target + 入参快照);
 *  - 本表是**模块业务历史**:各 resolver 在**同一个事务里**写 —— 业务回滚则日志一起没,
 *    业务成功就一定有日志(故意与 `lib/audit.ts` 的"绝不拖累业务"相反,见 `doc/task-close.md`)。
 *
 * 两条口径(改表前先读):
 *  1. `from_status` / `to_status` = 任务状态在**这次事件前后**的值;事件没动状态就双双 NULL
 *     (「这次想去哪」是 `detail.intendedTo`,不要塞进 `to_status`);
 *  2. 一次用户操作 = 一行 —— `taskCreate` 带的初始成员折进 `detail.members`,不另写 `member.add`。
 *
 * 不加 `deleted_at`(流水表,见 `lib/soft-delete.ts`);不加 `updated_at`(不可变)。
 */
export const taskCloseLog = mysqlTable(
	"tc_log",
	{
		/** 主键(nanoid 21 字符;与 `sys_log.id` 同口径 —— 不参与任何外键,不用 191) */
		id: varchar("id", { length: 32 }).primaryKey(),
		/** → tc_task.id(不建外键:审计要留住已删任务) */
		task_id: varchar("task_id", { length: 191 }).notNull(),
		/** 事件码(英文,如 `task.transit` / `action.respond`);中文由前端注册表给,库里不存中文 */
		event: varchar("event", { length: 48 }).notNull(),
		/** 本次事件**之前**的任务状态(value);事件没动状态就是 null */
		from_status: varchar("from_status", { length: 32 }),
		/** 本次事件**之后**的任务状态(value);事件没动状态就是 null */
		to_status: varchar("to_status", { length: 32 }),
		/** 作用对象 id:tc_action.id / tc_comment.id / sys_user.id;`task.*` 事件为 null。类型由 event 决定 */
		target_id: varchar("target_id", { length: 191 }),
		/** 操作人 → sys_user.id */
		actor_id: varchar("actor_id", { length: 36 }).notNull(),
		/** 操作人姓名**快照** —— 账号将来被删,历史仍读得懂(与 sys_log.operator_name 同口径) */
		actor_name: varchar("actor_name", { length: 64 }),
		/** 事件专属补充(结构由 event 判别,见 lib/task-close-log.ts) */
		detail: json("detail"),
		/** 事件时刻 —— **毫秒**精度(一个事务里可能写多行,秒精度会大量撞点) */
		created_at: datetime("created_at", { mode: "date" }).$defaultFn(() => new Date()),
	},
	(table) => [
		/** 详情页主查询:「这个任务最近发生了什么」 */
		index("idx_log_task_created").on(table.task_id, table.created_at),
		/** 「只看状态变化」(流程条) */
		index("idx_log_task_event").on(table.task_id, table.event, table.created_at),
		/** 「我这一周干了什么」(跨任务) */
		index("idx_log_actor").on(table.actor_id, table.created_at),
		/** 「这个动作 / 评论的历史」 */
		index("idx_log_target").on(table.target_id, table.created_at),
	],
);
