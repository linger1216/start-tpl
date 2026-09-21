/**
 * Pure-logic replica of sidebar.tsx's className decisions (transcribed verbatim
 * from the current source so we can verify which items/lines get blue WITHOUT
 * needing the React/router/trpc render context).
 *
 * The only job: for a given pathname, print every menu item's text color
 * (blue = text-primary, else black) and every connector line's color
 * (blue = af-blue-line, else gray border).
 */

import { NAV_NODES, type NavNode } from "#/components/layout/nav-config";

function isPathMatch(pathname: string, path: string): boolean {
	if (path === "/") return pathname === "/";
	return pathname === path || pathname.startsWith(`${path}/`);
}

type Verdict = { name: string; depth: number; textBlue: boolean; lineBlue: boolean };

// ── mirrors NavItem (parent branch) + NavPanel (lines) ──────────────
function walk(node: NavNode, pathname: string, depth: number, out: Verdict[]) {
	const hasChildren = !!node.children?.length;

	if (hasChildren) {
		// parent text color (mirrors sidebar.tsx NavItem parent branch — exact path match only)
		const isAccent = !!node.path && pathname === node.path;
		out.push({ name: node.name, depth, textBlue: isAccent, lineBlue: false });

		const children = node.children!;
		children.forEach((child, index) => {
			const childActive = !!child.path && isPathMatch(pathname, child.path);
			// NEW logic: connector lights only when THIS child is selected
			const lineLit = childActive; // vertical line for this row
			const elbowLit = index === 0 && childActive; // elbow belongs to first child only
			out.push({ name: `└─ ${child.name}`, depth: depth + 1, textBlue: childActive, lineBlue: index === 0 ? elbowLit : lineLit });
			walk(child, pathname, depth + 1, out);
		});
		return;
	}

	const active = !!node.path && isPathMatch(pathname, node.path);
	out.push({ name: node.name, depth, textBlue: active, lineBlue: false });
}

function run(pathname: string) {
	console.log(`\n════════ pathname = ${pathname} ════════`);
	const out: Verdict[] = [];
	for (const top of NAV_NODES) walk(top, pathname, 0, out);
	for (const v of out) {
		const indent = "  ".repeat(v.depth);
		const txt = v.textBlue ? "🔵TEXT" : "⚫text";
		const ln = v.lineBlue ? "🔵LINE" : "⚪line";
		console.log(`${indent}${txt}  ${ln}  ${v.name}`);
	}
}

// The exact scenarios the user complained about
run("/settings/tags"); // 标签管理 selected → user says line is on 用户管理, many texts blue
run("/settings/users"); // 用户管理 selected
run("/"); // 工作台 selected
run("/showcase/ui"); // 基础组件 selected
