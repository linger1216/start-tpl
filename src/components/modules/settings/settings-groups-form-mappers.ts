/**
 * 系统设置 · 用户组管理 · 表单纯映射(无 React 依赖)。
 *
 * 职责边界(见 `doc/前端结构与组件约定.md` §4):
 *  - `settingsGroupsFormSchema`:表单校验规则,同时被 TanStack Form 的 `validators` 使用;
 *  - `toForm`:行数据 → 表单初值;`toSubmit`:表单值 → 落库值;
 *  - `importRowToValues`:Excel 文本行 → 落库值(带错误信息)。
 *
 * 刻意**不含** `成员ids` / `权限点`:组的成员由「管理成员」写回、组权限由「组授权」写回,
 * 表单不碰这两项,编辑组信息时不会把它们清空。
 */
import { z } from "zod";

import type { ImportRow } from "#/lib/excel";
import { splitMultiValue } from "#/lib/multi-value";
import { GROUP_LINES, GROUP_STATUSES, type GroupRow } from "#/mocks/settings";

export const settingsGroupsFormSchema = z.object({
	id: z.string().nullable(),
	组名: z.string().trim().min(1, "请输入用户组名").max(30, "组名最长 30 字"),
	所属条线: z.string().trim().min(1, "请选择所属条线"),
	已授权角色: z.array(z.string()),
	状态: z.string().trim().min(1, "请选择状态"),
	创建时间: z.string().trim(),
});

export type SettingsGroupsFormValues = z.infer<typeof settingsGroupsFormSchema>;

/** 表单落库值(不含成员 / 权限点) */
export type SettingsGroupsSubmitValues = {
	id: string | null;
	组名: string;
	所属条线: string;
	已授权角色: string[];
	状态: string;
	创建时间: string;
};

/** 行数据 → 表单初值(新建时返回全新对象,不复用共享常量) */
export function toForm(initial: GroupRow | null): SettingsGroupsFormValues {
	if (!initial) {
		return {
			id: null,
			组名: "",
			所属条线: GROUP_LINES[0] ?? "",
			已授权角色: [],
			状态: GROUP_STATUSES[0] ?? "",
			创建时间: "",
		};
	}
	return {
		id: initial.id,
		组名: initial.组名,
		所属条线: initial.所属条线,
		已授权角色: splitMultiValue(initial.已授权角色),
		状态: initial.状态,
		创建时间: initial.创建时间,
	};
}

/** 表单值 → 落库值 */
export function toSubmit(values: SettingsGroupsFormValues): SettingsGroupsSubmitValues {
	return {
		id: values.id,
		组名: values.组名.trim(),
		所属条线: values.所属条线.trim(),
		已授权角色: values.已授权角色,
		状态: values.状态.trim(),
		创建时间: values.创建时间.trim(),
	};
}

/** Excel 文本行 → 落库值;缺必填时回 { error } */
export function importRowToValues(raw: ImportRow): { values: SettingsGroupsSubmitValues } | { error: string } {
	const text = (key: string) => (raw[key] ?? "").trim();
	const parsed = settingsGroupsFormSchema.safeParse({
		id: null,
		组名: text("组名"),
		所属条线: text("所属条线"),
		已授权角色: splitMultiValue(text("已授权角色")),
		状态: text("状态"),
		创建时间: text("创建时间"),
	});
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return { error: `${first?.path.join(".") ?? "字段"}:${first?.message ?? "校验未通过"}` };
	}
	return { values: toSubmit(parsed.data) };
}
