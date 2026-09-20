/**
 * 系统设置 · 角色管理 · 表单纯映射(无 React 依赖)。
 *
 * 职责边界(见 `doc/前端结构与组件约定.md` §4):
 *  - `settingsRolesFormSchema`:表单校验规则,同时被 TanStack Form 的 `validators` 使用;
 *  - `toForm` / `toSubmit`:行数据 ↔ 表单值;
 *  - `importRowToValues`:Excel 文本行 → 落库值(带错误信息)。
 *
 * 刻意**不含** `权限点`:角色权限由「配置权限」弹窗的权限树写回(`setRolePermissions`),
 * 表单不碰它,编辑角色信息时不会把已配置的权限清空。
 */
import { z } from "zod";

import type { ImportRow } from "#/lib/excel";
import { DATA_SCOPES, ROLE_STATUSES, type RoleRow } from "#/mocks/settings";

export const settingsRolesFormSchema = z.object({
	id: z.string().nullable(),
	角色名: z.string().trim().min(1, "请输入角色名").max(20, "角色名最长 20 字"),
	角色编码: z
		.string()
		.trim()
		.min(1, "请输入角色编码")
		.regex(/^[A-Z][A-Z0-9_]*$/, "角色编码用大写字母 / 数字 / 下划线,如 ROLE_AUDITOR"),
	数据范围: z.string().trim().min(1, "请选择数据范围"),
	状态: z.string().trim().min(1, "请选择状态"),
	创建时间: z.string().trim(),
	备注: z.string().trim().max(120, "备注最长 120 字"),
});

export type SettingsRolesFormValues = z.infer<typeof settingsRolesFormSchema>;

/** 表单落库值(不含权限点) */
export type SettingsRolesSubmitValues = {
	id: string | null;
	角色名: string;
	角色编码: string;
	数据范围: string;
	状态: string;
	创建时间: string;
	备注: string;
};

/** 行数据 → 表单初值(新建时返回全新对象,不复用共享常量) */
export function toForm(initial: RoleRow | null): SettingsRolesFormValues {
	if (!initial) {
		return {
			id: null,
			角色名: "",
			角色编码: "",
			数据范围: DATA_SCOPES[0] ?? "",
			状态: ROLE_STATUSES[0] ?? "",
			创建时间: "",
			备注: "",
		};
	}
	return {
		id: initial.id,
		角色名: initial.角色名,
		角色编码: initial.角色编码,
		数据范围: initial.数据范围,
		状态: initial.状态,
		创建时间: initial.创建时间,
		备注: initial.备注,
	};
}

/** 表单值 → 落库值 */
export function toSubmit(values: SettingsRolesFormValues): SettingsRolesSubmitValues {
	return {
		id: values.id,
		角色名: values.角色名.trim(),
		角色编码: values.角色编码.trim(),
		数据范围: values.数据范围.trim(),
		状态: values.状态.trim(),
		创建时间: values.创建时间.trim(),
		备注: values.备注.trim(),
	};
}

/** Excel 文本行 → 落库值;缺必填或编码格式错时回 { error } */
export function importRowToValues(raw: ImportRow): { values: SettingsRolesSubmitValues } | { error: string } {
	const text = (key: string) => (raw[key] ?? "").trim();
	const parsed = settingsRolesFormSchema.safeParse({
		id: null,
		角色名: text("角色名"),
		角色编码: text("角色编码"),
		数据范围: text("数据范围"),
		状态: text("状态"),
		创建时间: text("创建时间"),
		备注: text("备注"),
	});
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return { error: `${first?.path.join(".") ?? "字段"}:${first?.message ?? "校验未通过"}` };
	}
	return { values: toSubmit(parsed.data) };
}
