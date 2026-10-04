/**
 * 软删除的统一口径 —— **一处定义,各域照抄**。
 *
 * 为什么统一(而不是每个 router 各写一遍):
 *  - 「删除」在后台模板里到处都是(用户 / 角色 / 部门 / 字典 / 参数 / 菜单 / 标签 / 文件 /
 *    数据范围 / 值域插件 …),硬删一行 = 审计日志里只剩下一串 id,谁也说不清删了什么;
 *  - 软删之后「读」这一侧必须处处带上 `alive(表)`,漏一处就把已删除的行暴露给用户
 *    (列表 / 下拉 / 树 / 详情 / 导出 / 权限引擎 …)。所以条件是**一个函数**,不是一段 SQL 片段,
 *    漏写时在 review 里一眼能看出来,也方便全局 `grep`。
 *
 * 约定(改库时必须同步三处:`src/db/data-base-schema.ts` +
 * `scripts/create-system-tables.ts` + `scripts/create-better-auth-tables-dm.ts`):
 *  - 列固定叫 `deleted_at`(drizzle 属性 `deleted_at`,跟 schema 里其它列一样用蛇形名),`datetime NULL` 且**可空**;
 *    `NULL` = 还活着,非 `NULL` = 删除时刻(UTC,与全项目的 `$defaultFn(() => new Date())` 同口径)。
 *  - 纯关联表 / 会话 · 令牌 · 日志这类**运维表不加**:它们要么跟着主行一起重放(会话 / 账号),
 *    要么本身就是流水(日志 / 限流 / 锁定)。
 *
 * 唯一业务键怎么办(踩过的坑,别改回去):
 *   `sys_user.email` / `sys_role.name` / `sys_dict.code` / `sys_menu.path` / `sys_para.para_key` /
 *   `sys_data_plugin.plugin_key` 这些列上都有**唯一索引**。如果软删时原样留着,那条键就被
 *   「死行」永久占住 —— 管理员删掉「测试角色」之后再也建不出同名角色,而且界面上看不到那条占位行,
 *   等于给了一个无解的死胡同。所以软删时用 `tombstone()` 把唯一键改成
 *   `<原值前缀>#d#<id 尾段>`(原值只截断到刚好放得下后缀):
 *   键让出来了,新记录照建;原值前缀还看得见,想恢复就是把这个后缀去掉(见 `fromTombstone()`,
 *   注意不是无损的:列不够宽时原值尾部在写入时就被截掉了)。
 *   **不要**改用「唯一索引 + deleted_at」那种写法:MySQL 的唯一索引把 NULL 当互不相等,
 *   活着的行为全是 `(key, NULL)` ⇒ 唯一性**直接失效**(实测过:同一个 code 能插进三行)。
 *
 * 删除过程"查不到"怎么报——两种都对,但**分界线要一致**(统一软删那一轮定下来的):
 *  - 按**业务键**删(参数名 / 字典编码 / 插件 key):墓碑已经把键让出去了 ⇒ 查不到就报 NOT_FOUND
 *    (`para.remove` / `dict.delete` / `dataPlugin.remove`),重复删除会明确说"不存在";
 *  - 按**主键 id** 删(角色 / 部门 / 菜单 / 标签 / 数据范围 / 演示网格):id 不参与让位,
 *    重复删除是**幂等**的(再写一次 `deleted_at`),所以 `get*Row` 那类取行函数故意不带 `alive()`。
 */
import { type AnyColumn, isNull } from "drizzle-orm";

/** 带软删列的表(drizzle 列属性固定叫 `deleted_at`)。 */
type SoftDeletable = { deleted_at: AnyColumn };

/** 「还活着」:所有 list / get / 按名查重 / 权限引擎的查询都要带上它。 */
export function alive<T extends SoftDeletable>(table: T) {
	return isNull(table.deleted_at);
}

/** 软删时写进 `deleted_at` 的值。 */
export function softDeleted(): { deleted_at: Date } {
	return { deleted_at: new Date() };
}

/** 墓碑标记 —— 键让位时贴在原值尾部(短是有意的:`sys_role.name` 只有 32 字符)。 */
export const DELETED_SUFFIX = "#d#";

/** 墓碑里带多少位 id —— 取尾段而不是整条:`sys_role.name` 只有 32 字符,整条 id 放不下。 */
const TOMBSTONE_ID_TAIL = 24;

/**
 * 把唯一业务键改成墓碑值,好把键让给新记录。
 *
 * @param key       原来的键(邮箱 / 角色名 / 编码 / 路径 / 参数名 / 插件 key …)
 * @param id        行的主键(用 id 而不是时间戳:同一秒删两条同名记录也不会撞)
 * @param maxLength 该列的长度上限(从 schema 里抄:`email` 255 / `sys_role.name` 32)——
 *                  原值按剩余宽度截断,**保证结果不超列宽**(超了 MySQL 严格模式报 `Data too long`)
 */
export function tombstone(key: string, id: string, maxLength: number): string {
	const suffix = `${DELETED_SUFFIX}${id.slice(-TOMBSTONE_ID_TAIL)}`;
	if (suffix.length >= maxLength) return suffix.slice(0, maxLength);
	return `${key.slice(0, maxLength - suffix.length)}${suffix}`;
}

/**
 * 从墓碑值还原原键(恢复已删除记录时用)。
 *
 * **不是无损的**:列不够宽时原值尾部在写入时就被截掉了(见 `tombstone()` 的截断),这里只能还原剩下的前缀。
 * 删除行本身在列表 / 下拉 / 鉴权里都不出现,所以这份还原只服务于手写 SQL 救数据。
 */
export function fromTombstone(key: string): string {
	const at = key.lastIndexOf(DELETED_SUFFIX);
	return at < 0 ? key : key.slice(0, at);
}
