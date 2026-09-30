/**
 * 图标清单 —— 纯逻辑单测(不需要数据库)。
 *
 * 为什么值得测:图标是**策展**的(`icons-list.ts` 的 `ICON_NAMES`),而库里 / 导航里存的是
 * kebab-case 名字。两者一旦对不上,界面上不会报错 —— 只会**静默渲染成占位圆点**
 * (`LucideIcon` 的兜底),菜单看上去"图标没了"却查不出原因。
 *
 * 所以这里把"项目真正用到的图标名"逐个走一遍解析,断言它们都落在清单里。
 * 加图标时忘了改清单 → 这个测试立刻红。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { NAV_ICON_MAP, NAV_NODES } from "../src/components/layout/nav-config.ts";
import {
	ICON_KEYS,
	ICON_NAMES,
	PINNED_ICONS,
	resolveLucideIconKey,
	toKebabCase,
} from "../src/components/modules/shared/icons-list.ts";

test("导航节点的每个 icon 都能解析到清单里", () => {
	const missing = NAV_NODES.map((node) => node.icon as string).filter((name) => resolveLucideIconKey(name) === null);
	assert.deepEqual(missing, [], `这些导航图标不在 ICON_NAMES 里:${missing.join(", ")}`);
});

test("NAV_ICON_MAP 的每个键都能解析到清单里", () => {
	const missing = Object.keys(NAV_ICON_MAP).filter((name) => resolveLucideIconKey(name) === null);
	assert.deepEqual(missing, [], `这些图标名不在 ICON_NAMES 里:${missing.join(", ")}`);
});

test("PINNED_ICONS 都在清单里(否则选择器第一屏会出现占位点)", () => {
	const missing = PINNED_ICONS.filter((name) => !ICON_KEYS.has(name));
	assert.deepEqual(missing, [], `这些常用图标不在 ICON_NAMES 里:${missing.join(", ")}`);
});

test("ICON_NAMES 是干净的:kebab 形态、无重复、走一遍完整往返", () => {
	const seen = new Set<string>();
	const dup: string[] = [];
	for (const name of ICON_NAMES) {
		assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `ICON_NAMES 里应存 kebab-case:${name}`);
		if (seen.has(name)) dup.push(name);
		seen.add(name);

		// ① 库里存的样子 → Pascal(渲染用)
		const pascal = resolveLucideIconKey(name);
		assert.ok(pascal, `${name} 解析不出来`);

		// ② 选择器选中后回存的样子:Picker 存的是 toKebabCase(名字),存完必须还能解析回来。
		//    注意**不要求** toKebabCase(toPascalCase(x)) === x —— 它不拆数字后缀
		//    (`building-2` → `Building2` → `building2`),但两条路都能解析到同一个组件,
		//    所以这里断言的是"存得进去、读得回来",而不是字符串逐字相等。
		const stored = toKebabCase(pascal);
		assert.equal(resolveLucideIconKey(stored), pascal, `${name} 回存成 ${stored} 后解析不回来`);
	}
	assert.deepEqual(dup, [], `ICON_NAMES 有重复:${dup.join(", ")}`);
});
