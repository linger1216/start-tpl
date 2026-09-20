/**
 * mock 数据工厂 —— 演示数据共用的**确定性**构造函数。
 *
 * 两条硬性约定:
 *  1. **禁止 `Math.random()` / `new Date()`**:服务端渲染与客户端水合必须得到同一份数据,
 *     刷新页面也要回到同一份种子。所有"随机感"都用序号 `i` 做确定性取值(`pick`)。
 *  2. **基准日固定**为 `MOCK_TODAY`,相对时间都相对它算 —— 否则页面上的时间标签
 *     会因为跑在不同机器上而变,SSR 与水合也会不一致。
 *
 * 只放**当前有人用**的原语。派生新项目时要造新的字段构造器(身份证号 / 金额 / 地址…),
 * 照 `phone` / `personName` 的样子加在这里 —— 一处确定性实现,别在每个 mock 文件里各写一遍。
 */

/** 全部 mock 数据的基准日 —— 相对时间都相对它计算 */
export const MOCK_TODAY = "2025-09-30";

// ── 人名素材 ──────────────────────────────────────────────────

export const SURNAMES = [
	"张",
	"王",
	"李",
	"陈",
	"刘",
	"杨",
	"赵",
	"周",
	"吴",
	"徐",
	"孙",
	"马",
	"朱",
	"胡",
	"郭",
	"何",
];

export const GIVEN = ["明", "华", "强", "伟", "芳", "静", "军", "丽", "涛", "敏", "杰", "磊", "超", "燕", "峰", "霞"];

// ── 确定性取值 ────────────────────────────────────────────────

/** 按序号在候选表里循环取值(支持负数;候选表为空时返回 undefined,由调用方兜底) */
export function pick<T>(list: readonly T[], i: number): T {
	return list[((i % list.length) + list.length) % list.length] as T;
}

/** 序号 → 定宽主键 / 流水号(如 `USR-0007`) */
export function idOf(prefix: string, i: number, width = 4): string {
	return `${prefix}-${String(i).padStart(width, "0")}`;
}

// ── 确定性日期(相对 MOCK_TODAY) ──────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

const baseTime = Date.parse(`${MOCK_TODAY}T00:00:00Z`);

/** 基准日往前 i 天的日期(YYYY-MM-DD) */
export function dateBefore(days: number): string {
	return new Date(baseTime - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 基准日往前 i 天、当天某时刻的时间戳文本(YYYY-MM-DD HH:mm)。
 *
 * `minute` 是"扰动序号":同一批数据里传不同值就得到不同的小时 / 分钟,
 * 于是时间列看起来有分布,但仍然是确定性的(同一序号永远同一时刻)。
 */
export function stampBefore(days: number, minute = 0): string {
	const d = new Date(baseTime - days * DAY_MS);
	const hh = String(9 + (minute % 9)).padStart(2, "0");
	const mm = String((minute * 7) % 60).padStart(2, "0");
	return `${d.toISOString().slice(0, 10)} ${hh}:${mm}`;
}

// ── 业务字段构造 ──────────────────────────────────────────────

/** 序号 → 手机号(11 位,1[3-9] 开头) */
export function phone(i: number): string {
	return `1${3 + (i % 7)}${String(10_000_000 + i * 6_543_210).slice(0, 9)}`;
}

/** 序号 → 人名 */
export function personName(i: number): string {
	return `${pick(SURNAMES, i)}${pick(GIVEN, i * 3)}`;
}
