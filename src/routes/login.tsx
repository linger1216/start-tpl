import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Captcha } from "captchakit";
import { LayoutDashboard } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import "captchakit/styles.css";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Spinner } from "#/components/ui/spinner";
import { authClient } from "#/lib/auth-client";

/**
 * 「有没有启用人机验证」—— **必须在服务端答**。
 *
 * 判据就是 `CAPTCHAKIT_SECRET` 有没有配(`lib/auth.ts` 的 `hooks.before` 用的是同一条)。
 * 为什么不让浏览器自己判断:判定条件是一个环境变量,前端看不到;硬编一个常量又会让
 * 「服务端已开、页面没显示」的版本错配出现 —— 首屏 HTML 里直接给出结论才不会出现这种裂缝。
 * 走 `createServerFn` 而不是直接读 `process.env`:server fn 的 handler 会被打进服务端产物,
 * `process.env` 不会漏进浏览器包(同 `(main)/route.tsx` 的 `getSessionGate`)。
 */
const getCaptchaEnabled = createServerFn({ method: "GET" }).handler((): boolean =>
	Boolean(process.env.CAPTCHAKIT_SECRET?.trim()),
);

/**
 * 登录页 —— `/login`,**故意放在 `src/routes/` 根下**(不在 `(main)` 里),这样它没有后台外壳:
 * 未登录的人不应该先看到侧边栏/顶栏再被弹走。
 *
 * 认证走 better-auth 的客户端 SDK,但它自己不做会话判定 —— 判定在 `(main)/route.tsx` 的
 * `beforeLoad`(服务端)。这里只负责:收凭证 → 调 `signIn.email` → 回跳。
 *
 * 人机验证用 **CaptchaKit 自托管**(不对接 Turnstile / reCAPTCHA 等任何第三方):
 * 题面与答案全在本进程,只有 proof token 回服务端消费一次。
 * **配了 `CAPTCHAKIT_SECRET` 才要求过**,没配就不显示这一栏(见 `getCaptchaEnabled`)。
 */
export const Route = createFileRoute("/login")({
	/**
	 * `?redirect=` 是守卫带过来的原地址。**只接受站内路径**(必须以单个 `/` 开头),
	 * 否则就是开放重定向漏洞 —— 攻击者能拿 `?redirect=https://evil.com` 钓鱼。
	 */
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
		const raw = search.redirect;
		const ok = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//");
		return { redirect: ok ? (raw as string) : undefined };
	},
	loader: async () => ({ captchaEnabled: await getCaptchaEnabled() }),
	component: LoginPage,
});

function LoginPage() {
	const router = useRouter();
	const { redirect: to } = Route.useSearch();
	const { captchaEnabled } = Route.useLoaderData();
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const [email, setEmail] = useState("admin@example.com");
	const [password, setPassword] = useState("Passw0rd123");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	// proof token 由 `<Captcha />` 解题后给;提交登录时随请求头一起走,服务端消费一次。
	const [captchaToken, setCaptchaToken] = useState<string | null>(null);
	// 服务端会把 proof token 消费掉(一次性),所以**每次提交失败都必须换一道新题**。
	// `<Captcha />` 没有对外的 reset 接口,只能靠换 `key` 整块重挂 —— 见 resetCaptcha。
	const [captchaNonce, setCaptchaNonce] = useState(0);

	const target = to ?? "/";

	function resetCaptcha() {
		setCaptchaToken(null);
		setCaptchaNonce((n) => n + 1);
	}

	// 已经登录了就别停在登录页(比如登录后又点回退)
	useEffect(() => {
		if (session) void router.navigate({ to: target, replace: true });
	}, [session, target, router]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		// 没解完人机验证就不打服务端 —— 少一次无谓的失败计数,也少刷一条锁账号告警。
		if (captchaEnabled && !captchaToken) {
			setError("请先完成人机验证");
			return;
		}
		setSubmitting(true);
		try {
			const { error: signInError } = await authClient.signIn.email(
				{ email: email.trim(), password },
				// proof token 走**请求头**而不是 body:better-auth 的客户端 SDK 给 `signIn.email`
				// 的 body 写了严格 schema(多一个字段就报错);第二个位置参数直接就是 fetch 选项,
				// 不用再包一层 `fetchOptions`。服务端读同一个头 ——
				// 与 better-auth 自带 captcha 插件的 `x-captcha-response` 同套路。
				captchaToken ? { headers: { "x-captcha-token": captchaToken } } : undefined,
			);
			if (signInError) {
				// better-auth 对「用户不存在」和「密码错」返回同一条信息 —— 这是对的,别在界面泄露哪个邮箱存在
				setError(signInError.message ?? "登录失败,请检查邮箱与密码");
				// 密码错也要换题:token 已经被服务端消费掉了,不换就是拿一次性票据再提交一次
				resetCaptcha();
				return;
			}
			// SPA 跳转(不是 window.location.replace):会话 cookie 已经由上面那次登录响应写好,
			// 这次客户端导航会**带着新 cookie** 重跑 (main) 的 beforeLoad(服务端判会话)与所有 loader,
			// 所以登录态一样生效;而整页刷新会把 Network 面板里那条登录请求(含响应体)清掉,不好排查。
			await router.invalidate(); // 丢掉上一段会话可能留下的缓存数据
			await router.navigate({ to: target, replace: true });
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			resetCaptcha();
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="grid min-h-screen place-items-center bg-background px-4">
			<div className="w-full max-w-sm space-y-6">
				<div className="flex flex-col items-center gap-3 text-center">
					<span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-primary ring-1 ring-border ring-inset">
						<LayoutDashboard className="size-5" />
					</span>
					<div>
						<h1 className="text-lg font-semibold tracking-tight text-foreground">登录管理后台</h1>
						<p className="mt-1 text-sm text-muted-foreground">用邮箱与密码进入</p>
					</div>
				</div>

				<Card>
					<CardContent className="pt-5">
						<form onSubmit={handleSubmit} className="space-y-4">
							<div className="space-y-1.5">
								<Label htmlFor="email">邮箱</Label>
								<Input
									id="email"
									type="email"
									autoComplete="email"
									required
									autoFocus
									placeholder="you@example.com"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="password">密码</Label>
								<Input
									id="password"
									type="password"
									autoComplete="current-password"
									required
									value={password}
									onChange={(event) => setPassword(event.target.value)}
								/>
							</div>

							{captchaEnabled ? (
								<div className="space-y-1.5">
									<Label>人机验证</Label>
									{/* `locale` 只有 en / fa 两种(题面文案是包内置的),中文登录页用 en。
									    `math` + `easy`:登录是唯一入口,别把门槛设太高。 */}
									<Captcha
										key={captchaNonce}
										type="math"
										difficulty="easy"
										locale="en"
										onVerify={setCaptchaToken}
										onError={() => setCaptchaToken(null)}
										disabled={submitting}
									/>
								</div>
							) : null}

							{error ? (
								<p role="alert" className="text-xs text-danger">
									{error}
								</p>
							) : null}

							<Button type="submit" className="w-full" disabled={submitting || sessionPending}>
								{submitting ? <Spinner className="size-3.5" /> : null}
								登录
							</Button>
						</form>
					</CardContent>
				</Card>

				<p className="text-center text-xs leading-relaxed text-muted-foreground">
					本模板<strong className="font-medium text-foreground">不开放自注册</strong> —— 账号需先在库里建好(见{" "}
					<code className="font-mono">AGENTS.md</code>「认证」一节)。
					<Link to="/" className="ml-1 text-primary hover:underline">
						已登录?回工作台
					</Link>
				</p>
			</div>
		</div>
	);
}
