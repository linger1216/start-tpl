import { useSyncExternalStore } from "react";

import { SIDEBAR_MODE_STORAGE_KEY } from "./constants";

/**
 * 本机界面偏好 —— 目前只有一项:**侧边栏折叠后长什么样**。
 *
 * 为什么是 localStorage 而不是 `sys_config` 表:
 *  它描述的是"这台设备上这个人的界面",不是"这个系统该怎么运行"。
 *  换台电脑 / 换个浏览器本来就该各自决定,丢进库里反而要处理同步与冲突。
 *  同理,`界面偏好` 页改的是本机,不会影响别人。
 *
 * 为什么用「模块级 store + `useSyncExternalStore`」而不是 Context:
 *  读它的有三处(侧边栏自己、顶栏的折叠按钮、界面偏好页),而它们不在同一棵子树里 ——
 *  顶栏在 `SidebarProvider` 里、但侧边栏是它的兄弟,`界面偏好` 页在 `Outlet` 的深处。
 *  加一层 Provider 只能靠 props 一层层传;改用外部 store 后,任何组件都能直接读写。
 *
 * SSR 安全:`getServerSnapshot` 永远返回默认值,所以服务端直出的 HTML 是确定的一份;
 *  客户端首次渲染也用它,挂载后 `useSyncExternalStore` 发现真实值不同再补一次渲染 ——
 *  不会出现"服务端渲染 A、客户端首次渲染 B"的水合不一致。
 */

export const SIDEBAR_COLLAPSE_MODES = ["rail", "hidden"] as const;

export type SidebarCollapseMode = (typeof SIDEBAR_COLLAPSE_MODES)[number];

/** 默认值:窄菜单(比"完全隐藏"信息更多,且永远留着一条可点的导航) */
export const SIDEBAR_COLLAPSE_MODE_DEFAULT: SidebarCollapseMode = "rail";

/** 两种模式的中文名 + 说明(界面偏好页与帮助文案共用一份,不要在页面里另写) */
export const SIDEBAR_COLLAPSE_MODE_META: Record<
	SidebarCollapseMode,
	{ label: string; summary: string; detail: string }
> = {
	rail: {
		label: "窄菜单",
		summary: "收成 60px 图标栏",
		detail: "保留一级图标与当前分组的子项,折叠状态下也能直接跳转。",
	},
	hidden: {
		label: "完全隐藏",
		summary: "整条收起,内容区铺满",
		detail: "把宽度让给内容(适合宽表格 / 大屏);点顶栏的菜单按钮随时叫回来。",
	},
};

function isMode(value: unknown): value is SidebarCollapseMode {
	return typeof value === "string" && (SIDEBAR_COLLAPSE_MODES as readonly string[]).includes(value);
}

function readMode(): SidebarCollapseMode {
	if (typeof window === "undefined") return SIDEBAR_COLLAPSE_MODE_DEFAULT;
	try {
		const raw = window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
		return isMode(raw) ? raw : SIDEBAR_COLLAPSE_MODE_DEFAULT;
	} catch {
		// 隐私模式 / 存储被禁:回落默认值,不影响渲染
		return SIDEBAR_COLLAPSE_MODE_DEFAULT;
	}
}

// 模块加载时就完成一次读取(浏览器里),而不是在 getSnapshot 里做副作用 ——
// getSnapshot 会在渲染期间被调用,那里必须保持纯粹。
let current: SidebarCollapseMode = readMode();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot(): SidebarCollapseMode {
	return current;
}

function getServerSnapshot(): SidebarCollapseMode {
	return SIDEBAR_COLLAPSE_MODE_DEFAULT;
}

/** 改「折叠后长什么样」。同一标签页里所有读它的组件会立刻跟着变。 */
export function setSidebarCollapseMode(next: SidebarCollapseMode): void {
	if (current === next) return;
	current = next;
	try {
		window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, next);
	} catch {
		// 写不进去(隐私模式 / 配额满)也不该让设置页崩掉:本次会话内仍然生效
	}
	for (const listener of listeners) listener();
}

/** 当前侧边栏折叠模式(SSR 与首帧为默认值,挂载后校正) */
export function useSidebarCollapseMode(): SidebarCollapseMode {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
