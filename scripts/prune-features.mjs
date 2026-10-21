#!/usr/bin/env node
/**
 * 按 `features.json` 裁剪一个**已派生**的项目目录 —— 由 `new-project.sh` 调用,也可单独跑。
 *
 * 设计取舍(与仓库既有风格一致:`tests/auth.test.ts` 的分类守卫、"漏了就直接红"):
 *  - 规则写在 `features.json` 里(可 review、可 diff),**不在源码里插标记** ——
 *    模板的注册点分散在 10 个文件、形态各异(一行一个 / 一个对象块),标记会污染每一个文件;
 *  - **每条规则必须命中**:命中 0 处就**中止并打印规则原文**。
 *    模板重构后规则失配会当场红,而不是产出一个半残项目;
 *  - 裁完再扫一遍**悬空引用**(代码文件里不该再出现被删域的 import / 标识符)。
 *
 * 用法:
 *   node scripts/prune-features.mjs --root <dir> --features task-close,notice [--dry-run]
 *   node scripts/prune-features.mjs --selftest          # 只校验规则能否命中当前模板,不写盘
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(HERE, "..");
/** 代码文件(悬空引用只扫这些;md 里的提及只报告,不算错) */
const CODE_EXT = /\.(ts|tsx|mjs|js|json)$/;

function arg(name, fallback = null) {
	let i = process.argv.indexOf(`--${name}`);
	if (i < 0 && name === "features") {
		i = process.argv.indexOf("--modules");
	}
	if (i < 0) return fallback;
	const next = process.argv[i + 1];
	// `--features ""`(= 一个功能都不留)是**合法输入**:空串不是"没给"
	if (next === undefined || next.startsWith("--")) return fallback;
	return next;
}
const has = (name) => process.argv.includes(`--${name}`);

const selftest = has("selftest");
const dryRun = has("dry-run") || selftest;
const root = path.resolve(selftest ? TEMPLATE_ROOT : (arg("root") ?? ""));
const manifestPath = path.resolve(arg("manifest") ?? path.join(TEMPLATE_ROOT, "features.json"));

// `--list-ids` / `--pick` 只读清单,不需要目标目录;真正裁剪时才要求 --root
if (!selftest && !has("list-ids") && !has("pick") && !arg("root")) {
	console.error("Error: 需要 --root <目录>(或 --selftest)");
	process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const byId = new Map(manifest.features.map((f) => [f.id, f]));

/** 逗号列表 → 选中的功能(含依赖闭包;`-x` 表示不要) */
function resolveSelection(raw) {
	const on = new Set();
	const off = new Set();
	for (const piece of raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)) {
		if (piece.startsWith("-")) off.add(piece.slice(1));
		else on.add(piece);
	}
	const add = (id, why) => {
		if (on.has(id)) return;
		const feature = byId.get(id);
		if (!feature) throw new Error(`features.json 里没有这个功能: ${id}`);
		on.add(id);
		autoAdded.push(`${id}(${why})`);
		for (const need of feature.requires ?? []) add(need, `被 ${id} 依赖`);
	};
	const autoAdded = [];
	for (const id of [...on]) {
		if (!byId.has(id)) throw new Error(`features.json 里没有这个功能: ${id}`);
	}
	for (const id of [...on]) {
		byId.get(id).requires?.forEach((need) => {
			add(need, `被 ${id} 依赖`);
		});
	}
	for (const id of off) {
		if (!on.has(id)) continue;
		// 依赖闭包在 `-x` 之前跑过:被别的已选功能依赖的项,关不掉
		const dependents = [...on].filter((other) => other !== id && (byId.get(other).requires ?? []).includes(id));
		if (dependents.length > 0) {
			if (!has("quiet")) console.warn(`  注意: ${id} 被 ${dependents.join("、")} 依赖,"-${id}" 未生效`);
			continue;
		}
		on.delete(id);
	}
	return { selected: [...on], autoAdded };
}

// ─────────────────────────── 规则实现 ───────────────────────────

