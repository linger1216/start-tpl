import { boolean, index, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * 数据库表结构(drizzle 的**唯一真源**)。
 *
 * 分两组,口径不同,不要混:
 *
 *  1. **系统设置三表**:`src/db/data-base-schema.ts` 定义 `sys_menu` / `sys_dict` / `sys_config`,
 *     只声明「读写的形状」、**不进迁移**(库里已存在,进了会 1050 报错)。
 *     本文件(下面这份)才是迁移管辖的范围。
 *
 *  2. **认证(系统层)**:`user` / `session` / `account` / `verification`(Better Auth 内核四表)。
 *     由本文件 + `./drizzle` 迁移管理,字段与文档见 `doc/表结构设计.md` §11。
 *
 * 两条硬约定:
 *  - **Better Auth 四表的模型名 / 字段名不可改**(`user` / `session` / `account` / `verification`,
 *    以及 `emailVerified` / `expiresAt` / `providerId` …)。DB 列名走 snake_case,drizzle 负责映射;
 *    改了字段名 better-auth 会在运行时报「找不到字段」,`pnpm typecheck` 抓不到。
 *  - **时间列用法**:认证四表用 better-auth 的 `created_at` / `updated_at` 口径(与 `todos.created_at` 一致);
 *    系统设置三表统一用 `create_time` / `update_time`;认证四表沿用 better-auth 的 `created_at` / `updated_at`,
 *    两批表不互相引用。
 *
 * ⚠️ **RBAC 五表(`role` / `permission` / `user_role` / `role_permission` / `user_permission`)已下线**:
 * 本轮不做 RBAC,后期再加;前端「用户管理 / 用户组管理 / 角色管理」三页现在只是**待实现占位页**
 * (原先那份内存 mock 已整体删除,不摆假数据)。
 */

// ══ 一、Better Auth 内核四表 ═══════════════════════════════════

/** 用户 —— better-auth `user` 模型;业务字段(账号 / 手机号 / 部门 / 状态)见 §11 的待补充项 */
export const user = mysqlTable("user", {
	id: varchar("id", { length: 36 }).primaryKey(),
	name: varchar("name", { length: 128 }).notNull(),
	email: varchar("email", { length: 255 }).notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: varchar("image", { length: 512 }),
	createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
});

/** 会话 —— 每个登录设备 / 浏览器一行;`user_id` 级联删除 */
export const session = mysqlTable(
	"session",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		token: varchar("token", { length: 255 }).notNull().unique(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: varchar("user_id", { length: 36 })
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
	},
	(table) => [index("idx_session_user").on(table.userId)],
);

/**
 * 账号 —— 一个用户可绑多个登录方式(邮箱密码算 `provider_id = 'credential'`),
 * `password` 是 better-auth 自己的 scrypt 哈希,**不可与其它系统的哈希混用**。
 * `(provider_id, account_id)` 唯一:同一来源的同一条外部账号只能绑一次。
 */
export const account = mysqlTable(
	"account",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		accountId: varchar("account_id", { length: 255 }).notNull(),
		providerId: varchar("provider_id", { length: 64 }).notNull(),
		userId: varchar("user_id", { length: 36 })
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
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
		uniqueIndex("uk_account_provider").on(table.providerId, table.accountId),
		index("idx_account_user").on(table.userId),
	],
);

/** 验证码 / 一次性令牌(邮箱验证、改密、二次验证都用这张表) */
export const verification = mysqlTable(
	"verification",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		identifier: varchar("identifier", { length: 255 }).notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
	},
	(table) => [index("idx_verification_identifier").on(table.identifier)],
);

// ══ 二、RBAC 权限模型 —— 已下线(2026-09)═════════════════════
//
// `role` / `permission` / `user_role` / `role_permission` / `user_permission` 五张表**已删除**:
// 本轮不做 RBAC,后期再加。原有的种子脚本 `scripts/seed-permissions.ts` 一并删除。
//
// **前端页面状态**:「系统设置 ▸ 用户管理 / 用户组管理 / 角色管理」三页现在是**待实现占位页** ——
// 原先撑着它们的 `src/mocks/settings.ts`(纯内存 mock)已整体删除,页面不再摆假数据。
// 后期真做 RBAC 时,把定义加回这里 + 重建种子脚本 + 把这三页接到真实接口即可。

// ══ 三、模板示例表(删 demo 时一并删)═════════════════════════

export const todos = mysqlTable("todos", {
	id: int().primaryKey().autoincrement(),
	title: text().notNull(),
	createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});
