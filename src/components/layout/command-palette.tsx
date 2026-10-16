/**
 * 全局快捷键面板(⌘K / Ctrl+K)。
 *
 * 设计原则:
 *  1. **不依赖 `cmdk` 包**:pnpm store 在沙箱里读不到,绕开 —— 自己实现「按词模糊 + 命中权重」,
 *     模板里要的功能(关键词分组、上/下/回车)足够用。
 *  2. **数据源与侧边栏同源**:`useNavNodes()`(`menu.mine`,已按当前用户角色过滤)——
 *     授权不到的页面不会出现在这里(否则 ⌘K 会变成绕过菜单授权的后门)。
 *  3. **键盘约定**:Mac ⌘K,Win/Linux Ctrl+K 都能打开;ESC 关闭;↑↓ 选择;Enter 跳转;
 *     `onClose` 用 Radix `onOpenChange` 串起来,避免状态分裂。
 *  4. **不带记忆/搜索历史**:模板不需要;派生新项目再加(常见做法是 localStorage 缓存最近 10 条)。
 */
import { useNavigate } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { DocDot, MetaRow } from "#/components/ui/typography";
import { cn } from "#/lib/utils.ts";
import { NAV_ICON_MAP, type NavNode } from "./nav-config";
import { useNavNodes } from "./nav-data";

type Item = { id: string; name: string; path: string; icon: string; group: string; description?: string };
type FlatRow = { item: Item; flatIndex: number }; // flatIndex = 在扁平列表里的序号(键盘跳第 N 条要用)

