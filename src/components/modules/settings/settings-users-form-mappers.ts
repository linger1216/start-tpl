/**
 * 系统设置 · 用户管理 · 表单纯映射(无 React 依赖,可单测)。
 *
 * 职责边界(见 `doc/前端结构与组件约定.md` §4):
 *  - `settingsUsersFormSchema`:表单校验规则,同时被 TanStack Form 的 `validators` 使用;
 *  - `toForm`:行数据 → 表单初值(多值字段统一成数组);
 *  - `toSubmit`:表单值 → 落库值(trim + 多值保持数组 —— 库里的形态就是 `string[]`);
 *  - `importRowToValues`:Excel 文本行 → 落库值(带错误信息)。
 *
 * 这里不做任何格式化与 toast,只做形状转换;行类型只从契约中枢 `#/mocks/settings` 取。
 */
import { z } from "zod";

import type { ImportRow } from "#/lib/excel";
import { splitMultiValue } from "#/lib/multi-value";
import { DEPARTMENTS, USER_STATUSES, type UserRow } from "#/mocks/settings";

export const settingsUsersFormSchema = z.object({
	id: z.string().nullable(),
	账号: z.string().trim().min(1, "请输入账号").max(20, "账号最长 20 字"),
	姓名: z.string().trim().min(1, "请输入姓名").max(20, "姓名最长 20 字"),
	手机号: z
		.string()
		.trim()
		.regex(/^1[3-9]\d{9}$/, "请填写有效的手机号"),
	所属部门: z.string().trim().min(1, "请选择所属部门/条线"),
	// #19 多值字段:数据模型就是 string[](一人可同属多个用户组、持多个角色)
	所属用户组: z.array(z.string()),
	角色: z.array(z.string()),
	状态: z.string().trim().min(1, "请选择状态"),
	最近登录时间: z.string().trim(),
});

export type SettingsUsersFormValues = z.infer<typeof settingsUsersFormSchema>;

/**
 * 表单落库值:多值字段在库里是 `string[]`(与种子数据一致)。
 *
 * 刻意**不含** `权限点` —— 用户表单不直接编辑权限(权限由授权弹窗的权限树写回),
 * 这样编辑用户时不会把已有的直接授权覆盖掉。
 */
export type SettingsUsersSubmitValues = {
	id: string | null;
	账号: string;
	姓名: string;
	手机号: string;
	所属部门: string;
	所属用户组: string[];
	角色: string[];
	状态: string;
	最近登录时间: string;
};

/** 行数据 → 表单初值(新建时返回全新对象,不复用共享常量:表单可能就地改数组) */
export function toForm(initial: UserRow | null): SettingsUsersFormValues {
	if (!initial) {
		return {
			id: null,
			账号: "",
			姓名: "",
			手机号: "",
			所属部门: DEPARTMENTS[0] ?? "",
			所属用户组: [],
			角色: [],
			状态: USER_STATUSES[0] ?? "",
			最近登录时间: "",
		};
	}
	return {
		id: initial.id,
		账号: initial.账号,
		姓名: initial.姓名,
		手机号: initial.手机号,
		所属部门: initial.所属部门,
		所属用户组: splitMultiValue(initial.所属用户组),
		角色: splitMultiValue(initial.角色),
		状态: initial.状态,
		最近登录时间: initial.最近登录时间,
	};
}

/** 表单值 → 落库值 */
export function toSubmit(values: SettingsUsersFormValues): SettingsUsersSubmitValues {
	return {
		id: values.id,
		账号: values.账号.trim(),
		姓名: values.姓名.trim(),
		手机号: values.手机号.trim(),
		所属部门: values.所属部门.trim(),
		所属用户组: values.所属用户组,
		角色: values.角色,
		状态: values.状态.trim(),
		最近登录时间: values.最近登录时间.trim(),
	};
}

/** Excel 文本行 → 落库值;缺必填或手机号格式错时回 { error } */
export function importRowToValues(raw: ImportRow): { values: SettingsUsersSubmitValues } | { error: string } {
	const text = (key: string) => (raw[key] ?? "").trim();
	const parsed = settingsUsersFormSchema.safeParse({
		id: null,
		账号: text("账号"),
		姓名: text("姓名"),
		手机号: text("手机号"),
		所属部门: text("所属部门"),
		所属用户组: splitMultiValue(text("所属用户组")),
		角色: splitMultiValue(text("角色")),
		状态: text("状态"),
		最近登录时间: text("最近登录时间"),
	});
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return { error: `${first?.path.join(".") ?? "字段"}:${first?.message ?? "校验未通过"}` };
	}
	return { values: toSubmit(parsed.data) };
}
