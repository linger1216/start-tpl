/**
 * 通用展示层格式化 helper —— 值 / JSON 的归一化与展示,任何 CRUD 模块复用。
 *
 * 当前 helper 列表:
 *   - `formatJson`:      unknown → 格式化 JSON 文本,不可序列化时降级
 *   - `normalizeValue`:  unknown → 字符串数组(任意值归一)
 *   - `formatBytes`:     字节数 → `1.5 KB`(文件 / 附件展示用)
 *
 * ⚠️ **日期格式化不在这里,在 `lib/time.ts`。**
 * 曾经两个文件各有一套(`formatDateTime` vs `formatLocalDateTime`),同一个值在两处
 * 可能给出不同结果;而 `toISOString()` 是 UTC,当"给人看的时间"用会差 8 小时(真实踩过两次)。
 * 现在只此一处时间模块,新代码不要再往本文件加日期函数。
 *
 * 注:`parseAddressEntries` 已合并到 lib 的多值读法(`multi-value.ts` / `format.ts` 的 `normalizeValue`)。
 */

import { PLACEHOLDER_EMPTY } from "./constants";

/**
 * 把任意 JSON 值 → 缩进 2 空格的字符串。
 * - string 输入: 尝试先 JSON.parse 再 stringify(归一),失败则原样返回
 * - null / undefined: 占位符
 * - 其他: JSON.stringify(v, null, 2);不可序列化降级 toString
 */
/**
 * 字节数 → 人读字符串(`1536` → `1.5 KB`)。
 *
 * 进制用 **1024**(与操作系统 / 网盘一致),但单位写 `KB` / `MB` 而不是 `KiB` / `MiB` ——
 * 后台界面里"1.5 MB"不用让人停一下换算。不足 1KB 直接给字节数,免得出现 `0.4 KB` 这种没信息量的值。
 */
export function formatBytes(bytes: number | null | undefined, fractionDigits = 1): string {
	const value = Number(bytes ?? 0);
	if (!Number.isFinite(value) || value <= 0) return "0 B";
	if (value < 1024) return `${Math.round(value)} B`;
	const units = ["KB", "MB", "GB", "TB", "PB"];
	let size = value / 1024;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	return `${size.toFixed(fractionDigits)} ${units[unit]}`;
}

export function formatJson(v: unknown): string {
	if (v === null || v === undefined) return PLACEHOLDER_EMPTY;
	if (typeof v === "string") {
		const s = v.trim();
		if (!s) return PLACEHOLDER_EMPTY;
		try {
			return JSON.stringify(JSON.parse(s), null, 2);
		} catch {
			return s;
		}
	}
	try {
		return JSON.stringify(v, null, 2);
	} catch {
		return Object.prototype.toString.call(v);
	}
}

/**
 * 把任意形态的"值"(string / array / object / null)归一化为字符串数组,
 * 给表格按行渲染用。无法归一化的返回空数组(交给调用方决定 fallback 显示什么)。
 * 与地址语义无关 —— 原名 normalizeAddress 已弃用。
 *
 * 规则:
 *  - null / undefined    → []
 *  - string              → [string]
 *  - array               → 递归展平每个元素,只保留 string
 *  - number / boolean    → [String(v)]
 *  - { value: string }   → [value](条目对象,如子区域地址 [{ value: "..." }])
 *  - object / 其他       → []
 */
export function normalizeValue(value: unknown): string[] {
	if (value == null) return [];
	if (typeof value === "string") return value ? [value] : [];
	if (Array.isArray(value)) {
		return value.flatMap((item) => (typeof item === "string" && item ? [item] : normalizeValue(item)));
	}
	if (typeof value === "number" || typeof value === "boolean") return [String(value)];
	// 条目对象(如子区域 address:[{ value: "..." }])→ 取 value
	if (typeof value === "object") {
		const v = (value as Record<string, unknown>).value;
		if (typeof v === "string" && v) return [v];
		return [];
	}
	return [];
}
