/**
 * 多值字段的统一解析 —— 全站只有这一处分隔符口径。
 *
 * 为什么单独成文件:多值(标签)字段既有「渲染层」消费方(`ui/badge-list.tsx` 的 `BadgeList`),
 * 也有「纯数据层」消费方(表单与 Excel 写回的归一路径),
 * 放在组件文件里会让 lib 反向依赖组件。
 */

/** 多值字段的分隔符:顿号 / 中英文逗号 / 分号 / 竖线 */
const MULTI_VALUE_SEPARATORS = /[、,，;；|]/;

/** 拆多值字段:数组原样展开,字符串按分隔符拆开,统一 trim + 去空 */
export function splitMultiValue(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) {
		return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
	}
	const text = String(value).trim();
	if (!text) return [];
	return text
		.split(MULTI_VALUE_SEPARATORS)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/** 多值字段的展示文本(数组 → 「A、B」),供表格单元格与导出使用 */
export function joinMultiValue(value: unknown, separator = "、"): string {
	return splitMultiValue(value).join(separator);
}
