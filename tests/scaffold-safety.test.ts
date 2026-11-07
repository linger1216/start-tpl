import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("功能选择先取消再补依赖，结果与取消顺序无关", {
	skip: !existsSync(path.join(root, "scripts/prune-features.mjs")),
}, () => {
	const excluded = (features: string) =>
		spawnSync(process.execPath, ["scripts/prune-features.mjs", "--list-excluded-paths", "--features", features], {
			cwd: root,
			encoding: "utf8",
		});
	const first = excluded("task-close,notice,-notice,-task-close");
	const second = excluded("task-close,notice,-task-close,-notice");
	assert.equal(first.status, 0, first.stderr);
	assert.equal(second.status, 0, second.stderr);
	assert.equal(first.stdout, second.stdout);
	assert.ok(first.stdout.split("\n").includes("src/lib/use-notice-sse.ts"));
	const required = excluded("task-close,-notice");
	assert.equal(required.status, 0, required.stderr);
	assert.ok(!required.stdout.split("\n").includes("src/lib/use-notice-sse.ts"));
	assert.match(required.stderr, /notice.*依赖/);
	const unknown = excluded("-not-a-feature");
	assert.notEqual(unknown.status, 0);
	assert.match(unknown.stderr, /没有这个功能/);
});

test("裁掉可选模块后仍能生成路由并通过类型检查", {
	skip: !existsSync(path.join(root, "scripts/prune-features.mjs")),
}, () => {
	const temp = mkdtempSync(path.join(tmpdir(), "stack-prune-test-"));
	try {
		const excluded = spawnSync(
			process.execPath,
			["scripts/prune-features.mjs", "--list-excluded-paths", "--features", ""],
			{
				cwd: root,
				encoding: "utf8",
			},
		);
		assert.equal(excluded.status, 0, excluded.stderr);
		assert.ok(!excluded.stdout.split("\n").includes("src/routes/(main)/index.tsx"));
		for (const features of ["tests", "workbench,tests", "demo,notice,workbench,tests"]) {
			const target = path.join(temp, features.replaceAll(",", "-"));
			cpSync(root, target, {
				recursive: true,
				filter: (source) =>
					!["node_modules", ".git", ".output", ".tanstack", ".pnpm-store", ".env.local"].includes(
						path.basename(source),
					),
			});
			symlinkSync(path.join(root, "node_modules"), path.join(target, "node_modules"), "dir");
			for (const [command, args] of [
				[process.execPath, ["scripts/prune-features.mjs", "--root", ".", "--features", features]],
				["./node_modules/.bin/tsr", ["generate"]],
				["./node_modules/.bin/tsc", ["--noEmit"]],
			] as const) {
				const result = spawnSync(command, args, { cwd: target, encoding: "utf8", timeout: 120_000 });
				assert.equal(result.status, 0, `${features}: ${command}\n${result.stdout}\n${result.stderr}`);
			}
			assert.ok(existsSync(path.join(target, "src/routes/(main)/index.tsx")), `${features} 缺少首页路由`);
			assert.match(readFileSync(path.join(target, "src/routeTree.gen.ts"), "utf8"), /routes\/\(main\)\/index/);
			const { dependencies } = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
			for (const dependency of ["@tanstack/react-form", "@tanstack/react-store", "@tanstack/store"]) {
				assert.equal(
					Object.hasOwn(dependencies, dependency),
					features.split(",").includes("demo"),
					`${features}: ${dependency}`,
				);
			}
			if (!features.split(",").includes("workbench")) {
				const home = readFileSync(path.join(target, "src/routes/(main)/index.tsx"), "utf8");
				assert.match(home, /EmptyState/);
				assert.doesNotMatch(home, /WorkbenchPage/);
			}
			if (features === "tests") {
				const guards = spawnSync(
					process.execPath,
					["--import", "tsx", "--test", "--test-name-pattern=分类守卫|数据范围守卫", "tests/auth.test.ts"],
					{ cwd: target, encoding: "utf8", timeout: 120_000 },
				);
				assert.equal(guards.status, 0, `${features}: 权限分类守卫\n${guards.stdout}\n${guards.stderr}`);
			}
		}
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

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
			{
				name: "derived-minimal",
				source: "mysql://user:password@localhost:3306/original",
				expected: /\/derived_minimal/,
				minimal: true,
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
				[
					path.join(template, "new-project.sh"),
					scenario.name,
					scenario.minimal ? "--minimal" : "--all",
					"--no-input",
					"--into",
					targetRoot,
				],
				{
					encoding: "utf8",
					env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SCAFFOLD_TEST_CALLS: calls },
				},
			);
			assert.equal(result.status, 1, result.stderr);
			assert.ok(existsSync(path.join(targetRoot, scenario.name, ".env.local")), result.stdout + result.stderr);
			const env = readFileSync(path.join(targetRoot, scenario.name, ".env.local"), "utf8");
			assert.match(env, scenario.expected);
			const password = env.match(/^INITIAL_ADMIN_PASSWORD=(.+)$/m)?.[1];
			assert.ok(password && password.length >= 8 && password !== "old-password");
			passwords.add(password);
			assert.doesNotMatch(env, /schema=original/);
			assert.doesNotMatch(result.stdout, /数据库初始化已全量完成/);
			assert.ok(existsSync(path.join(targetRoot, scenario.name, "src/routes/(main)/index.tsx")));
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
