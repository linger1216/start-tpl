/**
 * 系统设置三张表(`sys_menu` / `sys_dict` / `sys_config`)的 drizzle 定义。
 *
 * 为什么单独一个文件、而不是并进 `src/db/schema.ts`:
 *   这三张表的 DDL 归属 `doc/表结构设计.sql`,**不进 drizzle 迁移**。
 *   `drizzle.config.ts` 的 `schema` 只指向 `./src/db/schema.ts`(认证四表 + `todos` 示例表);
 *   若把系统设置表并进去,下次 `pnpm db:generate` 会生成 CREATE,而库里已存在
 *   → `pnpm db:migrate` 直接 1050 报错。
 *   所以这里只定义「读写的形状」,迁移边界一行不改。
 *
 * 派生新项目时,这三张表基本可以直接复用:
 *  - `sys_menu` 侧边栏 / 面包屑 / 模块概览的运行时来源(`NAV_NODES` 只是兜底);
 *  - `sys_dict` 全系统共用的字典(`useDict` 读它);
 *  - `sys_config` 「系统设置 ▸ 参数管理」的数据源。
 *
 * 时间列(`create_time` / `update_time`)由 DDL 的 `DEFAULT CURRENT_TIMESTAMP`
 * / `ON UPDATE CURRENT_TIMESTAMP` 提供 —— drizzle 的 mysql `datetime` 没有
 * `defaultNow` / `onUpdateNow`,所以这里不写,留给 MySQL 填。
 *
 * ⚠️ **API 协议 vs DB 列名的分层**:DB 走 snake_case;前端 API 协议(本文件 consumer)
 * 走 camelCase,翻译点在 `src/integrations/trpc/routers/{menu,dict,config}.ts`。
 */
import { datetime, index, int, json, mysqlTable, tinyint, varchar } from "drizzle-orm/mysql-core";

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
		id: varchar("id", { length: 191 }).primaryKey(),
		/** 父菜单 id;null = 一级菜单 */
		parent_id: varchar("parent_id", { length: 191 }),
		name: varchar("name", { length: 191 }).notNull(),
		/** 页面路由;**分组节点为空** */
		path: varchar("path", { length: 191 }),
		/** 图标名(小写 kebab-case,与 `NAV_ICON_MAP` 的键一致);不认识的会退回默认图标 */
		icon: varchar("icon", { length: 191 }),
		/** 同级排序,越小越靠前 */
		sort: int("sort").notNull().default(0),
		/** 1 显示 / 0 隐藏(隐藏的分组连带子树一起不显示) */
		visible: tinyint("visible").notNull().default(1),
		create_time: datetime("create_time", { mode: "date", fsp: 3 }),
		update_time: datetime("update_time", { mode: "date", fsp: 3 }),
	},
	(table) => [index("idx_sys_menu_parent").on(table.parent_id)],
);

// ── 字典表 ───────────────────────────────────────────────

/**
 * 系统字典(`sys_dict`)—— **全系统共用**的一张字典表。
 *
 * 一个字典一行:`id` 是字典编码(如 `entity_category`),`items` 是 `[{label, value}]` 数组。
 * 第一处用途是「下拉候选值的统一来源」;以后接入方式、状态码这类枚举都可以放进来,
 * 不必每个业务再各建一张小表。
 */
export const sysDict = mysqlTable("sys_dict", {
	id: varchar("id", { length: 64 }).primaryKey(),
	name: varchar("name", { length: 128 }).notNull(),
	items: json("items").$type<Array<{ label: string; value: string }> | null>(),
	remark: varchar("remark", { length: 255 }),
	status: tinyint("status").notNull().default(1),
	create_time: datetime("create_time", { mode: "date" }),
	update_time: datetime("update_time", { mode: "date" }),
});

// ── 系统参数表 ────────────────────────────────────────────

/**
 * 系统参数(`sys_config`)—— 「系统设置 ▸ 参数管理」的数据源。
 *
 * 模板内置默认参数(`lib/sys-config.ts` 的 `CONFIG_DEFAULTS`)在库里没记录时生效。
 * 改值不重新发版(运维口径),带 30 秒内存缓存(见 `sys-config.ts` 的 `getConfigMap`)。
 */
export const sysConfig = mysqlTable(
	"sys_config",
	{
		cfg_key: varchar("cfg_key", { length: 64 }).primaryKey(),
		/**
		 * 参数值。**长度必须够放「列可见性 + 顺序」这类 JSON**(实测:24 列就超过 500 字符,
		 * 存不下会被 MySQL 截断 → 界面上"保存了但没生效")。与 tRPC 入参的 zod 上限(4000)对齐。
		 */
		cfg_value: varchar("cfg_value", { length: 4000 }),
		/** int / bool / string */
		value_type: varchar("value_type", { length: 16 }).notNull().default("string"),
		cfg_group: varchar("cfg_group", { length: 32 }),
		/** 给人看的说明(界面直接展示,所以参数要自带文档) */
		remark: varchar("remark", { length: 255 }),
		/** 0 = 代码内置不允许改 */
		editable: tinyint("editable").notNull().default(1),
		create_time: datetime("create_time", { mode: "date" }),
		update_time: datetime("update_time", { mode: "date" }),
	},
	(table) => [index("idx_cfg_group").on(table.cfg_group)],
);
