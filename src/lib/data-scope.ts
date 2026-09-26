import type { AnyColumn, SQL } from "drizzle-orm";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db";
import { sysDept, sysRole, sysUser, sysUserDept, sysUserRole } from "#/db/data-base-schema";
import type { DataScope } from "#/lib/data-scope-spec";
import { widestScope } from "#/lib/data-scope-spec";
import { collectDescendantIds } from "#/lib/tree";

/**
 * 行级数据权限(**唯一载体是 `sys_role.data_scope` 那一列**)。
 *
 * 核心口径:**档位词存在角色上,范围永远在部门树上算出来** —— 展开之后,
 * 所有档最终都归约成「一批部门 id」(或"全部"/"按 `create_by` 过滤")。
 *
 * | 取值 | 含义 |
 * | --- | --- |
 * | `all` | 全部 |
 * | `self` | 仅本人(业务表的**负责人列** = 我) |
 * | `dept` | 我所属部门(可能多个) |
 * | `dept_below` | 我所属部门 + 各自子树 |
 *
 * 三条纪律:
 * 1. **业务表的「归属组织」列必须指向人也会被挂上去的那类节点**(这里是「××网格组」,
 *    也就是 `sys_user_dept` 挂的那个层级);统计口径的列(街镇 / 区)另存一列,不参与过滤;
 * 2. 值非法 / 没有部门 ⇒ **fail-closed**(条件恒假,什么都看不到),绝不退化成"不过滤";
 * 3. **统计 / 导出 / 多表 join 也必须调这里的辅助函数** —— 手写 where 就是绕过行级权限。
 */

type ScopeResolution = {
	scope: DataScope;
	/** 展开后的部门 id 集合(`all` / `self` 档为空 —— 它们不按部门过滤) */
	departmentIds: string[];
};

/**
 * 这个用户**生效**的数据范围。
 *
 * `userId === null` ⇒ `all`:脚本 / 测试 / SSR 直调没有用户上下文时**不过滤**
 * (校验归 `protectedProcedure` 的中间件,这里只管过滤 —— 与 `effectiveMenusFor` 的 `perms = null` 同口径)。
 */
export async function scopeOf(userId: string | null): Promise<ScopeResolution> {
	if (!userId) return { scope: "all", departmentIds: [] };

	const roleRows = await db
		.select({ scope: sysRole.data_scope })
		.from(sysUserRole)
		.innerJoin(sysRole, eq(sysRole.id, sysUserRole.role_id))
		.where(and(eq(sysUserRole.user_id, userId), eq(sysRole.status, 1)));
	const scope = widestScope(roleRows.map((row) => row.scope));
	if (scope === "all" || scope === "self") return { scope, departmentIds: [] };

	const mine = await db
		.select({ id: sysUserDept.department_id })
		.from(sysUserDept)
		.where(eq(sysUserDept.user_id, userId));
	const ownIds = mine.map((row) => row.id);
	if (ownIds.length === 0) return { scope, departmentIds: [] }; // 没有部门 ⇒ 什么都看不到

	if (scope === "dept") return { scope, departmentIds: ownIds };

	// 要动组织树:一次取全表(部门是固定的小表),在内存里算
	const departments = await db.select({ id: sysDept.id, parentId: sysDept.parent_id }).from(sysDept);
	return { scope, departmentIds: collectDescendantIds(departments, ownIds) };
}

/**
 * 「本部门 / 本部门及以下」两档:业务表的**归属组织列** `IN (…)`。
 *
 * ⚠️ 空集合返回 **`1 = 0`(恒假)**,不是 `undefined`:返回 `undefined` 会让调用方
 * 「不加条件 = 全放行」,那是 fail-open —— 一行都看不到才是对的。
 */
export function deptCondition(column: AnyColumn, departmentIds: readonly string[]): SQL {
	if (departmentIds.length === 0) return sql`1 = 0`;
	return inArray(column, [...departmentIds]);
}

/**
 * 多对多形态:`sys_user` 自己**没有**部门列("谁属于哪个部门"在 `sys_user_dept` 里),
 * 所以用**子查询**表达"这些部门里的人" —— `user.list` 用的就是这一条。
 */
export function userIdsOfDepartments(departmentIds: readonly string[]): SQL {
	// 空集合 ⇒ 恒假,理由同 `deptCondition`
	if (departmentIds.length === 0) return sql`1 = 0`;
	return inArray(
		sysUser.id,
		db
			.select({ id: sysUserDept.user_id })
			.from(sysUserDept)
			.where(inArray(sysUserDept.department_id, [...departmentIds])),
	);
}
