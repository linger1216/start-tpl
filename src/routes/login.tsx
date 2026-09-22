import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Spinner } from "#/components/ui/spinner";
import { authClient } from "#/lib/auth-client";

/**
 * 登录页 —— `/login`,**故意放在 `src/routes/` 根下**(不在 `(main)` 里),这样它没有后台外壳:
 * 未登录的人不应该先看到侧边栏/顶栏再被弹走。
 *
 * 认证走 better-auth 的客户端 SDK,但它自己不做会话判定 —— 判定在 `(main)/route.tsx` 的
 * `beforeLoad`(服务端)。这里只负责:收凭证 → 调 `signIn.email` → 回跳。
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
	component: LoginPage,
});

function LoginPage() {
	const { redirect: to } = Route.useSearch();
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const [email, setEmail] = useState("admin@example.com");
	const [password, setPassword] = useState("Passw0rd123");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const target = to ?? "/";

	// 已经登录了就别停在登录页(比如登录后又点回退)
	useEffect(() => {
		if (session) window.location.replace(target);
	}, [session, target]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			const { error: signInError } = await authClient.signIn.email({ email: email.trim(), password });
			if (signInError) {
				// better-auth 对「用户不存在」和「密码错」返回同一条信息 —— 这是对的,别在界面泄露哪个邮箱存在
				setError(signInError.message ?? "登录失败,请检查邮箱与密码");
				return;
			}
			// 用整页跳转而不是 router.navigate:会话 cookie 刚由服务端下发,
			// 重新走一次 SSR 才能让 beforeLoad 拿到它(且顺带刷新所有 loader 数据)。
			window.location.replace(target);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
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
						<h1 className="text-[18px] font-semibold tracking-[-0.01em] text-foreground">登录管理后台</h1>
						<p className="mt-1 text-[13px] text-muted-foreground">用邮箱与密码进入</p>
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

							{error ? (
								<p role="alert" className="text-[12.5px] text-danger">
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

				<p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
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
