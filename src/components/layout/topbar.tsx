import { Link, useLocation } from "@tanstack/react-router";
import { Bell, ChevronRight, LogOut, Menu, Moon, Plus, Search, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { THEME_STORAGE_KEY } from "#/lib/constants";
import { findVisibleNavTrail } from "./nav-config";
import { useGrantedNavPermissions } from "./nav-permissions";

type Crumb = { label: string; href?: string };

type ThemeMode = "light" | "dark";

/** 读主题偏好:有存储值就用它,否则回落到系统偏好 —— 与 __root.tsx 的引导脚本同规则。 */
function readTheme(): ThemeMode {
	if (typeof window === "undefined") return "light";
	const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
	if (stored === "light" || stored === "dark") return stored;
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function buildCrumbs(pathname: string, granted: ReadonlySet<string> | null = null): Crumb[] {
	// 命中菜单的路径:面包屑完全由 nav-config 派生 —— 与侧边栏同一份来源,不会再漂移
	// `granted` 非空时按权限过滤:被隐藏的菜单不进面包屑(见 nav-permissions.tsx)
	const trail = findVisibleNavTrail(pathname, granted);
	if (trail.length > 0) {
		if (trail.length === 1 && trail[0].path === "/") return [{ label: trail[0].name }];
		return [
			{ label: "首页", href: "/" },
			...trail.map((node, i) => ({
				label: node.name,
				// 分组节点(无 path)与最后一级不可点
				href: i === trail.length - 1 ? undefined : node.path,
			})),
		];
	}

	// 未登记在菜单里的路径兜底:已知段落用中文名,其余按原始段落显示
	const map: Record<string, string> = {
		settings: "设置",
		demo: "示例",
		table: "数据表格",
		form: "表单",
		store: "状态",
		drizzle: "数据库",
	};
	const parts = pathname.split("/").filter(Boolean);
	if (parts.length === 0) return [{ label: "工作台" }];
	const out: Crumb[] = [{ label: "首页", href: "/" }];
	parts.forEach((p, i) => {
		const label = map[p] ?? p;
		const href = i === parts.length - 1 ? undefined : "/" + parts.slice(0, i + 1).join("/");
		out.push({ label, href });
	});
	return out;
}

/** 当前页面是否在档案/数据相关路径下 —— 用于决定主 CTA 文案。 */
function primaryCtaLabel(pathname: string): { label: string; icon: "plus" | "check" } | null {
	if (pathname.startsWith("/archive/cases")) return { label: "新建案件", icon: "plus" };
	if (pathname.startsWith("/settings/users")) return { label: "新增用户", icon: "plus" };
	if (pathname.startsWith("/settings/roles")) return { label: "新增角色", icon: "plus" };
	if (pathname.startsWith("/settings/groups")) return { label: "新增分组", icon: "plus" };
	if (pathname.startsWith("/visit")) return { label: "新建巡查", icon: "plus" };
	return null;
}

export function Topbar({ username, onToggle }: { username: string; onToggle: () => void }) {
	const { pathname } = useLocation();
	const granted = useGrantedNavPermissions();
	const crumbs = useMemo(() => buildCrumbs(pathname, granted), [pathname, granted]);
	const [theme, setTheme] = useState<ThemeMode>("light");
	const cta = primaryCtaLabel(pathname);

	// 与 __root.tsx 的主题引导脚本共用同一个键与同一条回落规则(无存储值 → 系统偏好),
	// 否则首屏会先按系统偏好渲染、再被这里纠正,出现闪烁。
	useEffect(() => {
		const initial = readTheme();
		setTheme(initial);
		document.documentElement.classList.toggle("dark", initial === "dark");
	}, []);

	const toggleTheme = () => {
		const next: ThemeMode = theme === "light" ? "dark" : "light";
		setTheme(next);
		document.documentElement.classList.toggle("dark", next === "dark");
		window.localStorage.setItem(THEME_STORAGE_KEY, next);
	};

	const handleSignOut = () => {
		// 鉴权未接：占位提示
		console.warn("[topbar] signOut 占位（鉴权未接通）");
	};

	return (
		<header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/95 px-5 backdrop-blur-md">
			{/* ── 左:菜单 + 面包屑 ──────────────────────────────────────── */}
			<div className="flex min-w-0 items-center gap-3">
				<Button variant="ghost" size="icon" onClick={onToggle} aria-label="切换侧边栏" className="size-8">
					<Menu className="size-4" />
				</Button>
				<nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
					{crumbs.map((c, i) => (
						<span key={`${c.label}:${c.href ?? ""}`} className="flex items-center gap-1.5">
							{i > 0 && <ChevronRight className="size-3.5 opacity-40" aria-hidden="true" />}
							{c.href ? (
								<Link
									to={c.href}
									className="rounded-md px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
								>
									{c.label}
								</Link>
							) : (
								<span
									style={{
										background: "var(--af-blue-soft)",
										color: "var(--af-blue)",
									}}
									className="rounded-md px-2 py-0.5 font-medium"
								>
									{c.label}
								</span>
							)}
						</span>
					))}
				</nav>
			</div>

			{/* ── 右:搜索 + 主操作 + 通知 + 主题 + 用户 ──────────────────── */}
			<div className="flex items-center gap-1.5">
				{/* 搜索 —— 蓝调聚焦环 + 圆形快捷键徽标 */}
				<div className="search-input hidden md:block">
					<Search aria-hidden="true" />
					<Input
						placeholder="搜索页面 / 档案 / 主体"
						className="h-9 w-[280px] border-transparent bg-secondary pr-12 pl-9 text-[13px] transition-colors focus-visible:border-primary"
					/>
					<span className="shortcut">⌘ K</span>
				</div>

				{/* 页面相关主 CTA —— 与路由联动 */}
				{cta ? (
					<Button size="sm" className="ml-1 gap-1.5 shadow-[var(--shadow-glow)]">
						<Plus className="size-3.5" />
						{cta.label}
					</Button>
				) : null}

				{/* 通知 */}
				<Button variant="ghost" size="icon" aria-label="通知" className="relative size-8">
					<Bell className="size-4" />
					<span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-danger ring-2 ring-background" />
				</Button>

				{/* 主题 */}
				<Button variant="ghost" size="icon" aria-label="切换主题" onClick={toggleTheme} className="size-8">
					{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
				</Button>

				<div className="mx-1 h-5 w-px bg-border" />

				{/* 用户 */}
				<div className="flex items-center gap-2">
					<div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-medium text-foreground">
						{username.slice(0, 1)}
					</div>
					<span className="hidden text-[13px] sm:block">{username}</span>
				</div>

				<Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-1.5 text-[12px]">
					<LogOut className="size-3.5" />
					<span className="hidden sm:inline">退出</span>
				</Button>
			</div>
		</header>
	);
}
