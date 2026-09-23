import { int, mysqlTable, text, timestamp } from "drizzle-orm/mysql-core";

/**
 * **迁移管辖**的表 —— `drizzle.config.ts` 的 `schema` 只指向本文件,`pnpm db:generate` / `db:migrate` 管这里。
 *
 * 这里只剩模板的示例表 `todos`。**其它表都不在本文件**,分两组口径,不要混:
 *
 *  1. **系统表九张**:`src/db/data-base-schema.ts` —— 五张系统设置(`sys_menu` / `sys_dict` / `sys_para` /
 *     `sys_tag` / `sys_tag_relation`)+ **认证四张**(`sys_user` / `sys_session` / `sys_account` /
 *     `sys_verification`,Better Auth 内核)。它们只声明「读写的形状」、**不进迁移**
 *     (库里已存在,进了 1050 报错);DDL 由 `scripts/create-system-tables.ts`(MySQL)与
 *     `scripts/create-better-auth-tables-dm.ts`(达梦)维护。
 *
 * 两条硬约定(对 `data-base-schema.ts` 里的认证四表仍然成立):
 *  - **Better Auth 四表的模型名 / 字段名不可改**(传给 adapter 的键必须是 `user` / `session` / `account` /
 *    `verification`,列名是 `email_verified` / `expires_at` / `provider_id` …)。改了 better-auth 会在运行时报
 *    「找不到字段」,`pnpm typecheck` 抓不到 —— 映射点见 `src/lib/auth.ts`。
 *  - **时间列口径**:认证四表沿用 better-auth 的 `created_at` / `updated_at`;系统设置五表用
 *    `create_time` / `update_time`;两批表不互相引用。
 *
 * ⚠️ **RBAC 五表(`role` / `permission` / `user_role` / `role_permission` / `user_permission`)已下线**:
 * RBAC 已实装,表在 `data-base-schema.ts`(部门 / 角色 / 成员 / 角色→菜单),不在这个文件里
 * (原先那份内存 mock 已整体删除,不摆假数据)。
 */

// ══ 二、RBAC 权限模型 —— 已下线(2026-09)═════════════════════
//
// `role` / `permission` / `user_role` / `role_permission` / `user_permission` 五张表**已删除**:
// 本轮不做 RBAC,后期再加。原有的种子脚本 `scripts/seed-permissions.ts` 一并删除。
//
// **前端页面状态**:系统设置七页全部接真实数据(用户 / 部门 / 角色三页在 `data-base-schema.ts` 的那批表上)——
// 原先撑着它们的 `src/mocks/settings.ts`(纯内存 mock)已整体删除,页面不再摆假数据。
// 后期真做 RBAC 时,把定义加回这里 + 重建种子脚本 + 把这三页接到真实接口即可。

// ══ 三、模板示例表(删 demo 时一并删)═════════════════════════

export const todos = mysqlTable("todos", {
	id: int().primaryKey().autoincrement(),
	title: text().notNull(),
	createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});
