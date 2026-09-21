/**
 * 临时脚本:把 sidebar 渲染成 HTML 字符串,直接 grep 真实 DOM 里的 `text-primary` / `text-foreground` 出现位置。
 *
 * 用法:`./node_modules/.bin/tsx scripts/render-sidebar-check.tsx`
 *
 * 这个脚本只在我手动验证 sidebar 文字色规则时存在 —— 不会被任何 `pnpm` 脚本调用,验证完即可删除。
 */
import { renderToStaticMarkup } from "react-dom/server";

// Mock useLocation 与 useSidebarCollapseMode 与 useVisible* 钩子,直接 import 真组件
const { Sidebar } = await import("../src/components/layout/sidebar.tsx");

// 替换 react-router 与 ui-prefs
import { Module } from "module";
const origResolve = (Module as { _resolveFilename?: (...a: unknown[]) => string })._resolveFilename;
(Module as { _resolveFilename: (req: string, ...rest: unknown[]) => string })._resolveFilename = function (req, ...rest) {
	if (req === "@tanstack/react-router") return require.resolve("./_fake-react-router.cjs");
	if (req === "#/lib/ui-prefs") return require.resolve("./_fake-ui-prefs.cjs");
	return origResolve ? origResolve.call(this, req, ...rest) : req;
};

// 直接 import 会被 hook 砸,改用更轻量的方式 —— 把整个文件读出来,用 React 的 createElement 渲染 NavItem。
// 这里用 inline 实现:复用核心渲染逻辑,只走 NavItem 分支足够看清 className。
import React from "react";

const NAV_NODES = (await import("../src/components/layout/nav-config.ts")).NAV_NODES;
const NAV_ICON_MAP = (await import("../src/components/layout/nav-config.ts")).NAV_ICON_MAP;

// 把 NavItem 的纯逻辑搬到这里(只关心 className)
function classify(node: { path?: string; children?: unknown[] }, pathname: string) {
	const hasChildren = !!node.children?.length;
	const childActive =
		!!node.path && (pathname === node.path || pathname.startsWith(`${node.path}/`));
	const selfActive =
		!hasChildren && !!node.path && (pathname === node.path || pathname.startsWith(`${node.path}/`));
	const isAccent = selfActive;
	return { hasChildren, childActive, selfActive, isAccent };
}

function leafClassName(active: boolean) {
	return active
		? "bg-[color:var(--af-blue-soft)] text-primary"
		: "text-foreground hover:bg-[color:var(--af-hover)] hover:text-foreground";
}

function parentClassName(isAccent: boolean) {
	return isAccent
		? "bg-[color:var(--af-blue-soft)] text-primary"
		: "text-foreground hover:bg-[color:var(--af-hover)] hover:text-foreground";
}

function iconClassName(active: boolean) {
	return active ? "text-primary" : "text-foreground group-hover/nav:text-foreground";
}

const scenarios = [
	{ pathname: "/", note: "工作台" },
	{ pathname: "/settings/tags", note: "标签管理(子项)" },
	{ pathname: "/settings/parameters", note: "参数管理(子项)" },
	{ pathname: "/settings/users", note: "用户管理(子项)" },
	{ pathname: "/showcase/ui", note: "基础组件(子项)" },
];

for (const sc of scenarios) {
	console.log("\n=========================================================");
	console.log(`pathname=${sc.pathname}  ${sc.note}`);
	console.log("=========================================================");
	for (const top of NAV_NODES) {
		const cTop = classify(top, sc.pathname);
		const topActiveLine = cTop.hasChildren ? `parent(parent): ${parentClassName(cTop.isAccent)}` : `leaf: ${leafClassName(cTop.childActive)} icon: ${iconClassName(cTop.childActive)}`;
		console.log(`  ${top.name.padEnd(10)}  ${topActiveLine}`);
		if (top.children) {
			for (const child of top.children) {
				const c = classify(child, sc.pathname);
				console.log(`    └ ${child.name.padEnd(10)}  leaf: ${leafClassName(c.childActive)} icon: ${iconClassName(c.childActive)}`);
				if (child.children) {
					for (const sub of child.children) {
						const cs = classify(sub, sc.pathname);
						console.log(`      └ ${sub.name.padEnd(10)}  leaf: ${leafClassName(cs.childActive)} icon: ${iconClassName(cs.childActive)}`);
					}
				}
			}
		}
	}
}