/** 扁平化导航树为一条「可跳转」列表。父菜单(无 path 但有 children)只用作分组。 */
function flattenNav(nodes: NavNode[]): Item[] {
	const out: Item[] = [];
	const walk = (list: NavNode[], group: string) => {
		for (const node of list) {
			if (node.path) {
				out.push({
					id: `${group}::${node.path}`,
					name: node.name,
					path: node.path,
					icon: node.icon,
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
	const listRef = useRef<HTMLUListElement | null>(null);
	// 各行 DOM 引用表 —— 「跳到第 N 条」/「选中滚到可见」都用它。
	const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

	const nodes = useNavNodes();
	const items = useMemo(() => flattenNav(nodes), [nodes]);
	const filtered = useMemo(() => {
		const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		return items
			.map((item) => ({ item, s: score(item, tokens) }))
			.filter((x) => x.s >= 0)
			.sort((a, b) => b.s - a.s)
			.slice(0, 20)
			.map((x) => x.item);
	}, [items, query]);

	// 按 group 顺序聚合 ——
	// 排序后第一个 group 不一定就是菜单里出现顺序的第一个 group,所以先按 group 名稳定排序再列。
	const grouped = useMemo(() => {
		const order: string[] = [];
		const map = new Map<string, Item[]>();
		for (const item of filtered) {
			const list = map.get(item.group);
			if (list) list.push(item);
			else {
				order.push(item.group);
				map.set(item.group, [item]);
			}
		}
		// 给扁平行表 + 头部标记 —— 后续键盘/滚动/highlight 都按 flatIndex 算。
		const rows: FlatRow[] = [];
		for (const g of order) {
			for (const it of map.get(g) ?? []) rows.push({ item: it, flatIndex: rows.length });
		}
		return { order, map, rows };
	}, [filtered]);

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
		if (highlight >= grouped.rows.length) setHighlight(0);
	}, [grouped, highlight]);

	// 选中项滚到可见 —— 用 block:nearest(就差一点点也只滚一点点),避免列表抖。
	useEffect(() => {
		const node = itemRefs.current[highlight];
		node?.scrollIntoView({ block: "nearest" });
	}, [highlight]);

	const choose = (idx: number) => {
		const target = grouped.rows[idx]?.item;
		if (!target) return;
		onOpenChange(false);
		void navigate({ to: target.path });
	};

	// 「跳到第 N 条」:Mac 模式 ⌘1-⌘9;Win/Linux 用 Ctrl+1-Ctrl+9。
	// Nth = 当下查询结果里的第 N 行(flatIndex)。
	const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlight((h) => (grouped.rows.length === 0 ? 0 : (h + 1) % grouped.rows.length));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlight((h) => (grouped.rows.length === 0 ? 0 : (h - 1 + grouped.rows.length) % grouped.rows.length));
		} else if (e.key === "Enter") {
			e.preventDefault();
			choose(highlight);
		} else if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
			const n = Number(e.key) - 1;
			if (n < grouped.rows.length) {
				e.preventDefault();
				choose(n);
			}
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-3xl gap-3 bg-popover/85 p-0 shadow-raise-3 overflow-hidden rounded-2xl"
				aria-describedby={undefined}
			>
				<DialogTitle className="sr-only">快捷键面板</DialogTitle>
				{/* ── 召唤章:印泥红圆章 + ⌘,打开这一眼播一次盖章动效(重挂载触发,→ Seal 的 stamped 同款) ── */}
				<div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
					<span key={String(open)} aria-hidden>
						<span
							className={`inline-grid size-7 shrink-0 place-items-center rounded-full border-2 border-seal/65 bg-seal/5 text-seal-fg opacity-92 ${open ? "seal-stamp" : ""}`}
							style={{ ["--seal-stamp" as string]: "-6deg" }}
						>
							<span className="font-heading text-xs leading-none font-bold">⌘</span>
						</span>
					</span>
					<Input
						ref={inputRef}
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setHighlight(0);
						}}
						onKeyDown={handleKey}
						placeholder="搜页面或菜单(空格分多关键词;⌘1-9 跳第 N 条)..."
						className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
					/>
				</div>
				<ul ref={listRef} className="max-h-120 overflow-auto py-1" aria-label="可跳转菜单项">
					{grouped.rows.length === 0 ? (
						<li className="flex flex-col items-center gap-2 px-4 py-10">
							<span
								aria-hidden
								className="inline-grid size-8 place-items-center rounded-full border-2 border-muted-foreground/35 bg-muted/50 text-muted-foreground/60 opacity-92"
								style={{ transform: "rotate(-6deg)" }}
							>
								<span className="font-heading text-[10px] leading-none font-bold">空</span>
							</span>
							<span className="text-xs tracking-wider text-muted-foreground">没搜到相关页面 —— 换个关键词试试</span>
						</li>
					) : (
						grouped.order.map((groupName) => {
							const list = grouped.map.get(groupName) ?? [];
							return (
								<li key={groupName}>
									{/* 分组头 = 版记行:细线上界 + 加宽字距,钉在滚动区顶 */}
									<div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/20 px-4 py-1.5 backdrop-blur-sm">
										<span className="text-xs tracking-[0.08em] text-muted-foreground">{groupName}</span>
									</div>
									<ul>
										{list.map((item) => {
											const flatIndex = grouped.rows.findIndex((r) => r.item.id === item.id);
											const isHighlight = flatIndex === highlight;
											const Icon = NAV_ICON_MAP[item.icon as keyof typeof NAV_ICON_MAP] ?? Layers;
											return (
												<li
													key={item.id}
													ref={(el) => {
														itemRefs.current[flatIndex] = el;
													}}
													className="mx-2 my-0.5 first:mt-1.5"
												>
													<button
														type="button"
														onMouseEnter={() => setHighlight(flatIndex)}
														onClick={() => choose(flatIndex)}
														className={`relative flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-1 focus-visible:ring-primary/15 ${
															isHighlight
																? // 选中行 = 树选中行同款:左缘 3px 墨标 + 淡蓝面板 + 主色描边(排序树 is-selected 的原样)
																	"border-primary/40 bg-primary/8 "
																: "border-transparent hover:border-hue-blue-line hover:bg-hover"
														}`}
													>
														<Icon className={cn("size-3.5 shrink-0 transition-colors duration-150", "text-primary")} />
														<span className="flex-1 text-sm">{item.name}</span>
														<span className="font-mono text-xs text-muted-foreground">{item.path}</span>
														{flatIndex < 9 ? (
															<kbd className="hidden rounded-[2px] border border-border bg-secondary/60 px-1 text-[10px] text-muted-foreground sm:inline-flex">
																⌘{flatIndex + 1}
															</kbd>
														) : null}
													</button>
												</li>
											);
										})}
									</ul>
								</li>
							);
						})
					)}
				</ul>
				<div className="border-t border-border px-4 py-2">
					<MetaRow className="justify-between">
						<span className="flex items-center gap-3">
							<span className="flex items-center gap-1.5">
								<kbd className="rounded-[2px] border border-border bg-secondary/60 px-1 text-[10px]">↑↓</kbd>
								选择
							</span>
							<DocDot />
							<span className="flex items-center gap-1.5">
								<kbd className="rounded-[2px] border border-border bg-secondary/60 px-1 text-[10px]">Enter</kbd>
								跳转
							</span>
							<DocDot />
							<span className="flex items-center gap-1.5">
								<kbd className="rounded-[2px] border border-border bg-secondary/60 px-1 text-[10px]">⌘1-9</kbd>
								跳第 N 条
							</span>
						</span>
						<span className="tabular-nums">{grouped.rows.length} 条结果</span>
					</MetaRow>
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
