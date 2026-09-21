import { renderToStaticMarkup } from "react-dom/server";

import { NAV_NODES, type NavNode } from "#/components/layout/nav-config";
import { NavItem } from "#/components/layout/sidebar";

function strip(html: string): string {
	return html
		.replace(/<svg[\s\S]*?<\/svg>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Render one node (which may be a parent that renders its own NavPanel) and print
 *  every <a>/<button> with its text + whether it carries text-primary (blue text),
 *  and every line span with whether it carries af-blue-line (blue line). */
function dump(node: NavNode, pathname: string) {
	const html = renderToStaticMarkup(<NavItem node={node} pathname={pathname} depth={0} />);

	console.log(`\n===== pathname=${pathname}  ▸ ${node.name} =====`);
	const itemRe = /<(a|button)([^>]*)>([\s\S]*?)<\/\1>/g;
	let m: RegExpExecArray | null;
	while ((m = itemRe.exec(html))) {
		const attrs = m[2];
		const inner = strip(m[3]);
		const isBlueText = /text-primary(?!-)/.test(attrs) && !/bg-primary/.test(attrs);
		const hasBlueBg = /bg-primary/.test(attrs);
		const flag = isBlueText ? "🔵TEXT" : hasBlueBg ? "🟦BG" : "⚫";
		console.log(`  ${flag}  ${inner.slice(0, 24).padEnd(24)}  [${attrs.match(/class="([^"]*)"/)?.[1]?.slice(0, 70) ?? ""}]`);
	}

	// line spans
	const lineRe = /<span([^>]*)><\/span>/g;
	let li = 0;
	while ((m = lineRe.exec(html))) {
		const attrs = m[1];
		if (/af-blue-line|border-\[color:var\(--border\)\]|bg-\[color:var\(--border\)\]/.test(attrs) === false) continue;
		const isBlue = /af-blue-line/.test(attrs);
		li++;
		console.log(`  ${isBlue ? "🔵LINE" : "⚪line"}  span#${li}  [${attrs.match(/class="([^"]*)"/)?.[1] ?? ""}]`);
	}
}

const tests: Array<[string, string]> = [
	["/", "工作台"],
	["/settings/tags", "系统设置"],
	["/settings/users", "系统设置"],
	["/settings/parameters", "系统设置"],
	["/showcase/ui", "组件展示"],
];

for (const [pathname, rootName] of tests) {
	const root = NAV_NODES.find((n) => n.name === rootName);
	if (root) dump(root, pathname);
}

// Also dump the FULL top-level list for "/settings/tags" to see every top-level item color
console.log(`\n\n########## FULL TOP-LEVEL @ /settings/tags ##########`);
for (const top of NAV_NODES) {
	const html = renderToStaticMarkup(<NavItem node={top} pathname={"/settings/tags"} depth={0} />);
	const itemRe = /<(a|button)([^>]*)>([\s\S]*?)<\/\1>/g;
	let m: RegExpExecArray | null;
	let first = true;
	while ((m = itemRe.exec(html))) {
		const attrs = m[2];
		const inner = strip(m[3]);
		const isBlueText = /text-primary(?!-)/.test(attrs) && !/bg-primary/.test(attrs);
		const hasBlueBg = /bg-primary/.test(attrs);
		if (first) {
			const flag = isBlueText ? "🔵TEXT" : hasBlueBg ? "🟦BG" : "⚫";
			console.log(`  ${flag}  ${top.name.padEnd(10)} -> ${inner.slice(0, 20)}`);
			first = false;
		}
	}
}
