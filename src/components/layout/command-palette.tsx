/**
 * 全局快捷键面板(⌘K / Ctrl+K)。
 *
 * 设计原则:
 *  1. **不依赖 `cmdk` 包**:pnpm store 在沙箱里读不到,绕开 —— 自己实现「按词模糊 + 命中权重」,
 *     模板里要的功能(关键词分组、上/下/回车)足够用。
 *  2. **数据源是 `NAV_NODES`**:菜单列表是模板里最权威的"可达页面"清单;新增页面改 `nav-config.ts` 即可。
 *  3. **键盘约定**:Mac ⌘K,Win/Linux Ctrl+K 都能打开;ESC 关闭;↑↓ 选择;Enter 跳转;
 *     `onClose` 用 Radix `onOpenChange` 串起来,避免状态分裂。
 *  4. **不带记忆/搜索历史**:模板不需要;派生新项目再加(常见做法是 localStorage 缓存最近 10 条)。
 */
import { useNavigate } from "@tanstack/react-router";
import { Command } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { NAV_NODES, type NavNode } from "./nav-config";

type Item = { id: string; name: string; path: string; group: string; description?: string };

/** 扁平化 `NAV_NODES` 为一条「可跳转」列表。父菜单(无 path 但有 children)只用作分组。 */
function flattenNav(nodes: NavNode[]): Item[] {
	const out: Item[] = [];
	const walk = (list: NavNode[], group: string) => {
		for (const node of list) {
			if (node.path) {
				out.push({
					id: `${group}::${node.path}`,
					name: node.name,
					path: node.path,
					group,
					description: node.description,
				});
			}
			if (node.children) walk(node.children, node.name);
		}
	};
	for (const node of nodes) walk(node.children ? node.children : [node], node.name);
	return out;
}

/**
 * 简单模糊匹配 + 命中权重:
 *  - 完全包含(子串)按「越靠前 + 名字越短」打分;
 *  - 拆分多关键词(空格分隔),全部命中才返回;
 *  - 没命中 ⇒ 排到末尾但保留(`group.includes` 仍可命中搜索词)。
 */
function score(item: Item, tokens: string[]): number {
	if (tokens.length === 0) return 1; // 空查询全展示
	const haystack = `${item.name} ${item.path} ${item.group} ${item.description ?? ""}`.toLowerCase();
	for (const t of tokens) {
		if (!haystack.includes(t)) return -1;
	}
	// 命中得分 = 「名字前缀命中」权重 + 「命中位置」
	const idx = item.name.toLowerCase().indexOf(tokens[0] ?? "");
	return 1000 - (idx < 0 ? 999 : idx) - item.name.length;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (next: boolean) => void }) {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [highlight, setHighlight] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const items = useMemo(() => flattenNav(NAV_NODES), []);
	const filtered = useMemo(() => {
		const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const ranked = items
			.map((item) => ({ item, s: score(item, tokens) }))
			.filter((x) => x.s >= 0)
			.sort((a, b) => b.s - a.s)
			.slice(0, 20);
		return ranked.map((x) => x.item);
	}, [items, query]);

	// 打开时聚焦输入框 + 重置选中项 + 清空查询
	useEffect(() => {
		if (open) {
			setQuery("");
			setHighlight(0);
			// 用 rAF 让 Dialog 把 portal 渲染出来后再 focus
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	// 命中变化时回正 selected
	useEffect(() => {
		if (highlight >= filtered.length) setHighlight(0);
	}, [filtered, highlight]);

	const choose = (idx: number) => {
		const target = filtered[idx];
		if (!target) return;
		onOpenChange(false);
		void navigate({ to: target.path });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl gap-0 p-0 overflow-hidden" aria-describedby={undefined}>
				<DialogTitle className="sr-only">快捷键面板</DialogTitle>
				<div className="flex items-center gap-2 border-b border-border px-3 py-2">
					<Command className="size-4 text-muted-foreground" aria-hidden />
					<Input
						ref={inputRef}
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setHighlight(0);
						}}
						onKeyDown={(e) => {
							if (e.key === "ArrowDown") {
								e.preventDefault();
								setHighlight((h) => (filtered.length === 0 ? 0 : (h + 1) % filtered.length));
							} else if (e.key === "ArrowUp") {
								e.preventDefault();
								setHighlight((h) => (filtered.length === 0 ? 0 : (h - 1 + filtered.length) % filtered.length));
							} else if (e.key === "Enter") {
								e.preventDefault();
								choose(highlight);
							}
						}}
						placeholder="搜页面或菜单(空格分多关键词)..."
						className="border-0 bg-transparent shadow-none focus-visible:ring-0 px-0 h-8"
					/>
					<kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted-foreground">
						ESC
					</kbd>
				</div>
				<ul className="max-h-80 overflow-auto" aria-label="可跳转菜单项">
					{filtered.length === 0 ? (
						<li className="px-4 py-8 text-center text-sm text-muted-foreground">没搜到相关页面</li>
					) : (
						filtered.map((item, idx) => (
							<li key={item.id}>
								<Button
									variant="ghost"
									className={`w-full justify-start gap-3 rounded-none px-4 py-2 h-auto ${idx === highlight ? "bg-accent text-accent-foreground" : ""}`}
									onClick={() => choose(idx)}
									onMouseEnter={() => setHighlight(idx)}
								>
									<span className="text-xs text-muted-foreground shrink-0 w-16 truncate text-left">{item.group}</span>
									<span className="flex-1 text-left">
										<div className="font-medium">{item.name}</div>
										<div className="text-xs text-muted-foreground font-mono">{item.path}</div>
									</span>
								</Button>
							</li>
						))
					)}
				</ul>
				<div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
					<span>
						<kbd className="rounded border border-border px-1 mr-1">↑↓</kbd>
						选择
					</span>
					<span>
						<kbd className="rounded border border-border px-1 mr-1">Enter</kbd>
						跳转
					</span>
					<span>{filtered.length} 条结果</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** 全局快捷键监听:`⌘K`(Mac)或 `Ctrl+K`(其它)切换开关。挂到根组件。 */
export function useCommandPaletteShortcut(): {
	open: boolean;
	setOpen: (next: boolean) => void;
} {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setOpen((cur) => !cur);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	return { open, setOpen };
}
