import { int, mysqlTable, text, timestamp } from "drizzle-orm/mysql-core";

/**
 * **迁移管辖**的表 —— `drizzle.config.ts` 的 `schema` 只指向本文件,`pnpm db:generate` / `db:migrate` 管这里。
 *
 * 这里只剩模板的示例表 `todos`。**其它表都不在本文件**,分两组口径,不要混:
 *
 *  1. **系统表(20 张 `sys_*` + 6 张 `tc_*`)**:`src/db/data-base-schema.ts` —— 五张系统设置
 *     (`sys_menu` / `sys_dict` / `sys_para` / `sys_tag` / `sys_tag_relation`)+ **认证四张**
 *     (`sys_user` / `sys_session` / `sys_account` / `sys_verification`,Better Auth 内核)+
 *     **权限四张**(`sys_dept` / `sys_role` / `sys_user_dept` / `sys_casbin_rule`)+
 *     `sys_file` / `sys_log` / `sys_notice` + 示例表 `demo_grid` + 任务闭环六张 `tc_*`。
 *     它们只声明「读写的形状」、**不进迁移**
 *     (库里已存在,进了 1050 报错);DDL 由 `scripts/create-system-tables.ts`(MySQL)与
 *     `scripts/create-better-auth-tables-dm.ts`(达梦)维护。
 *
 * 两条硬约定(对 `data-base-schema.ts` 里的认证四表仍然成立):
 *  - **Better Auth 四表的模型名 / 字段名不可改**(传给 adapter 的键必须是 `user` / `session` / `account` /
 *    `verification`,列名是 `email_verified` / `expires_at` / `provider_id` …)。改了 better-auth 会在运行时报
 *    「找不到字段」,`pnpm typecheck` 抓不到 —— 映射点见 `src/lib/auth.ts`。
 *  - **时间列口径**:全库统一 `created_at` / `updated_at` / `deleted_at`(`_at` 后缀,不用 `_time`)——
 *    认证四表本来就是 better-auth 那一套,其余表已对齐(见 `doc/task-close.md` 的「时间列约定」);
 *    两批表不互相引用。
 *
 * ⚠️ **RBAC 五表(`role` / `permission` / `user_role` / `role_permission` / `user_permission`)已下线**:
 * RBAC 已实装,表在 `data-base-schema.ts`(部门 / 角色 / 成员 / 角色→菜单),不在这个文件里
 * (原先那份内存 mock 已整体删除,不摆假数据)。
 */

// ══ 二、模板示例表(删 demo 时一并删)═════════════════════════

export const todos = mysqlTable("todos", {
	id: int().primaryKey().autoincrement(),
	title: text().notNull(),
	createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});
