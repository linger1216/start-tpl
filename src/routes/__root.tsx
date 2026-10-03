import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import type { ErrorComponentProps, NotFoundRouteProps } from "@tanstack/react-router";
import { createRootRouteWithContext, HeadContent, Link, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { AlertOctagon, Compass, ShieldAlert } from "lucide-react";
import { EmptyState } from "#/components/layout/empty-state";
import { buttonVariants } from "#/components/ui/button";
import { Toaster } from "#/components/ui/sonner";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { toApiError } from "#/lib/api/error";
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
	errorComponent: RootError,
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

/**
 * 全局 error 兜底 —— 任何路由 throw 都汇到这里,落到 EmptyState 而不是 TanStack 默认的裸 `<p>`。
 *
 * 设计取舍:
 *  - **不暴露原始 error.message 给最终用户**:`info.componentStack` 是 React 调试栈、
 *    `error.stack` 是 Node 调试栈,生产环境泄漏细节(库版本 / 文件路径 / 内部表名)是反向送情报。
 *    给用户看的是 `toApiError()` 归一后的 message —— 业务抛的 `TRPCError` 是「请先登录」、
 *    「没有权限」、「系统异常,请稍后再试」之类的**可操作**文案;真崩时给的就是一段中文兜底 + 「复制给开发者」。
 *  - **开发环境**额外开一个折叠区,把 componentStack 露出来 —— dev 模式下能看到,prod 下没有。
 *  - **不接 Sentry 在前端**:见 `instrument.server.mjs`,DSN 缺失时整段 Sentry 不启动;统一在 server side 上送。
 *
 * 为什么不用 `errorComponent` 区分 4xx / 5xx:TanStack 框架对**任何错误边界**都写死 `status: 500`
 * (`applyFailure` 的 ERROR 终态),`error.status` / `setResponseStatus` 都不参与判定 —— 想给 4xx 走
 * not-found 通道(`status: 404`),见上面的 `NotFound`。所以这里只关心**用户看到什么**,不关心 HTTP 头。
 */
function RootError({ error, info }: ErrorComponentProps) {
	const apiErr = toApiError(error);
	const stack = error instanceof Error ? error.stack : undefined;
	const componentStack = info?.componentStack;
	const isDev = import.meta.env.DEV;
	return (
		<div className="flex min-h-screen items-center justify-center p-6">
			<EmptyState
				title="出错了"
				description={apiErr.message || "页面加载失败,请稍后再试。"}
				icon={<AlertOctagon className="size-6 text-destructive" />}
				actions={
					<div className="flex flex-wrap items-center justify-center gap-2">
						<button
							type="button"
							className={buttonVariants({ variant: "outline" })}
							// 重新加载当前页 —— 大多数 throw 是「这一次倒霉」,重试就能恢复
							onClick={() => window.location.reload()}
						>
							重试
						</button>
						<Link to="/" className={buttonVariants()}>
							返回工作台
						</Link>
					</div>
				}
				className="w-full max-w-xl"
			>
				{/* dev 模式才漏栈;prod 严格不漏(避免暴露代码路径 / 库版本) */}
				{isDev && (stack || componentStack) ? (
					<details className="mt-4 max-h-48 w-full overflow-auto rounded-md border border-border bg-background p-2 text-left text-xs">
						<summary className="cursor-pointer font-medium text-muted-foreground">调试栈(开发模式)</summary>
						<pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">
							{componentStack ?? ""}
							{stack ? `\n\n${stack}` : ""}
						</pre>
					</details>
				) : null}
			</EmptyState>
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
