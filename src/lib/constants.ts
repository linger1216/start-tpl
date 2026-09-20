/**
 * 全局常量 —— 展示层与业务层共用。只放常量,不放函数
 * (helper 就近归到各自域:展示 → format.ts,错误 → api/error.ts,入库归一 → json.ts)。
 *
 * ponytail: 常量量级还小,单文件集中管理;等超过 ~12 组再按域拆目录。
 */

// ─── 展示层 ────────────────────────────────────────────

/** 空值占位符:列表/详情里 null|undefined 统一显示 —(与各模块详情页既有展示一致) */
export const PLACEHOLDER_EMPTY = "-";

/** 分页每页可选条数 */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

// ─── 业务层:通用状态 ───────────────────────────────────

export const STATUS = {
	DISABLED: 0,
	ENABLED: 1,
} as const;

export type StatusValue = (typeof STATUS)[keyof typeof STATUS];

/** 状态数字 → 中文标签 */
export const STATUS_LABEL: Record<StatusValue, string> = {
	[STATUS.DISABLED]: "禁用",
	[STATUS.ENABLED]: "启用",
};

/** 状态 → badge 配色类(浅底深字) */
export const STATUS_BADGE_CLASS: Record<StatusValue, string> = {
	[STATUS.DISABLED]: "bg-danger-soft text-danger-fg",
	[STATUS.ENABLED]: "bg-success-soft text-success-fg",
};

// ─── 主题 ──────────────────────────────────────────────

/**
 * 主题偏好写入 localStorage 的键。
 *
 * 顶栏的切换按钮与 `src/routes/__root.tsx` 里的主题引导脚本**必须共用同一个值** ——
 * 否则首屏会先按系统偏好渲染、再被切换按钮纠正,肉眼能看到闪一下。
 *
 * 派生新项目时建议改掉这个名字:多个项目都用 localhost:3000 开发时同源共用
 * localStorage,主题会互相串。
 */
export const THEME_STORAGE_KEY = "app-theme";
