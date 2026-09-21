// Accurate usage scan: for each file, find any other file that imports it
// (handles relative and alias paths).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "src";
const IGNORE_DIRS = new Set(["node_modules", ".git", ".output"]);

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		if (IGNORE_DIRS.has(name)) continue;
		const p = resolve(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) out.push(...walk(p));
		else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
	}
	return out;
}

const files = walk(ROOT).map((f) => f.replace(`${process.cwd()}/`, ""));
const contents = new Map<string, string>(files.map((f) => [f, readFileSync(f, "utf8")]));

// Build basename (no ext) → files[] index
const byBase = new Map<string, string[]>();
for (const f of files) {
	const base = f.split("/").pop()!.replace(/\.(ts|tsx)$/, "");
	const arr = byBase.get(base) ?? [];
	arr.push(f);
	byBase.set(base, arr);
}

// Index: for each file, list of files that depend on it.
function dependentsOf(target: string): string[] {
	const targetNoExt = target.replace(/\.(ts|tsx)$/, "");
	const targetBase = target.split("/").pop()!.replace(/\.(ts|tsx)$/, "");

	const dependents: string[] = [];
	for (const [other, src] of contents) {
		if (other === target) continue;
		// Match a variety of import specifiers
		const patterns = [
			// import x from "<target>"
			new RegExp(`from\\s+["']${escapeRe(targetNoExt)}["']`),
			// import x from "./<base>" or "../<base>" or "../../<base>"
			new RegExp(`from\\s+["'](?:\\.{1,2}/)+${escapeRe(targetBase)}["']`),
			// import x from "#/.../<base>"
			new RegExp(`from\\s+["']#/[^"']*${escapeRe(targetBase)}["']`),
			// import { X } from "<alias-path>/<base>"
		];
		for (const re of patterns) {
			if (re.test(src)) {
				dependents.push(other);
				break;
			}
		}
	}
	return dependents;
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build usage count map
const usageCount = new Map<string, number>();
for (const f of files) {
	usageCount.set(f, dependentsOf(f).length);
}

// Report per directory, sorted by usage
function reportDir(dir: string, threshold = 3) {
	const prefix = dir.endsWith("/") ? dir : `${dir}/`;
	const inDir = files
		.filter((f) => f.startsWith(prefix))
		.sort((a, b) => (usageCount.get(a) ?? 0) - (usageCount.get(b) ?? 0));
	console.log(`\n=== ${prefix} (${inDir.length} files) ===`);
	for (const f of inDir) {
		const base = f.split("/").pop()!;
		const c = usageCount.get(f) ?? 0;
		if (c > threshold) continue;
		const marker = c === 0 ? "❌" : "⚠️ ";
		console.log(`  ${marker} ${base.padEnd(34)} ${c}`);
	}
}

reportDir("src/components/ui", 999);
reportDir("src/components/modules/shared", 999);
reportDir("src/components/layout", 999);