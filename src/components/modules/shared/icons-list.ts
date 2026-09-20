/**
 * lucide-react 图标集合 + 名称解析工具。
 *
 * 命名约定(与 src/components/layout/sidebar.tsx 的 iconMap、scripts/seed.ts 一致):
 *  - 数据库中存「小写 kebab-case」名,如 map-pin / tree-pine / dashboard
 *  - lucide-react 模块导出的是 PascalCase 组件,如 MapPin / TreePine / LayoutDashboard
 *
 * resolveLucideIconKey 按此约定解析:原样 → kebab→Pascal → legacy 别名表。
 * 未命中的名字由组件层渲染占位圆点,绝不渲染"方块"(createLucideIcon 空 path 兜底已移除)。
 */

import type { LucideProps } from "lucide-react";
import * as icons from "lucide-react";

/** 模块自身顶级键(去掉 `Icon` 后缀别名,去重) */
const uniqueKeys: string[] = (() => {
	const seen = new Set<string>();
	for (const k of Object.keys(icons)) {
		if (k === "default") continue;
		const stripped = k.endsWith("Icon") ? k.slice(0, -4) : k;
		seen.add(stripped);
	}
	return Array.from(seen).sort();
})();

/** 全量图标名数组 —— PascalCase 字符串 */
export const ALL_LUCIDE_ICONS: readonly string[] = Object.freeze(uniqueKeys);

/** 模块预置的"常用图标"——IconPicker 打开时第一屏出现。 */
export const PINNED_ICONS: readonly string[] = Object.freeze([
	"Home",
	"Users",
	"User",
	"Settings",
	"Shield",
	"LayoutDashboard",
	"BarChart3",
	"Layers",
	"Map",
	"MapPin",
	"Building2",
	"Trees",
	"Database",
	"SlidersHorizontal",
	"Menu",
	"Plus",
	"Edit",
	"Trash2",
	"FileText",
]);

/**
 * kebab-case 旧名 → 现代 lucide 名的兼容映射
 * (kebab→Pascal 兜不到的名才需要在这里补)。
 */
export const LEGACY_ALIAS: Record<string, string> = {
	dashboard: "LayoutDashboard",
	poi: "MapPin",
	region: "Map",
	community: "Building2",
	village: "Home",
	"bar-chart": "BarChart3",
};

/** kebab-case → PascalCase("map-pin" → "MapPin") */
export function toPascalCase(kebab: string): string {
	return kebab
		.split("-")
		.filter(Boolean)
		.map((s) => s[0]!.toUpperCase() + s.slice(1))
		.join("");
}

/** PascalCase → kebab-case("LayoutDashboard" → "layout-dashboard") */
export function toKebabCase(pascal: string): string {
	return pascal
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase();
}

/**
 * 把任意存库名(原样 / kebab / Pascal)解析成 lucide 模块中存在的 key。
 * 解析不到返回 null(组件层渲染占位,不抛错)。
 */
export function resolveLucideIconKey(name: string | null | undefined): string | null {
	if (!name) return null;
	const raw = name.trim();
	if (!raw) return null;
	if (Object.hasOwn(icons, raw)) return raw;
	const pascal = toPascalCase(raw);
	if (Object.hasOwn(icons, pascal)) return pascal;
	const alias = LEGACY_ALIAS[raw];
	if (alias && Object.hasOwn(icons, alias)) return alias;
	return null;
}

/** lucide 图标组件 props 的最小子集。 */
export type IconProps = Omit<LucideProps, "ref" | "name"> & {
	name: string | null | undefined;
	className?: string;
};

/** 把 PascalCase 名字转成友好可搜索标签 */
export function iconToLabel(name: string): string {
	return name
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.toLowerCase()
		.trim();
}
