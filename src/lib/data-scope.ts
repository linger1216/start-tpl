import type { AnyColumn, SQL } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "#/db";
import { sysDept, sysRole, sysUser, sysUserDept, sysUserRole } from "#/db/data-base-schema";
import type { DataScope } from "#/lib/data-scope-spec";
import { parseScope, widestScope } from "#/lib/data-scope-spec";
import { collectDescendantIds, findAncestorAtLevel } from "#/lib/tree";

/**
 * 行级数据权限(**唯一载体是 `sys_role.data_scope` 那一列**)。
 *
 * 核心口径:**档位词存在角色上,范围永远在部门树上算出来** —— 展开之后,
 * 所有档最终都归约成「一批部门 id」(或"全部"/"按 `create_by` 过滤")。
 *
 * | 取值 | 含义 |
 * | --- | --- |
 * | `all` | 全部 |
 * | `self` | 仅本人(业务表 `create_by` = 我) |
 * | `dept` | 我所属部门(可能多个) |
 * | `dept_below` | 我所属部门 + 各自子树 |
 * | `up:N` | 往上到「**从根往下第 N 层**」的祖先(含自己)+ 子树(如 `up:1` = 街镇) |
 *
 * 三条纪律:
 * 1. **`sys_dept` 一个字不改** —— 往上找锚点只用它已有的 `parent_id`,运行时算;
 * 2. 值非法 / 往上找不到 / 没有部门 ⇒ **fail-closed**(返回空集合,什么都看不到);
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

	// 后两档都要动组织树:一次取全表(部门是固定的小表),在内存里算
	const departments = await db.select({ id: sysDept.id, parentId: sysDept.parent_id }).from(sysDept);
	if (scope === "dept_below") return { scope, departmentIds: collectDescendantIds(departments, ownIds) };

	const level = Number(scope.slice(3));
	const anchors = ownIds
		.map((id) => findAncestorAtLevel(departments, id, level))
		.filter((id): id is string => Boolean(id));
	if (anchors.length === 0) return { scope, departmentIds: [] }; // 往上找不到 ⇒ fail-closed
	return { scope, departmentIds: collectDescendantIds(departments, anchors) };
}

/** 「本部门 / 及以下 / 往上到某层」三档:业务表的部门列 `IN (…)`;空集合 ⇒ 什么都不匹配 */
export function deptCondition(column: AnyColumn, departmentIds: readonly string[]): SQL | undefined {
	if (departmentIds.length === 0) return undefined;
	return inArray(column, [...departmentIds]);
}

/** 「仅本人」:业务表的负责人列 = 我 */
export function ownerCondition(column: AnyColumn, userId: string | null, scope: DataScope): SQL | undefined {
	if (scope !== "self" || !userId) return undefined;
	return eq(column, userId);
}

/**
 * 多对多形态:`sys_user` 自己**没有**部门列("谁属于哪个部门"在 `sys_user_dept` 里),
 * 所以用**子查询**表达"这些部门里的人" —— `user.list` 用的就是这一条。
 */
export function userIdsOfDepartments(departmentIds: readonly string[]): SQL | undefined {
	if (departmentIds.length === 0) return undefined;
	return inArray(
		sysUser.id,
		db
			.select({ id: sysUserDept.user_id })
			.from(sysUserDept)
			.where(inArray(sysUserDept.department_id, [...departmentIds])),
	);
}

/** 表格 / 详情里显示用的中文标签;非法值原样回显(便于排查) */
export function scopeLabel(value: string | null | undefined): string {
	const scope = parseScope(value);
	if (!scope) return value ? `非法(${value})` : "—";
	if (scope === "all") return "全部数据";
	if (scope === "self") return "仅本人";
	if (scope === "dept") return "本部门";
	if (scope === "dept_below") return "本部门及以下";
	return `往上到第 ${scope.slice(3)} 层及以下`;
}
