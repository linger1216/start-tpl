/**
 * 侧边栏「收起后长什么样」—— 唯一真源。
 *
 * 值存 `sys_config`(键 `ui.sidebar.collapsed_mode`,默认 `rail`),与「列可见性」同一套口径:
 * 这是**系统设置级**偏好,换机器 / 换浏览器都该一致,而且要在「系统设置 ▸ 参数管理」里能直接改。
 *
 * 所以这里**不碰 localStorage、不持有任何状态** —— 读取与订阅由 React Query 负责
 * (见 `components/layout/sidebar.tsx` 的 `useSidebarCollapseMode`),
 * 本文件只提供四件事:参数名 / 取值域 / 默认值 / 容错解析。
 *
 * 为什么不给参数做「可选值下拉」:那要给参数表引入 options 机制(表、路由、表单三处都要动),
 * 为一条偏好不值当。代价是值靠手输 —— 所以解析必须容错(见 `parseSidebarCollapseMode`)。
 */

/** 「系统设置 ▸ 参数管理」里决定侧边栏收起形态的参数名 */
export const SIDEBAR_MODE_CONFIG_KEY = "ui.sidebar.collapsed_mode";

export const SIDEBAR_COLLAPSE_MODES = ["rail", "hidden"] as const;

export type SidebarCollapseMode = (typeof SIDEBAR_COLLAPSE_MODES)[number];

/** 默认值:窄菜单(比"完全隐藏"信息更多,且永远留着一条可点的导航) */
export const SIDEBAR_COLLAPSE_MODE_DEFAULT: SidebarCollapseMode = "rail";

/**
 * 参数值 → 折叠模式。**永不抛错**:库里没这条、值是手输错的、读取失败 —— 一律回落默认值。
 *
 * 这条容错是必须的:参数在界面上是**手输的字符串**,代码不能假设库里存的一定合法。
 */
export function parseSidebarCollapseMode(value: string | null | undefined): SidebarCollapseMode {
	if (value && (SIDEBAR_COLLAPSE_MODES as readonly string[]).includes(value)) return value as SidebarCollapseMode;
	return SIDEBAR_COLLAPSE_MODE_DEFAULT;
}
