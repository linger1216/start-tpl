/**
 * 系统设置 · 标签管理 · 两张表(维度 / 标签)的纯映射(无 React 依赖)。
 *
 * 本页有两张表,映射也各写一套:标签维度(`TagDimension`)与标签明细(`TagItem`)。
 * 职责边界(见 `doc/前端结构与组件约定.md` §4):
 *  - `xxxFormSchema`:表单校验,同时被 TanStack Form 的 `validators` 使用;
 *  - `toForm` / `toSubmit`:行数据 ↔ 表单值;
 *  - `importRowToValues`:Excel 文本行 → 落库值(带错误信息)。
 * 行类型只从契约中枢 `#/mocks/tags` 取。
 */
import { z } from "zod";

import type { ImportRow } from "#/lib/excel";
import type { TagDimension, TagItem } from "#/mocks/tags";

// ══ 一、标签维度(标签分类) ═════════════════════════════════════
export const settingsTagDimensionFormSchema = z.object({
	id: z.string().nullable(),
	维度: z.string().trim().min(1, "请输入维度名").max(20, "维度名最长 20 字"),
	适用对象: z.string().trim().min(1, "请输入适用对象").max(80, "适用对象最长 80 字"),
	来源: z.string().trim(),
	备注: z.string().trim().max(200, "备注最长 200 字"),
});

export type SettingsTagDimensionFormValues = z.infer<typeof settingsTagDimensionFormSchema>;

export type SettingsTagDimensionSubmitValues = {
	id: string | null;
	维度: string;
	适用对象: string;
	来源: string;
	备注: string;
};

export function toDimensionForm(initial: TagDimension | null): SettingsTagDimensionFormValues {
	if (!initial) return { id: null, 维度: "", 适用对象: "", 来源: "", 备注: "" };
	return {
		id: initial.id,
		维度: initial.维度,
		适用对象: initial.适用对象,
		来源: initial.来源,
		备注: initial.备注,
	};
}

export function toDimensionSubmit(values: SettingsTagDimensionFormValues): SettingsTagDimensionSubmitValues {
	return {
		id: values.id,
		维度: values.维度.trim(),
		适用对象: values.适用对象.trim(),
		来源: values.来源.trim(),
		备注: values.备注.trim(),
	};
}

export function importDimensionRowToValues(
	raw: ImportRow,
): { values: SettingsTagDimensionSubmitValues } | { error: string } {
	const parsed = settingsTagDimensionFormSchema.safeParse({
		id: null,
		维度: (raw.维度 ?? "").trim(),
		适用对象: (raw.适用对象 ?? "").trim(),
		来源: (raw.来源 ?? "").trim(),
		备注: (raw.备注 ?? "").trim(),
	});
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return { error: `${first?.path.join(".") ?? "字段"}:${first?.message ?? "校验未通过"}` };
	}
	return { values: toDimensionSubmit(parsed.data) };
}

// ══ 二、标签明细 ═════════════════════════════════════════════════
export const settingsTagsFormSchema = z.object({
	id: z.string().nullable(),
	维度: z.string().trim().min(1, "请选择所属维度"),
	标签: z.string().trim().min(1, "请输入标签").max(30, "标签最长 30 字"),
	含义: z.string().trim().min(1, "请输入标签含义").max(120, "含义最长 120 字"),
});

export type SettingsTagsFormValues = z.infer<typeof settingsTagsFormSchema>;

export type SettingsTagsSubmitValues = {
	id: string | null;
	维度: string;
	标签: string;
	含义: string;
};

/**
 * 行数据 → 表单初值。
 *
 * `defaultDimension` 是新建时的所属维度:从某个维度的明细弹窗里点「新增」时,
 * 编排壳把该维度传进来 —— 新标签只能落在这个维度下,避免从维度 A 的弹窗里建出维度 B 的标签。
 */
export function toTagForm(initial: TagItem | null, defaultDimension: string): SettingsTagsFormValues {
	if (!initial) return { id: null, 维度: defaultDimension, 标签: "", 含义: "" };
	return { id: initial.id, 维度: initial.维度, 标签: initial.标签, 含义: initial.含义 };
}

export function toTagSubmit(values: SettingsTagsFormValues): SettingsTagsSubmitValues {
	return {
		id: values.id,
		维度: values.维度.trim(),
		标签: values.标签.trim(),
		含义: values.含义.trim(),
	};
}

export function importTagRowToValues(raw: ImportRow): { values: SettingsTagsSubmitValues } | { error: string } {
	const parsed = settingsTagsFormSchema.safeParse({
		id: null,
		维度: (raw.维度 ?? "").trim(),
		标签: (raw.标签 ?? "").trim(),
		含义: (raw.含义 ?? "").trim(),
	});
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return { error: `${first?.path.join(".") ?? "字段"}:${first?.message ?? "校验未通过"}` };
	}
	return { values: toTagSubmit(parsed.data) };
}
