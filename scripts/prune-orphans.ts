// Iterative orphan pruning: repeatedly find files with 0 dependents and report them.
// Only PRINTS (does not delete) — safe to inspect before acting.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "src";

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = resolve(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) out.push(...walk(p));
		else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
	}
	return out;
}

// Entry points that must never be pruned (framework loads these by convention)
const ENTRY_POINTS = new Set([
	"src/router.tsx",
	"src/routeTree.gen.ts",
	"src/routes/__root.tsx",
	"src/routes/(main)/route.tsx",
	"src/routes/(main)/index.tsx",
	"src/routes/api.trpc.$.tsx",
	"src/routes/api/auth/$.ts",
	"src/styles.css",
	"src/integrations/trpc/init.ts",
	"src/integrations/trpc/router.ts",
	"src/integrations/trpc/react.ts",
	"src/integrations/tanstack-query/root-provider.tsx",
	"src/db/index.ts",
	"src/db/schema.ts",
	"src/db/data-base-schema.ts",
	"src/lib/auth.ts",
	"src/lib/auth-client.ts",
]);

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
	let files = walk(ROOT).map((f) => f.replace(`${process.cwd()}/`, ""));
	const contents = new Map<string, string>(files.map((f) => [f, readFileSync(f, "utf8")]));

	// Only consider pruning in these dirs (don't touch lib/, integrations/, db/, routes/)
	const PRUNABLE = ["src/components/ui/", "src/components/modules/shared/", "src/components/layout/"];

	let round = 0;
	while (true) {
		round++;
		const orphans: string[] = [];
		for (const f of files) {
			if (!PRUNABLE.some((p) => f.startsWith(p))) continue;
			if (ENTRY_POINTS.has(f)) continue;
			const targetNoExt = f.replace(/\.(ts|tsx)$/, "");
			const base = f.split("/").pop()!.replace(/\.(ts|tsx)$/, "");
			const pascal = base[0].toUpperCase() + base.slice(1);

			let used = false;
			for (const [other, src] of contents) {
				if (other === f) continue;
				if (
					new RegExp(`from\\s+["']${escapeRe(targetNoExt)}["']`).test(src) ||
					new RegExp(`from\\s+["'](?:\\.{1,2}/)+${escapeRe(base)}["']`).test(src) ||
					new RegExp(`from\\s+["']#/[^"']*${escapeRe(base)}["']`).test(src) ||
					new RegExp(`<${pascal}\\b`).test(src)
				) {
					used = true;
					break;
				}
			}
			if (!used) orphans.push(f);
		}

		if (orphans.length === 0) {
			console.log(`\n✅ round ${round}: no more orphans`);
			break;
		}
		console.log(`\n=== round ${round}: ${orphans.length} orphans ===`);
		for (const o of orphans.sort()) console.log(`  ${o}`);

		// Remove them for next round
		files = files.filter((f) => !orphans.includes(f));
		for (const o of orphans) contents.delete(o);

		if (round > 10) {
			console.log("\n⚠️ too many rounds, stopping");
			break;
		}
	}
}

main();