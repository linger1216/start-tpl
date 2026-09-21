/**
 * 系统参数的**规格**:类型、中文说明、录入校验、内置默认值。
 *
 * ⚠️ **这个文件里不允许出现 `db` / `drizzle` / 任何服务端依赖** —— 它是要进浏览器包的。
 *
 * 为什么和 `lib/sys-config.ts` 拆开(踩过的坑):参数管理页的表单与表格只需要
 * 「类型中文名 + 校验」,却从 `sys-config.ts` 里取,而那个文件 `import { db } from "#/db"`
 * (→ `drizzle-orm/mysql2` → `mysql2` + `aws-ssl-profiles`)。于是整个数据库驱动被 Vite
 * 打进了 `parameters-*.js` 这一个路由 chunk(实测 865 kB),浏览器一执行驱动初始化就崩:
 *
 *     Cannot read properties of undefined (reading 'prototype')
 *
 * 症状是「其它页面都正常,只有参数管理白屏」。**客户端组件只许从这里 import**;
 * `sys-config.ts` 留给服务端(tRPC procedure / 脚本)。
 */

export type ConfigType = "string" | "int" | "bool" | "json" | "array" | "map";

/** 类型 → 中文名 + 录入提示(参数页 / 表单共用,不要在页面里另写) */
export const CONFIG_TYPE_META: Record<ConfigType, { label: string; hint: string }> = {
	string: { label: "文本", hint: "任意文本" },
	int: { label: "整数", hint: "整数,不能为负" },
	bool: { label: "开关", hint: "只能填 true / false" },
	json: { label: "JSON", hint: "合法的 JSON(对象或数组均可)" },
	array: { label: "数组", hint: 'JSON 数组,如 ["a","b"]' },
	map: { label: "映射", hint: 'JSON 对象,如 {"k":"v"}' },
};

/** 参数值长度上限 —— 与 `sys_config.cfg_value` 的列宽、tRPC 入参的 zod 上限三者必须一致 */
export const CONFIG_VALUE_MAX = 4000;

/** 参数值按类型校验:参数页保存前也用它(不接受乱七八糟的值) */
export function validateConfigValue(type: ConfigType, value: string): string | null {
	const trimmed = value.trim();
	if (type === "int") {
		if (!/^-?\d+$/.test(trimmed)) return "这个参数要填整数";
		if (Number(trimmed) < 0) return "不能为负数";
	}
	if (type === "bool" && !["true", "false"].includes(trimmed)) return "这个参数只能填 true / false";
	if (type === "json" || type === "array" || type === "map") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			return "不是合法的 JSON";
		}
		if (type === "array" && !Array.isArray(parsed)) return '这个参数要填 JSON 数组,如 ["a","b"]';
		if (type === "map" && (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null))
			return '这个参数要填 JSON 对象,如 {"k":"v"}';
	}
	/**
	 * 长度上限与**列宽**和 **tRPC 入参**保持一致(4000)。
	 * 曾经是 500 —— 而「列可见性 + 顺序」这类 JSON 在 24 列时就已经 650 字符,
	 * 结果是"界面上勾了、刷新就回来了"(保存被拒,只有一条 toast 一闪而过)。实测踩到。
	 */
	if (value.length > CONFIG_VALUE_MAX) return `参数值太长(最多 ${CONFIG_VALUE_MAX} 字符)`;
	return null;
}