const rules = {
	/** 删文件 / 目录;支持最后一段的 `*` 通配 */
	paths(target, list) {
		let n = 0;
		for (const rel of list) {
			if (rel.includes("*")) {
				const dir = path.dirname(rel);
				const pattern = path.basename(rel);
				const abs = path.join(target, dir);
				if (!fs.existsSync(abs)) continue;
				const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
				for (const entry of fs.readdirSync(abs)) {
					if (!re.test(entry)) continue;
					remove(path.join(abs, entry));
					n += 1;
				}
				continue;
			}
			const abs = path.join(target, rel);
			if (!fs.existsSync(abs)) continue;
			remove(abs);
			n += 1;
		}
		return { hits: n, detail: `${n} 条路径` };
	},

	/**
	 * 删行。三种匹配方式(可同时给,命中数取并集):
	 *  - `matches`:trim() 后**逐字相等**
	 *  - `prefixes`:trim() 后**以此开头**(按表逐行的注释行 / 行表格条目,前缀比整行稳)
	 *  - `plus`:`matches` 命中后连它后面 N 行一起删(`key:` 与下一行的值是分开写的)
	 */
	lines(target, rule) {
		const file = path.join(target, rule.file);
		if (!fs.existsSync(file)) return { hits: 0, detail: "", missingFile: rule.file };
		const before = fs.readFileSync(file, "utf8").split("\n");
		const wanted = new Set(rule.matches ?? []);
		const prefixes = rule.prefixes ?? [];
		const plus = rule.plus ?? 0;
		const drop = new Set();
		let hits = 0;
		for (let i = 0; i < before.length; i += 1) {
			const trimmed = before[i].trim();
			const hit = wanted.has(trimmed) || prefixes.some((p) => trimmed.startsWith(p));
			if (!hit) continue;
			hits += 1;
			for (let j = i; j <= i + (wanted.has(trimmed) ? plus : 0); j += 1) drop.add(j);
		}
		if (!dryRun && hits > 0) {
			fs.writeFileSync(file, before.filter((_, i) => !drop.has(i)).join("\n"));
		}
		const expected = (rule.matches?.length ?? 0) + (rule.prefixes?.length ?? 0);
		return { hits, detail: `${hits} 行`, min: rule.min ?? Math.max(1, expected) };
	},

	/**
	 * 删**所有**匹配的块:`begin` 行 → `end` 行(含两端)。
	 *  - `back`:把起点上溯到最近的锚行(否则起点就是 `begin` 那行)
	 *  - `dropLeadingComments`:再把起点**紧挨着的**注释行一起吃进去
	 *    (形如 `/** 说明 *␘` / `// 说明` 的条目注释;不吃掉就会变成悬空注释)
	 */
	block(target, rule) {
		const file = path.join(target, rule.file);
		if (!fs.existsSync(file)) return { hits: 0, detail: "", missingFile: rule.file };
		const original = fs.readFileSync(file, "utf8").split("\n");
		const beginRe = new RegExp(rule.begin);
		const endRe = new RegExp(rule.end);
		const backRe = rule.back ? new RegExp(rule.back) : null;
		const commentRe = /^\s*(\/\*|\*|\/\/)/;
		const drop = new Set();
		const spans = [];
		let hits = 0;
		for (let cursor = 0; cursor < original.length; cursor += 1) {
			if (drop.has(cursor) || !beginRe.test(original[cursor])) continue;
			let start = cursor;
			if (backRe) {
				for (let i = cursor - 1; i >= 0; i -= 1) {
					if (backRe.test(original[i])) {
						start = i;
						break;
					}
				}
			}
			if (rule.dropLeadingComments) {
				while (start > 0 && commentRe.test(original[start - 1])) start -= 1;
			}
			let end = -1;
			for (let i = cursor; i < original.length; i += 1) {
				if (endRe.test(original[i])) {
					end = i;
					break;
				}
			}
			if (end < 0) continue;
			for (let i = start; i <= end; i += 1) drop.add(i);
			spans.push(`${start + 1}-${end + 1}`);
			hits += 1;
			cursor = end;
		}
		if (!dryRun && hits > 0) {
			fs.writeFileSync(file, original.filter((_, i) => !drop.has(i)).join("\n"));
		}
		return { hits, detail: hits > 0 ? `${rule.file} 删 ${spans.join(",")} 行` : "begin/end 未命中" };
	},

	/** 删「from "<模块>"」的整条 import(支持多行形态:往上找到 `import` 那一行) */
	imports(target, rule) {
		const file = path.join(target, rule.file);
		if (!fs.existsSync(file)) return { hits: 0, detail: "", missingFile: rule.file };
		const lines = fs.readFileSync(file, "utf8").split("\n");
		const drop = new Set();
		let hits = 0;
		for (const want of rule.from) {
			const idx = lines.findIndex((line, i) => !drop.has(i) && line.includes(`from "${want}"`));
			if (idx < 0) continue;
			let start = idx;
			for (let i = idx; i >= 0; i -= 1) {
				if (/^\s*import\b/.test(lines[i])) {
					start = i;
					break;
				}
			}
			for (let i = start; i <= idx; i += 1) drop.add(i);
			hits += 1;
		}
		if (!dryRun && hits > 0) {
			fs.writeFileSync(file, lines.filter((_, i) => !drop.has(i)).join("\n"));
		}
		return { hits, detail: `${hits}/${rule.from.length} 条 import`, min: rule.from.length };
	},

	/** 删 JSON 键(`scripts.db:seed:demo` 这种带冒号的键也支持:只按 `.` 分层) */
	json(target, rule) {
		const file = path.join(target, rule.file);
		if (!fs.existsSync(file)) return { hits: 0, detail: "", missingFile: rule.file };
		const data = JSON.parse(fs.readFileSync(file, "utf8"));
		let hits = 0;
		for (const dotted of rule.matches) {
			const parts = dotted.split(".");
			const key = parts.pop();
			let node = data;
			for (const part of parts) node = node?.[part];
			if (node && Object.hasOwn(node, key)) {
				delete node[key];
				hits += 1;
			}
		}
		if (!dryRun && hits > 0) fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
		return { hits, detail: `${hits}/${rule.matches.length} 个键`, min: rule.matches.length };
	},

	/** 定点字面量替换(必须恰好命中 `count` 次,默认 1) */
	replace(target, rule) {
		const file = path.join(target, rule.file);
		if (!fs.existsSync(file)) return { hits: 0, detail: "", missingFile: rule.file };
		const text = fs.readFileSync(file, "utf8");
		const count = text.split(rule.from).length - 1;
		const want = rule.count ?? 1;
		if (count !== want) return { hits: count, detail: `命中 ${count} 次(期望 ${want})`, min: want };
		if (!dryRun) fs.writeFileSync(file, text.replace(rule.from, rule.to));
		return { hits: 1, detail: `替换 ${rule.from.slice(0, 40)}…` };
	},
};

