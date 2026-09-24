/**
 * 图标**清单** + 名称解析工具 —— 纯数据 / 纯字符串逻辑,没有任何 lucide 运行时 import。
 *
 * 命名约定(与 `layout/nav-config.ts` 的 `NAV_ICON_MAP`、数据库里存的值一致):
 *  - 库里存「小写 kebab-case」名,如 map-pin / file-text
 *  - lucide 导出的是 PascalCase 组件,如 MapPin / FileText
 *
 * ⚠️ **图标是策展的**:下面的 `ICON_NAMES` 就是本模板支持的图标全集,
 * 实际组件在 `use-lucide-icons.tsx` 里**逐个显式 import**。
 * 为什么不全量:`import * as icons from "lucide-react"` 会把 1500+ 个图标打进客户端 ——
 * 实测菜单页那个 chunk 因此涨到 600K(同等页面 100~150K),而图标选择器只有菜单页用。
 * 要加图标:`ICON_NAMES` 加一行 + `use-lucide-icons.tsx` 加一行,`pnpm typecheck` 会立刻
 * 告诉你名字写错没有(拼错 = 找不到导出,编译期就报)。
 *
 * 未命中的名字由组件层渲染占位圆点,绝不渲染"方块"。
 */

import type { LucideProps } from "lucide-react";

/** 支持的图标(kebab-case)—— 唯一真源,顺序即选择器里的默认展示顺序 */
export const ICON_NAMES: readonly string[] = Object.freeze([
	"clipboard-list",
	"file-text",
	"key-round",
	"layout-panel-top",
	"list-checks",
	"message-square",
	"refresh-cw",
	"shield-alert",
	"sliders-horizontal",
	"boxes",
	"cable",
	"contact",
	"database",
	"library",
	"menu",
	"settings",
	"table",
	"tags",
	"users",
	"workflow",
	"building-2",
	"layout-dashboard",
	"bar-chart-3",
	"map-pin",
	"trees",
	"home",
	"user",
	"shield",
	"layers",
	"map",
	"plus",
	"pencil",
	"trash-2",
	"search",
	"x",
	"check",
	"chevron-down",
	"chevron-right",
	"chevron-left",
	"chevron-up",
	"arrow-right",
	"arrow-left",
	"arrow-up",
	"arrow-down",
	"arrow-up-down",
	"more-horizontal",
	"more-vertical",
	"eye",
	"eye-off",
	"lock",
	"unlock",
	"bell",
	"bell-off",
	"mail",
	"phone",
	"send",
	"inbox",
	"archive",
	"trash",
	"calendar",
	"clock",
	"history",
	"timer",
	"folder",
	"folder-open",
	"folder-tree",
	"file",
	"files",
	"image",
	"star",
	"heart",
	"flag",
	"filter",
	"download",
	"upload",
	"printer",
	"save",
	"copy",
	"external-link",
	"link",
	"info",
	"alert-circle",
	"alert-triangle",
	"help-circle",
	"circle-check",
	"circle-x",
	"circle-alert",
	"panel-left",
	"panel-right",
	"columns-3",
	"grid-3x3",
	"list",
	"list-ordered",
	"activity",
	"pie-chart",
	"trending-up",
	"trending-down",
	"line-chart",
	"wallet",
	"credit-card",
	"shopping-cart",
	"package",
	"truck",
	"compass",
	"globe",
	"wifi",
	"server",
	"cpu",
	"hard-drive",
	"cloud",
	"sun",
	"moon",
	"briefcase",
	"graduation-cap",
	"book-open",
	"newspaper",
	"rss",
	"share-2",
	"grip-vertical",
	"maximize",
	"minimize",
	"scan",
	"user-plus",
	"user-check",
	"user-x",
	"users-round",
	"shield-check",
	"shield-x",
	"key",
	"fingerprint",
	"building",
	"briefcase-business",
	"landmark",
	"scale",
	"gavel",
	"box",
	"blocks",
	"component",
	"puzzle",
	"sparkles",
	"palette",
]);

/** kebab → Pascal 之后的集合(名称解析与去重都按它) */
export const ICON_KEYS: ReadonlySet<string> = new Set(
	ICON_NAMES.map((kebab) =>
		kebab
			.split("-")
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(""),
	),
);

/** 全部图标名数组(PascalCase)—— 图标选择器的数据源 */
export const ALL_LUCIDE_ICONS: readonly string[] = Object.freeze(Array.from(ICON_KEYS).sort());

/** 选择器打开时第一屏出现的"常用图标"(PascalCase) */
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
	"Pencil",
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
 * 把任意存库名(原样 / kebab / Pascal)解析成**清单里**的 key。
 * 解析不到返回 null(组件层渲染占位,不抛错)。
 */
export function resolveLucideIconKey(name: string | null | undefined): string | null {
	if (!name) return null;
	const raw = name.trim();
	if (!raw) return null;
	if (ICON_KEYS.has(raw)) return raw;
	const pascal = toPascalCase(raw);
	if (ICON_KEYS.has(pascal)) return pascal;
	const alias = LEGACY_ALIAS[raw];
	if (alias && ICON_KEYS.has(alias)) return alias;
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
