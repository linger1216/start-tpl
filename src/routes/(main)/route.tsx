import type { ErrorComponentProps } from "@tanstack/react-router";
import { createFileRoute, Link, notFound, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { TriangleAlert } from "lucide-react";

import { EmptyState } from "#/components/layout/empty-state";
import { SidebarProvider } from "#/components/layout/sidebar-provider";
import { buttonVariants } from "#/components/ui/button";
import { SIDEBAR_MODE_CONFIG_KEY } from "#/lib/sidebar-mode";
import type { ForbiddenData } from "../__root";

/** 当前登录用户 —— 只带界面要用的三个字段,别把整个 session 往客户端塞 */
export type SessionUser = { id: string; name: string; email: string };

/** 路由守卫的结论:会话用户 + 这个页面能不能看(判定实现在 `lib/rbac.ts` 的 `canViewPath`) */
type SessionGate = { user: SessionUser | null; allowed: boolean; pageName: string | null };

/**
 * 读当前登录用户 + 判这个路径能不能进(**只在 server 跑**)。
 *
 * ⚠️ 两条硬约束,踩过才写得出来:
 *  1. **handler 里必须动态 import server-only 模块**。路由文件被 `routeTree.gen.ts` 静态引用,
 *     顶层 import 会被 Vite 拉进客户端包 —— `#/lib/auth` → `#/db` → mysql2/dmdb,浏览器里
 *     没有 `Buffer.prototype`,直接 "Cannot read properties of undefined (reading 'prototype')" 崩掉整个应用。
 *     (同一坑的详细记录见 `routes/(main)/demo/drizzle.tsx` 顶部。)
 *  2. 会话判定必须在**服务端**做:客户端 `authClient.useSession()` 是异步的,首帧渲染不出结论,
 *     那样未登录用户会先看到后台外壳再被弹走 —— 既闪屏又等于把外壳白送出去。
 *
 * 判权限也放在同一次请求里(而不是客户端再问一次):**首屏直出的 HTML 就是结论**,
 * 没权限的页面不会先渲染出外壳骨架再闪走。
 * (为什么必须拦在服务端:侧边栏隐藏只是"看不见入口",记住 url 照样能进,读接口也会照答。)
 */
const getSessionGate = createServerFn({ method: "GET" })
	.validator((data: { path: string }) => data)
	.handler(async ({ data }): Promise<SessionGate> => {
		const [{ auth }, { getRequestHeaders }, { canViewPath }] = await Promise.all([
			import("#/lib/auth"),
			import("@tanstack/react-start/server"),
			import("#/lib/rbac"),
		]);
		const session = await auth.api.getSession({ headers: getRequestHeaders() });
		if (!session) return { user: null, allowed: false, pageName: null };
		const user = { id: session.user.id, name: session.user.name, email: session.user.email };
		const { allowed, pageName } = await canViewPath(user.id, data.path);
		return { user, allowed, pageName };
	});

/**
 * 「这个页面没授权」—— 走 **not-found 通道**,不是错误边界,也不是 `redirect`:
 *  - `redirect` 会把用户甩到另一个地址(URL 变了,像走错门);
 *  - 错误边界拿不到 4xx:框架对任何错误终态都写死 `status: 500`
 *    (`applyFailure` 的 ERROR 分支,`error.status` / `setResponseStatus` 都不参与判定),
 *    而 not-found 终态自带 `status: 404` —— 4xx 才是"你没权限"该有的语义,顺带不暴露地址是否存在。
 * 页面本身在 `routes/__root.tsx` 的 `notFoundComponent`(它按 `data.forbidden` 分清
 * 「没权限」和「地址不存在」两种 404)。`data` 是普通对象,能安全地序列化给客户端做水合。
 */
export const Route = createFileRoute("/(main)")({
	/**
	 * **整个后台都要登录 + 都要有菜单授权**:没有会话就带上原地址跳登录页,登录后回到原地;
	 * 有会话但没这个页面的授权 ⇒ 抛 `notFound`(页面见 `__root.tsx` 的 `NotFound`)。
	 * 放在 `beforeLoad` 而不是 `loader` —— 它是拦截;beforeLoad 抛错时 loader 根本不跑
	 * (也就不会去读一次自己没权限的数据)。
	 */
	beforeLoad: async ({ location }) => {
		const { user, allowed, pageName } = await getSessionGate({ data: { path: location.pathname } });
		if (!user) {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
		if (!allowed) {
			throw notFound({ data: { forbidden: true, pageName } satisfies ForbiddenData });
		}
		return { user };
	},

	/**
	 * 预取外壳依赖的两份服务端数据,让首屏(SSR)直出就是最终形态:
	 *  1. `sys_menu` 的菜单 —— 否则先渲染静态 NAV_NODES 再被表里的菜单替换;
	 *  2. 侧边栏收起形态(`sys_para` 的一条偏好)—— 否则收起时宽度会闪一下。
	 * 第 2 条失败不阻断外壳:解析侧会回落默认值(见 lib/sidebar-mode.ts),所以单独吞掉错误。
	 */
	loader: async ({ context }) => {
		await Promise.all([
			// ⚠️ 必须是 `mine` 而不是 `list`:侧边栏渲染的是"当前用户能看的菜单"。
			// 这条请求由**服务端**发起,所以要靠 root-provider 的自定义 fetch 把 cookie 带过去。
			context.queryClient.ensureQueryData(context.trpc.menu.mine.queryOptions()),
			context.queryClient
				.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: SIDEBAR_MODE_CONFIG_KEY }))
				.catch(() => undefined),
		]);
	},

	/**
	 * **路由级错误边界**(全站唯一一处):只兜真正的异常(接口挂了、渲染出错),
	 * 给一个带「重试」的页面,不让用户掉到 TanStack 默认那行 "Something went wrong!"。
	 * 「没权限」不走这里 —— 见上面的 `notFound`。
	 */
	errorComponent: MainErrorComponent,
	component: MainLayout,
});

function MainErrorComponent({ error, reset }: ErrorComponentProps) {
	return (
		<div className="flex min-h-screen items-center justify-center p-6">
			<EmptyState
				title="页面出错了"
				description={error instanceof Error && error.message ? error.message : "页面加载时发生了未预期的错误。"}
				icon={<TriangleAlert className="size-6" />}
				actions={
					<>
						<button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => reset()}>
							重试
						</button>
						<Link to="/" className={buttonVariants()}>
							返回工作台
						</Link>
					</>
				}
			/>
		</div>
	);
}

function MainLayout() {
	// 用户信息由 beforeLoad 返回,SSR 首帧就有 —— 顶栏不会先显示"管理员"再跳成真名
	const { user } = Route.useRouteContext();
	return (
		<SidebarProvider user={user}>
			<Outlet />
		</SidebarProvider>
	);
}
