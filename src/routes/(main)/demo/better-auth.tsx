import { createFileRoute } from "@tanstack/react-router";
import { LogIn, LogOut } from "lucide-react";
import { type FormEvent, useState } from "react";

import { PageHeader } from "#/components/layout/page-header";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Spinner } from "#/components/ui/spinner";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/(main)/demo/better-auth")({
	component: BetterAuthDemo,
});

/**
 * 最小可用的 Better Auth 接线:读会话 + 邮箱密码登录 + 退出。
 * 注册同理,换成 `authClient.signUp.email({ email, password, name })` 即可。
 * 模板当前是无状态模式(未接数据库),账号不会持久化,这里只演示客户端 API 的用法。
 */
function BetterAuthDemo() {
	const { data: session, isPending } = authClient.useSession();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError("");
		setSubmitting(true);
		try {
			const result = await authClient.signIn.email({ email, password });
			if (result.error) setError(result.error.message ?? "登录失败");
		} catch {
			setError("请求异常,请稍后重试");
		} finally {
			setSubmitting(false);
		}
	};

	if (isPending) {
		return (
			<div className="mx-auto w-full max-w-md px-4 py-16">
				<Spinner size="lg" label="读取登录状态…" />
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-md px-4 py-8">
			<PageHeader
				title="Better Auth"
				description="读会话 + 邮箱密码登录 + 退出,客户端统一走 src/lib/auth-client.ts。"
			/>

			<Card>
				<CardHeader>
					<CardTitle>{session?.user ? "已登录" : "登录"}</CardTitle>
					<CardDescription>
						{session?.user ? session.user.email : "会话状态由 authClient.useSession() 提供。"}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{session?.user ? (
						<Button variant="outline" className="w-full" onClick={() => void authClient.signOut()}>
							<LogOut />
							退出登录
						</Button>
					) : (
						<form onSubmit={handleSubmit} className="space-y-3">
							<Label htmlFor="auth-email">邮箱</Label>
							<Input
								id="auth-email"
								type="email"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								required
							/>

							<Label htmlFor="auth-password">密码</Label>
							<Input
								id="auth-password"
								type="password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								minLength={8}
								required
							/>

							{error && <p className="text-[13px] text-destructive">{error}</p>}

							<Button type="submit" className="w-full" disabled={submitting}>
								{submitting ? <Spinner size="sm" /> : <LogIn />}
								登录
							</Button>
						</form>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
