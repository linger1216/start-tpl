import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("结构检查发现新库建表缺列和缺失的列注释", { skip: !existsSync("src/integrations/trpc/routers/task") }, () => {
	const target = mkdtempSync(path.join(tmpdir(), "schema-drift-"));
	try {
		for (const dir of ["scripts", "src/db"]) mkdirSync(path.join(target, dir), { recursive: true });
		for (const file of [
			"scripts/check-schema-drift.mjs",
			"scripts/create-system-tables.ts",
			"scripts/create-better-auth-tables-dm.ts",
			"scripts/sync-table-meta.ts",
			"src/db/schema.ts",
			"src/db/data-base-schema.ts",
		]) {
			cpSync(path.join(process.cwd(), file), path.join(target, file));
		}
		const ddl = path.join(target, "scripts/create-system-tables.ts");
		const source = readFileSync(ddl, "utf8");
		const damaged = source.replace("\\`viewed_at\\` datetime default null,", "");
		assert.notEqual(damaged, source);
		writeFileSync(ddl, damaged);
		const meta = path.join(target, "scripts/sync-table-meta.ts");
		const comments = readFileSync(meta, "utf8");
		const damagedComments = comments.replace(/\s*\{ table: "sys_user", column: "phone", comment: [^\n]+\n/, "\n");
		assert.notEqual(damagedComments, comments);
		writeFileSync(meta, damagedComments);
		const result = spawnSync(process.execPath, [path.join(target, "scripts/check-schema-drift.mjs")], {
			encoding: "utf8",
		});
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /tc_action\(MySQL\).*viewed_at/);
		assert.match(result.stdout, /sys_user.*phone/);
	} finally {
		rmSync(target, { recursive: true, force: true });
	}
});
