import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import type { NotFoundRouteProps } from "@tanstack/react-router";
import { createRootRouteWithContext, HeadContent, Link, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { Compass, ShieldAlert } from "lucide-react";
import { EmptyState } from "#/components/layout/empty-state";
import { buttonVariants } from "#/components/ui/button";
import { Toaster } from "#/components/ui/sonner";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { THEME_STORAGE_KEY } from "#/lib/constants";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;

	trpc: TRPCOptionsProxy<TRPCRouter>;
}

/**
 * 首屏主题引导脚本:在 React 水合之前就把 .dark 打上,避免闪白 / 闪黑。
 *
 * 它的存储键与"无存储值时回落到系统偏好"的规则,必须和
 * `src/components/layout/topbar.tsx` 的切换逻辑完全一致 —— 两处共用
 * `THEME_STORAGE_KEY`,不一致就会先按系统偏好渲染再被纠正,肉眼可见地闪一下。
 */
const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem(${JSON.stringify(
	THEME_STORAGE_KEY,
)});var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=(stored==='light'||stored==='dark')?stored:(prefersDark?'dark':'light');var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				// 占位标题 —— 派生新项目后改成自己的
				title: "管理后台",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
	notFoundComponent: NotFound,
});

/**
 * 「这个 404 其实是没权限」—— 抛出方是 `routes/(main)/route.tsx` 的 `beforeLoad`。
 *
 * ⚠️ 为什么没权限要伪装成 404:框架对**任何错误边界**都写死 `status: 500`
 * (`applyFailure` 的 ERROR 终态,`error.status` 不参与判定),想给出 4xx 就只能走
 * not-found 通道(`status: 404`)。顺带还不多暴露"这个地址存在"这件事。
 *
 * ⚠️ 这里读的是 `notFound({ data })` 里那个**普通对象**,不是错误实例 ——
 * 别改成 `instanceof`:错误对象要序列化给客户端做水合,`prototype` 会丢(踩过)。
 */
export type ForbiddenData = { forbidden: true; pageName: string | null };

function forbiddenDataOf(data: unknown): ForbiddenData | null {
	if (typeof data !== "object" || data === null) return null;
	const candidate = data as { forbidden?: unknown; pageName?: unknown };
	if (candidate.forbidden !== true) return null;
	return { forbidden: true, pageName: typeof candidate.pageName === "string" ? candidate.pageName : null };
}

/** 404 —— 复用模板已有的 EmptyState,避免落到 TanStack 默认的裸 `<p>Not Found</p>` */
function NotFound({ data }: NotFoundRouteProps) {
	const forbidden = forbiddenDataOf(data);
	return (
		<div className="flex min-h-screen items-center justify-center p-6">
			{forbidden ? (
				<EmptyState
					title="没有权限"
					description={
						forbidden.pageName
							? `「${forbidden.pageName}」这个页面在你的角色里没有授权。需要用的话,让管理员在「角色管理」里给对应角色勾上它。`
							: "这个页面在你的角色里没有授权。需要用的话,让管理员在「角色管理」里给对应角色勾上它。"
					}
					icon={<ShieldAlert className="size-6" />}
					actions={
						<Link to="/" className={buttonVariants()}>
							返回工作台
						</Link>
					}
				/>
			) : (
				<EmptyState
					title="页面不存在"
					description="你访问的地址没有对应的页面,可能是链接已过期或输入有误。"
					icon={<Compass className="size-6" />}
					actions={
						<Link to="/" className={buttonVariants()}>
							返回工作台
						</Link>
					}
				/>
			)}
		</div>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="zh-CN" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: 主题引导脚本必须内联执行,否则水合前会闪白/闪黑 */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-primary/25">
				{children}
				{/* 全局 toast 容器:缺了它,全站 toast.success / toast.error 都不会显示 */}
				<Toaster />
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
						TanStackQueryDevtools,
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
