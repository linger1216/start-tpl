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

// ─── 主题 ──────────────────────────────────────────────

/**
 * 主题偏好写入 localStorage 的键。
 *
 * 顶栏的切换按钮与 `src/routes/__root.tsx` 里的主题引导脚本**必须共用同一个值** ——
 * 否则首屏会先按系统偏好渲染、再被切换按钮纠正,肉眼能看到闪一下。
 *
 * **为什么只有主题落在 localStorage**:它必须在首屏绘制之前同步读到,而引导脚本是内联脚本,
 * 等不了任何请求 —— 只有本地存储做得到。其余界面偏好一律进 `sys_config` 的 `ui.*`
 * (键与解析就近放在各自域里,如 `lib/sidebar-mode.ts`),**不要往这里再加键**。
 *
 * 派生新项目时建议改掉这个名字:多个项目都用 localhost:3000 开发时同源共用
 * localStorage,主题会互相串。
 */
export const THEME_STORAGE_KEY = "app-theme";