function remove(abs) {
	if (dryRun) return;
	fs.rmSync(abs, { recursive: true, force: true });
}

const KINDS = ["paths", "lines", "block", "imports", "json", "replace"];

/** 应用一个功能的全部规则;返回 {ok, rows} */
function applyFeature(target, feature) {
	const rows = [];
	const fail = (kind, rule, extra) => {
		rows.push({ ok: false, kind, at: rule.file ?? `paths`, extra });
	};
	if (feature.paths?.length) {
		if (selftest) {
			// 先确认"清单里声明的路径都在模板中",防止清单过期
			const missing = feature.paths.filter((rel) => !rel.includes("*") && !fs.existsSync(path.join(target, rel)));
			if (missing.length > 0) {
				fail("paths", { file: missing.join(", ") }, "模板路径不存在(清单过期?)");
			} else {
				const res = rules.paths(target, feature.paths);
				rows.push({ ok: true, kind: "paths", at: `${feature.paths.length} 条`, extra: res.detail });
			}
		} else {
			// 针对派生目标目录: 若拷贝阶段已按模块排除，未拷贝的文件直接视为已排除；若有残留则执行删除
			const res = rules.paths(target, feature.paths);
			rows.push({ ok: true, kind: "paths", at: `${feature.paths.length} 条`, extra: res.detail || "已在拷贝时按模块排除" });
		}
	}
	for (const rule of feature.rules ?? []) {
		if (!KINDS.includes(rule.kind)) {
			fail(rule.kind, rule, "未知规则种类");
			continue;
		}
		const res = rules[rule.kind](target, rule);
		const min = res.min ?? 1;
		if (res.hits < min) {
			fail(
				rule.kind,
				rule,
				`${res.detail || `${res.hits} 处命中`}${res.missingFile ? `(${res.missingFile} 不存在)` : ""}`,
			);
			continue;
		}
		rows.push({ ok: true, kind: rule.kind, at: rule.file, extra: res.detail });
	}
	return { ok: rows.every((r) => r.ok), rows };
}

/** 悬空引用扫描:被删域的标识符不该再出现在代码文件里 */
function danglingScan(target, removed) {
	const tokens = removed.flatMap((f) => f.tokens ?? []);
	if (tokens.length === 0) return [];
	const hits = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue;
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(abs);
				continue;
			}
			if (!CODE_EXT.test(entry.name)) continue;
			const rel = path.relative(target, abs);
			if (rel.startsWith("doc/") || rel.endsWith(".md")) continue;
			const text = fs.readFileSync(abs, "utf8");
			for (const token of tokens) {
				if (text.includes(token)) hits.push(`${rel} ← ${token}`);
			}
		}
	};
	walk(target);
	return [...new Set(hits)];
}

