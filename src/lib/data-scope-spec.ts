/**
 * 数据范围的**纯逻辑**(客户端可 import)。
 *
 * ⚠️ 与 `lib/data-scope.ts` 的分工,照着项目里 `sys-para.ts` / `para-spec.ts` 那套来:
 *  · **本文件**:值域 / 解析 / 取最宽 / 显示标签 —— **不引 `#/db`**,所以客户端组件
 *    (角色表单、角色台账、角色详情)可以放心 import;
 *  · `lib/data-scope.ts`:**要查库的部分**(`scopeOf` / 条件构造器),只在服务端用。
 *
 * 踩过的坑:角色台账一开始直接 import 了 `lib/data-scope.ts` ⇒ 顺着 `#/db` 把 mysql2
 * 拖进浏览器包 ⇒ 打开角色页直接白屏(`Cannot read properties of undefined (reading 'prototype')`),
 * 而 `typecheck` 与 `build` **都是绿的**(它们不会因为"服务端模块进了客户端 chunk"而报错)。
 */

export const SCOPE_VALUES = ["all", "self", "dept", "dept_below"] as const;
/** `up:N` 里的 N = 从根(第 0 层)往下数的层号 */
export type DataScope = (typeof SCOPE_VALUES)[number] | `up:${number}`;

/** 值域校验(与 `lib/rbac.ts` 的 `PERM_FORMAT` 同一套纪律:形状不对就当没配) */
export const SCOPE_FORMAT = /^(all|self|dept|dept_below|up:\d{1,2})$/;

/** 宽窄排序:多角色**取最宽**(`all` 最宽,`self` 最窄) */
const WIDTH: Record<string, number> = { self: 0, dept: 1, up: 2, dept_below: 3, all: 4 };

export function scopeWidth(scope: DataScope | null): number {
	if (!scope) return -1;
	return scope.startsWith("up:") ? (WIDTH.up as number) : (WIDTH[scope] ?? -1);
}

/** 校验并解析;**非法 ⇒ `null`**(调用方一律 fail-closed,不放开) */
export function parseScope(value: string | null | undefined): DataScope | null {
	const trimmed = (value ?? "").trim();
	return SCOPE_FORMAT.test(trimmed) ? (trimmed as DataScope) : null;
}

/**
 * 多角色**取最宽**(`all` > `dept_below` > `up:N` > `dept` > `self`)。
 *
 * ⚠️ **一个有效档都没有时返回 `all`(不收窄)**,不是最窄 —— 与项目既有口径一致
 * (`lib/rbac.ts` 的 `perms = null`「权限体系未启用 ⇒ 一律放行」)。
 * 要收紧某人,**就给他配一个角色**,那才是表达意图的地方。
 */
export function widestScope(values: readonly (string | null | undefined)[]): DataScope {
	const valid = values.map((raw) => parseScope(raw)).filter((scope): scope is DataScope => scope !== null);
	if (valid.length === 0) return "all";
	return valid.reduce((best, scope) => (scopeWidth(scope) > scopeWidth(best) ? scope : best));
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
