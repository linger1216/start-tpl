/**
 * LucideIcon 组件 + 数据 re-export。
 *
 * 数据与解析逻辑见同目录 `icons-list.ts`(纯 .ts,便于 vitest 测试)。
 * 渲染约定:存库名可能是 kebab-case / PascalCase / legacy 旧名,
 * 统一经 resolveLucideIconKey 解析;解析不到 → 占位圆点(绝不渲染方块)。
 */

import type { LucideProps } from "lucide-react";
import * as icons from "lucide-react";
import type * as React from "react";
import { cn } from "#/lib/utils";

import { type IconProps, resolveLucideIconKey } from "./icons-list";

export {
	ALL_LUCIDE_ICONS,
	iconToLabel,
	LEGACY_ALIAS,
	PINNED_ICONS,
	resolveLucideIconKey,
	toKebabCase,
	toPascalCase,
} from "./icons-list";

type IconComponent = React.ComponentType<LucideProps>;

/**
 * 按存库名(原样 / kebab / Pascal)渲染 lucide 图标。
 * 解析不到 → 占位圆点(保留尺寸占位,不抛错、不画方块)。
 */
export function LucideIcon({ name, className, ...props }: IconProps) {
	const key = resolveLucideIconKey(name);
	if (!key) {
		return <span aria-hidden className={cn(className, "inline-block rounded-full bg-muted")} />;
	}
	const Cmp = (icons as unknown as Record<string, unknown>)[key] as IconComponent | undefined;
	if (!Cmp) {
		return <span aria-hidden className={cn(className, "inline-block rounded-full bg-muted")} />;
	}
	return <Cmp className={className} {...props} />;
}