// ─────────────────────────── 主流程 ───────────────────────────

/**
 * `--pick`:交互式勾选(不带 `--features` 时由 new-project.sh 调用)。
 * `--list-ids`:只打印全部功能 id(`--all` 用,免得 bash 去 require 这个 JSON)。
 * 非 tty / `--no-input` 时直接用推荐值 —— 脚本化调用不会卡住。
 */
if (has("list-ids")) {
	process.stdout.write(`${manifest.features.map((f) => f.id).join(",")}\n`);
	process.exit(0);
}

if (has("list-excluded-paths")) {
	const raw = arg("features", "");
	const { selected } = resolveSelection(raw);
	const selectedSet = new Set(selected);
	const unselected = manifest.features.filter((f) => !selectedSet.has(f.id));
	const paths = unselected.flatMap((f) => f.paths ?? []);
	process.stdout.write(`${paths.join("\n")}\n`);
	process.exit(0);
}

if (has("pick")) {
	const chosen = new Set(manifest.features.filter((f) => f.default === true).map((f) => f.id));
	const interactive = !has("no-input") && process.stdin.isTTY;
	const render = () => {
		console.log("");
		console.log("选择要带进新项目的业务模块(想要哪些就给它们打 x):");
		console.log("  · 输入编号切换勾选,可一次给多个(如 2 4,也认模块 id 如 task-close);回车 = 确认");
		console.log("  · all 全要 / none 只要底座 minimal");
		console.log("");
		let index = 0;
		for (const feature of manifest.features) {
			index += 1;
			const mark = chosen.has(feature.id) ? "✓" : " ";
			const star = feature.default === true ? "·默认" : "     ";
			const deps = feature.requires?.length ? `  (依赖 ${feature.requires.join("、")})` : "";
			console.log(`  [${mark}] ${String(index).padStart(2)}  ${star}  ${feature.name}${deps}`);
			if (feature.description) console.log(`        ${feature.description}`);
		}
		if (manifest.pending?.length) {
			console.log("");
			console.log(`  ⛩ 底座核心(一律包含,不参与选择)：${manifest.pending.map((p) => p.id).join("、")}`);
		}
		console.log("");
	};
	if (interactive) {
		render();
		for (;;) {
			process.stdout.write("> ");
			const line = readLine();
			if (line === null) break;
			const text = line.trim();
			if (text === "") break;
			if (text === "all") {
				manifest.features.forEach((f) => {
					chosen.add(f.id);
				});
			} else if (text === "none" || text === "minimal") {
				chosen.clear();
			} else {
				for (const piece of text.split(/[\s,]+/).filter(Boolean)) {
					const n = Number(piece);
					const feature = Number.isInteger(n) && n > 0 ? manifest.features[n - 1] : undefined;
					const byId = !feature && manifest.features.find((f) => f.id === piece);
					const target = feature ?? byId;
					if (!target) {
						console.log(`  忽略无效编号/模块 id:${piece}`);
						continue;
					}
					if (chosen.has(target.id)) chosen.delete(target.id);
					else chosen.add(target.id);
				}
			}
			render();
		}
	}
	const order = manifest.features.filter((f) => chosen.has(f.id)).map((f) => f.id);
	if (has("no-input")) console.log(`非交互环境(管道 / --no-input):按推荐值保留 ${order.length} 项(要挑模块,在真终端跑 new-project.sh 用编号勾选,或 --modules a,b)`);
	process.stdout.write(`FEATURES=${order.join(",")}\n`);
	process.exit(0);
}

function readLine() {
	const buffer = Buffer.alloc(1);
	let line = "";
	for (;;) {
		let read = 0;
		try {
			read = fs.readSync(0, buffer, 0, 1, null);
		} catch {
			return line.length > 0 ? line : null;
		}
		if (read === 0) return line.length > 0 ? line : null;
		const ch = buffer.toString("utf8");
		if (ch === "\n") return line;
		if (ch !== "\r") line += ch;
	}
}

// 试跑 = 把**所有功能**都当作"要剔除"(于是每条规则都会被执行一遍,只校验能否命中,不写盘)
const featuresArg = arg("features", selftest ? "" : null);
if (featuresArg === null) {
	console.error("Error: 需要 --features a,b(或 --selftest)");
	process.exit(2);
}
const selection = resolveSelection(featuresArg);
const selected = selection.selected;
const selectedSet = new Set(selected);

if (!dryRun && !fs.existsSync(root)) {
	console.error(`Error: 目录不存在: ${root}`);
	process.exit(2);
}

