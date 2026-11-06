import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("派生时隔离数据库配置,初始化失败后不执行建表或种子", {
	skip: !existsSync(path.join(root, "new-project.sh")),
}, () => {
	const temp = mkdtempSync(path.join(tmpdir(), "stack-scaffold-test-"));
	try {
		const template = path.join(temp, "template");
		const targetRoot = path.join(temp, "projects");
		const bin = path.join(temp, "bin");
		const calls = path.join(temp, "calls");
		mkdirSync(targetRoot);
		mkdirSync(bin);
		cpSync(root, template, {
			recursive: true,
			filter: (source) => {
				const name = path.basename(source);
				return !["node_modules", ".git", ".output", ".tanstack", ".env.local"].includes(name);
			},
		});
		writeFileSync(path.join(bin, "pnpm"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$SCAFFOLD_TEST_CALLS"\n`, {
			mode: 0o755,
		});
		// 用替身拒绝建库,避免测试访问任何数据库。
		writeFileSync(path.join(template, "scripts/init-db.mjs"), "process.exit(1);\n");
		const scenarios = [
			{
				name: "derived-dm",
				source: "dm://user:password@localhost:5236?schema=original&loginEncrypt=false",
				expected: /^DATABASE_URL=$/m,
			},
			{
				name: "derived-same",
				source: "mysql://user:password@localhost:3306/derived_same",
				expected: /^DATABASE_URL=$/m,
			},
			{
				name: "derived-mysql",
				source: "mysql://user:password@localhost:3306/original?charset=utf8mb4",
				expected: /\/derived_mysql\?charset=utf8mb4/,
			},
		];
		const passwords = new Set<string>();
		for (const scenario of scenarios) {
			writeFileSync(
				path.join(template, ".env.local"),
				`DATABASE_URL="${scenario.source}"\nINITIAL_ADMIN_PASSWORD=old-password\n`,
			);
			const result = spawnSync(
				"bash",
				[path.join(template, "new-project.sh"), scenario.name, "--all", "--no-input", "--into", targetRoot],
				{
					encoding: "utf8",
					env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SCAFFOLD_TEST_CALLS: calls },
				},
			);
			assert.equal(result.status, 1, result.stderr);
			const env = readFileSync(path.join(targetRoot, scenario.name, ".env.local"), "utf8");
			assert.match(env, scenario.expected);
			const password = env.match(/^INITIAL_ADMIN_PASSWORD=(.+)$/m)?.[1];
			assert.ok(password && password.length >= 8 && password !== "old-password");
			passwords.add(password);
			assert.doesNotMatch(env, /schema=original/);
			assert.doesNotMatch(result.stdout, /数据库初始化已全量完成/);
		}
		assert.equal(passwords.size, scenarios.length);
		assert.doesNotMatch(readFileSync(calls, "utf8"), /db:create|db:seed/);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("自动建库拒绝非 MySQL 和不安全的数据库名", () => {
	const temp = mkdtempSync(path.join(tmpdir(), "stack-init-db-test-"));
	try {
		for (const url of ["dm://user:pass@localhost:5236?schema=original", "mysql://user:pass@localhost:3306/bad-name"]) {
			writeFileSync(path.join(temp, ".env.local"), `DATABASE_URL="${url}"\n`);
			const result = spawnSync(process.execPath, [path.join(root, "scripts/init-db.mjs"), "--root", temp], {
				encoding: "utf8",
			});
			assert.equal(result.status, 1);
		}
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
