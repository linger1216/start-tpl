import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { ChevronRight, Command, LogOut, Menu, Moon, Search, Sun, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { authClient } from "#/lib/auth-client";
import { THEME_STORAGE_KEY } from "#/lib/constants";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import type { NavNode } from "./nav-config";
import { useNavTrail } from "./nav-data";
import { NotificationBell } from "./notification-bell";
import { UserSwitcher } from "./user-switcher";

type Crumb = { label: string; href?: string };

/** 当前登录用户(由 `(main)/route.tsx` 的 beforeLoad 在服务端取回,经外壳传下来) */
export type SessionUser = { id: string; name: string; email: string };

type ThemeMode = "light" | "dark";

/** 读主题偏好:有存储值就用它,否则回落到系统偏好 —— 与 __root.tsx 的引导脚本同规则。 */
function readTheme(): ThemeMode {
	if (typeof window === "undefined") return "light";
	const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
	if (stored === "light" || stored === "dark") return stored;
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function buildCrumbs(trail: readonly NavNode[], pathname: string): Crumb[] {
	// 命中菜单的路径:面包屑完全由菜单树派生 —— 与侧边栏同一份来源(useNavTrail),不会再漂移
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

	// 未登记在菜单里的路径兜底:按原始段落显示。
	// 路径的中文名**只认菜单树**(见 nav-config.ts:不要在别处再维护第二份映射)
	const parts = pathname.split("/").filter(Boolean);
	if (parts.length === 0) return [{ label: "工作台" }];
	const out: Crumb[] = [{ label: "首页", href: "/" }];
	parts.forEach((p, i) => {
		const href = i === parts.length - 1 ? undefined : `/${parts.slice(0, i + 1).join("/")}`;
		out.push({ label: p, href });
	});
	return out;
}

export function Topbar({ user, onToggle }: { user: SessionUser; onToggle: () => void }) {
	const { pathname } = useLocation();
	const trail = useNavTrail(pathname);
	const crumbs = useMemo(() => buildCrumbs(trail, pathname), [trail, pathname]);
	const router = useRouter();
	const queryClient = useQueryClient();
	const [theme, setTheme] = useState<ThemeMode>("light");

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

	const palette = useCommandPaletteShortcut();

	const handleSignOut = async () => {
		try {
			// ⚠️ 这里必须 try/catch:authClient 返回 { error } 也会**抛**(网络/解析失败),
			// 只判 error 的话异常会变成一个没人管的 rejection —— 用户看到的就是"点了没反应"。
			const { error } = await authClient.signOut();
			if (error) {
				toast.error(error.message ?? "退出失败,请重试");
				return;
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "退出失败,请重试");
			return;
		}
		// 会话已清。**清空 query 缓存**:菜单(`menu.mine`)与权限是"认人"的,
		// 键里不带用户 —— 不清的话换个人登录会命中上一个人的缓存(以前 `menu.list` 是公开数据,所以不需要)。
		queryClient.clear();
		// 先 invalidate 把当前路由的数据/守卫结果作废,再**明确跳**登录页 ——
		// 不依赖"守卫因为 invalidate 而抛出重定向"这条路(那条依赖路由内部行为,不好保证)。
		await router.invalidate();
		await router.navigate({ to: "/login", replace: true });
	};

	return (
		<header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/90 px-5 backdrop-blur-md">
			{/* 头部下沿的一道极淡主色渐隐 —— 把页头和内容区"轻轻分开",比纯 1px 灰线有层次 */}
			<span
				aria-hidden
				className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-hue-blue-line via-transparent to-transparent"
			/>

			{/* ── 左:菜单 + 面包屑 ──────────────────────────────────────── */}
			<div className="flex min-w-0 items-center gap-3">
				<Button variant="ghost" size="icon" onClick={onToggle} aria-label="切换侧边栏" className="size-8">
					<Menu className="size-4" />
				</Button>
				{/* key=pathname:换页时整条面包屑重挂载一次,播放一次进场而不是"原地改字" */}
				<nav
					key={pathname}
					aria-label="breadcrumb"
					className="stagger flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
				>
					{crumbs.map((c, i) => (
						<span key={`${c.label}:${c.href ?? ""}`} className="flex items-center gap-1">
							{i > 0 && <ChevronRight className="size-3.5 opacity-40" aria-hidden="true" />}
							{c.href ? (
								<Link
									to={c.href}
									className="rounded-md px-1.5 py-0.5 transition-colors duration-150 hover:bg-muted hover:text-foreground"
								>
									{c.label}
								</Link>
							) : (
								<Badge className="gap-1.5 bg-brand-soft px-2 font-medium text-primary">
									<span aria-hidden className="size-1.5 rounded-full bg-primary" />
									{c.label}
								</Badge>
							)}
						</span>
					))}
				</nav>
			</div>

			{/* ── 右:通知 + 主题 + 用户 ────────────────────────────────── */}
			<div className="flex items-center gap-1.5">
				{/* ⌘K / Ctrl+K 命令面板入口(也可鼠标点):扁平化菜单树(`useNavNodes()`),关键词模糊命中,Enter 跳转。 */}
				<Button
					variant="ghost"
					size="sm"
					aria-label="打开快捷键面板"
					onClick={() => palette.setOpen(true)}
					className="hidden md:inline-flex h-8 gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-xs text-muted-foreground hover:bg-muted"
				>
					<Search className="size-3.5" />
					<span>搜索</span>
					<kbd className="ml-1 inline-flex items-center gap-0.5 rounded border border-border bg-background px-1 text-xs font-mono">
						<Command className="size-2.5" />K
					</kbd>
				</Button>

				{/* 通知:未读数 + 点开看最近 10 条 + 点一条跳到对应页面(见 doc/通知中心.md) */}
				<NotificationBell />

				{/* 主题:切换时图标原地转着换出来(icon-swap 绑 key 重挂载) */}
				<Button variant="ghost" size="icon" aria-label="切换主题" onClick={toggleTheme} className="size-8">
					<span key={theme} className="icon-swap flex">
						{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
					</span>
				</Button>

				{/* 切换用户(运维):只有拿到「切换用户」权限的人才会渲染 —— 见 lib/menu-spec.ts 的 IMPERSONATE_PERM */}
				<UserSwitcher currentUser={{ id: user.id, name: user.name || user.email }} />

				<div className="mx-1 h-5 w-px bg-border" />

				{/* 用户菜单 —— 点开:显示姓名/邮箱 + 退出登录 */}
				<DropdownMenu>
					<DropdownMenuTrigger
						aria-label="用户菜单"
						className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40"
					>
						<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-foreground ring-1 ring-border">
							{(user.name || user.email).slice(0, 1).toUpperCase()}
						</span>
						<span className="hidden max-w-32 truncate text-sm sm:block">{user.name || user.email}</span>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-56">
						<DropdownMenuLabel className="font-normal">
							<div className="truncate text-sm font-medium text-foreground">{user.name || "(未填姓名)"}</div>
							<div className="truncate text-xs text-muted-foreground">{user.email}</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{/* 个人资料 —— 入口放在这里,而不是侧边栏:改自己的密码不该要求"系统设置"菜单授权 */}
						<DropdownMenuItem className="gap-2 text-sm" render={<Link to="/settings/profile" />}>
							<UserRound className="size-3.5" />
							个人资料
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => void handleSignOut()} className="gap-2 text-sm">
							<LogOut className="size-3.5" />
							退出登录
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
		</header>
	);
}