console.log("");
console.log(`功能裁剪(${dryRun ? "试跑" : "写盘"}):保留 ${selected.length} 项 / 共 ${manifest.features.length} 项`);
if (selection.autoAdded.length > 0) {
	console.log(`  自动补齐依赖:${selection.autoAdded.join("、")}`);
}

let failed = 0;
const removedFeatures = manifest.features.filter((f) => !selectedSet.has(f.id));
for (const feature of removedFeatures) {
	const { rows } = applyFeature(root, feature);
	const bad = rows.filter((r) => !r.ok);
	if (bad.length === 0) {
		console.log(`  ✓ 剔除「${feature.name}」`);
	} else {
		failed += bad.length;
		console.log(`  ✗ 剔除「${feature.name}」有 ${bad.length} 条规则没命中:`);
		for (const row of bad) console.log(`      ${row.kind} @ ${row.at} —— ${row.extra}`);
	}
}

// 过程数自校验:core + Σ 所选 == 模板里的 EXPECTED_PROCEDURES,并改写那一行
const loggingTest = path.join(root, "tests/logging.test.ts");
if (!dryRun && fs.existsSync(loggingTest)) {
	const keptProcedures =
		(manifest.core.procedures ?? 0) + selected.reduce((sum, id) => sum + (byId.get(id).procedures ?? 0), 0);
	const text = fs.readFileSync(loggingTest, "utf8");
	const found = /const EXPECTED_PROCEDURES = (\d+);/.exec(text);
	if (!found) {
		console.log("  ✗ tests/logging.test.ts 里找不到 EXPECTED_PROCEDURES,无法重算");
		failed += 1;
	} else if (
		Number(found[1]) !==
		manifest.core.procedures + manifest.features.reduce((s, f) => s + (f.procedures ?? 0), 0)
	) {
		console.log(
			`  ✗ features.json 的 procedures 之和(${manifest.core.procedures + manifest.features.reduce((s, f) => s + (f.procedures ?? 0), 0)})` +
				`与模板常量(${found[1]})对不上 —— 加过接口就要同步清单`,
		);
		failed += 1;
	} else {
		fs.writeFileSync(loggingTest, text.replace(found[0], `const EXPECTED_PROCEDURES = ${keptProcedures};`));
		console.log(`  ✓ EXPECTED_PROCEDURES -> ${keptProcedures}(按所选功能重算)`);
	}
}

// 先把清单与 pruner 自己带走(它们描述"模板怎么裁",对新项目没意义)
// —— 必须在悬空引用扫描**之前**:清单自己就写着所有被删域的标识符。
if (!dryRun) {
	fs.rmSync(path.join(root, "features.json"), { force: true });
	fs.rmSync(path.join(root, "scripts/prune-features.mjs"), { force: true });
}

// 悬空引用检查
if (!dryRun) {
	const dangling = danglingScan(root, removedFeatures);
	if (dangling.length > 0) {
		console.log(`  ✗ 悬空引用 ${dangling.length} 处(说明还有规则没写全):`);
		for (const hit of dangling.slice(0, 20)) console.log(`      ${hit}`);
		failed += dangling.length;
	} else {
		console.log("  ✓ 无悬空引用");
	}
}

// 报告:表 / 种子 / 文档 / 提示
const removedTables = removedFeatures.flatMap((f) => f.tables ?? []);
const keptSeeds = [...(manifest.core.seeds ?? []), ...selected.flatMap((id) => byId.get(id).seeds ?? [])];
const droppedSeeds = removedFeatures.flatMap((f) => f.seeds ?? []);
const hints = removedFeatures.flatMap((f) => (f.hints ?? []).map((h) => `[${f.name}] ${h}`));

console.log("");
if (removedTables.length > 0) console.log(`不再建的表:${removedTables.join(" / ")}`);
if (droppedSeeds.length > 0) console.log(`不再需要的种子:${droppedSeeds.join(" / ")}`);
if (hints.length > 0) {
	console.log("提示:");
	for (const hint of hints) console.log(`  - ${hint}`);
}
if (keptSeeds.length > 0) console.log(`建议先跑的种子:${[...new Set(keptSeeds)].join(" / ")}`);

if (failed > 0) {
	console.error("");
	console.error(`Error: 裁剪失败(${failed} 处)。模板可能已经重构 —— 请同步 features.json 里的规则后重试。`);
	process.exit(1);
}
console.log(dryRun ? "试跑完成:所有规则都能命中 ✓" : "裁剪完成 ✓");
