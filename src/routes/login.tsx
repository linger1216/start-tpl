import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Captcha } from "captchakit";
import { LayoutDashboard } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import "captchakit/styles.css";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Spinner } from "#/components/ui/spinner";
import { APP_TITLE } from "#/lib/app-meta";
import { authClient } from "#/lib/auth-client";
import { CAPTCHA_ENABLED_KEY } from "#/lib/para-spec";

/**
 * 登录页 —— `/login`,**故意放在 `src/routes/` 根下**(不在 `(main)` 里),这样它没有后台外壳:
 * 未登录的人不应该先看到侧边栏/顶栏再被弹走。
 *
 * 认证走 better-auth 的客户端 SDK,但它自己不做会话判定 —— 判定在 `(main)/route.tsx` 的
 * `beforeLoad`(服务端)。这里只负责:收凭证 → 过验证码 → 调 `signIn.email` → 回跳。
 *
 * 验证码用 **CaptchaKit 自托管**(不对接 Turnstile / reCAPTCHA 等任何第三方):
 * 题面与答案全在本进程,只有 proof token 回服务端消费一次。
 *
 * ⚠️ 这一栏**默认显示**,开关是「参数管理」的 `login.captcha_enabled`(默认 true;见 `lib/para-spec.ts`
 * 的 `CAPTCHA_ENABLED_KEY`)。服务端 `/sign-in/email` 读**同一个值**决定要不要校验 proof token ——
 * 两边必须一致,所以本文件用下面那个 `createServerFn` 问服务端要开关,而不是自己猜(判据在库里,
 * 浏览器看不见)。首屏就问,SSR 阶段拿到值 ⇒ 关掉后不会先闪一下验证码栏再消失。
 */
const readCaptchaEnabled = createServerFn({ method: "GET" }).handler(async (): Promise<boolean> => {
	// **动态 import**:`#/lib/sys-para` 拉 `#/db`,静态 import 会把 mysql2 打进浏览器包
	// (与 `(main)/route.tsx` 的会话守卫同一个坑)
	const { getParaBool } = await import("#/lib/sys-para");
	return getParaBool(CAPTCHA_ENABLED_KEY, true);
});

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
	/** 人机验证开关(服务端读的参数):`false` 时本页不画验证码栏、提交也不带 token */
	beforeLoad: async () => ({ captchaEnabled: await readCaptchaEnabled() }),
	component: LoginPage,
});

function LoginPage() {
	const router = useRouter();
	const { redirect: to } = Route.useSearch();
	/** 服务端给的开关(见上面 `beforeLoad`):`false` = 不画验证码栏、提交不带 token */
	const { captchaEnabled } = Route.useRouteContext();
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
	// 包外层的 div ref 拿不到 —— Captcha 没 forwardRef —— 自己包一层拿 DOM 用。
	const captchaRootRef = useRef<HTMLDivElement>(null);
	// 「正在等待一次 verify 结果」的句柄。点击登录时如果 token 还没拿到,
	// 会主动派发一次 Enter 触发包内 verify,等结果回来再继续走登录 —— 避免
	// 「debounce 600ms 自动 verify 还没飞回来就被登录按钮抢跑」的尴尬。
	const pendingVerifyRef = useRef<{ resolve: (token: string | null) => void; timer: number } | null>(null);

	const target = to ?? "/";

	function resetCaptcha() {
		setCaptchaToken(null);
		setCaptchaNonce((n) => n + 1);
	}

	function onCaptchaVerify(token: string) {
		setCaptchaToken(token);
		const pending = pendingVerifyRef.current;
		if (pending) {
			window.clearTimeout(pending.timer);
			pendingVerifyRef.current = null;
			pending.resolve(token);
		}
	}

	function onCaptchaError() {
		setCaptchaToken(null);
		const pending = pendingVerifyRef.current;
		if (pending) {
			window.clearTimeout(pending.timer);
			pendingVerifyRef.current = null;
			pending.resolve(null);
		}
	}

	// 已经登录了就别停在登录页(比如登录后又点回退)
	useEffect(() => {
		if (session) void router.navigate({ to: target, replace: true });
	}, [session, target, router]);

	/**
	 * 「点登录自动验证」的自动 verify —— 让验证码栏**没有 verify 按钮**也能拿到 proof token。
	 *
	 * 做法(为什么这样而不是另起一个 tRPC / 自写 verify 流程):
	 *  - CaptchaKit 自带的 verify 流程是 `CaptchaInput.onSubmit` → `captcha.submit()` →
	 *    `verifyCaptcha()` → `onVerify(proofToken)`。**前端只验一次**是包的设计:不让前端
	 *    偷答案,但 proofToken 验证答案对不对必须在 server 侧发起 —— 服务端的 store 是模块
	 *    级 `getDefaultStore()` 单例,前端只持有 token,没法也不该自己 POST `/api/captcha`。
	 *  - 包内的 `<CaptchaInput>` 自己绑了 Enter 触发 `onSubmit` —— 我们在这里监听 input 的
	 *    `input` 事件,**debounce 600ms 后派发一个 Enter keydown** 给同一个 input,包内
	 *    handler 自然走 verify 流程,失败就走 `onError`、成功就走 `onVerify`,与点 verify
	 *    按钮的路径完全一致。
	 *  - 失败时 input.value 不被包清空 —— 用户输错位会自动看到红字错误(包渲染在下方),删掉
	 *    再输就行,不需要我们插手;真要清空也可以,但「保留用户输入 + 报错」更尊重用户。
	 *
	 * 数学解析 `solve(q)`:题面是 captchakit 内部生成的等式,字符串只可能形如 `"<a> <op> <b> = ?"`,
	 * 而且 `easy` 难度只出一位数 —— 我们写**严格的**正则去 match,绝不调 `eval`,绝不信任别的形态
	 * (解不出来就静默不触发,用户多等也不会出错)。
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: captchaNonce 用来在 <Captcha key={captchaNonce}> 重挂时重新绑监听器,biome 看不见跨组件的依赖
	useEffect(() => {
		const root = captchaRootRef.current;
		if (!root) return;
		const display = root.querySelector(".captchakit-display");
		const input = root.querySelector<HTMLInputElement>(".captchakit-input");
		if (!display || !input) return;

		const solve = (q: string): string | null => {
			// 严格白名单:仅匹配 captchakit 内部生成的 `<a> <op> <b> = ?` 形态,其它一律不触发。
			const m = q.match(/^(\d+)\s*([×*x+\-−])\s*(\d+)\s*=\s*\?$/);
			if (!m) return null;
			const a = Number(m[1]);
			const b = Number(m[3]);
			const op = m[2];
			if (op === "+") return String(a + b);
			if (op === "-" || op === "−") return String(a - b);
			// × / * / x —— 同一类,代表乘法
			return String(a * b);
		};

		let debounceId = 0;
		let lastChallenge = display.textContent ?? "";
		// 用户点刷新按钮 / 服务端重发新题 → 题面文字会更新
		const onChallengeChange = () => {
			const next = display.textContent ?? "";
			if (next && next !== lastChallenge) lastChallenge = next;
		};
		// 题面文字更新是包内部 setState 引起的 DOM 同步替换 —— childList 监听最稳。
		const displayObs = new MutationObserver(onChallengeChange);
		displayObs.observe(display, { childList: true, characterData: true, subtree: true });

		const trigger = () => {
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		};
		const onInput = () => {
			window.clearTimeout(debounceId);
			// 用户停手 600ms 才触发 —— 边输边触发会把单字符中途态当答案去验证,
			// 让网络上有浪费的 verify 请求、用户也得一直盯着错误提示。
			debounceId = window.setTimeout(() => {
				if (!solve(lastChallenge)) return; // 没解析出来(非预期形态)就静默等下一次
				trigger();
			}, 600);
		};
		input.addEventListener("input", onInput);
		return () => {
			displayObs.disconnect();
			input.removeEventListener("input", onInput);
			window.clearTimeout(debounceId);
		};
	}, [captchaNonce]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);

		/**
		 * 「登录过程中要增加验证码的验证」—— 用户场景:
		 *  - 用户输完答案就点登录,debounce 自动 verify 还在路上;
		 *  - 或者用户根本没输,直接点登录。
		 * 两种都拦成「请先完成验证码」太蠢 —— 点登录本身就是验证的入口,主动触发一次并等结果。
		 */
		// 关掉人机验证时:不要 token,也不带那个头(服务端读同一个参数,同样不校验)
		const token = captchaEnabled ? (captchaToken ?? (await ensureCaptchaVerified())) : null;
		if (captchaEnabled && !token) {
			setError("请先完成验证码");
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
				token ? { headers: { "x-captcha-token": token } } : undefined,
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

	/**
	 * 主动触发包内 verify 一次,等结果返回。
	 *
	 * **已经有人挂起的就共享同一个 promise** —— 比如 debounce 那次刚派发出去还没回,
	 * 用户又点登录,我们不再发第二次 verify(题目不变、答案不变,白白让服务端消费两次),
	 * 改成挂到同一个 `pendingVerifyRef` 上一起等。
	 *
	 * 超时 5s 是网络往返的宽裕上限,正常情况下几百毫秒。timeout 触发时
	 * resolve(null) → 调用方当作「未拿到 token」处理,提示「请先完成验证码」。
	 */
	function ensureCaptchaVerified(): Promise<string | null> {
		if (!captchaEnabled) return Promise.resolve(null);
		if (captchaToken) return Promise.resolve(captchaToken);
		const root = captchaRootRef.current;
		const input = root?.querySelector<HTMLInputElement>(".captchakit-input");
		if (!input) return Promise.resolve(null);
		return new Promise<string | null>((resolve) => {
			const pending = { resolve, timer: 0 };
			pending.timer = window.setTimeout(() => {
				// 超时还没被 consume 的话主动 resolve(null),免得登录按钮永远转圈
				if (pendingVerifyRef.current === pending) pendingVerifyRef.current = null;
				resolve(null);
			}, 5000);
			pendingVerifyRef.current = pending;
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		});
	}

	return (
		<div className="grid min-h-screen place-items-center bg-background px-4">
			<div className="w-full max-w-sm space-y-6">
				<div className="flex flex-col items-center gap-3 text-center">
					<span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-primary ring-1 ring-border ring-inset">
						<LayoutDashboard className="size-5" />
					</span>
					<div>
						<h1 className="text-lg font-semibold tracking-tight text-foreground">登录{APP_TITLE}</h1>
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
									<Label>验证码</Label>
									{/* `locale` 只有 en / fa 两种(题面文案是包内置的),中文登录页用 en。
								    `math` + `easy`:登录是唯一入口,别把门槛设太高。
								    组件自带一套灰阶外观,已由 `src/styles.css` 的「CaptchaKit 外观适配」段
								    接到本项目的令牌上 —— 这里不用传 `classNames`,外观不归本文件管。
								    自带的「Verify」按钮由样式表整块藏掉,改由 `captchaRootRef` 那个 useEffect
								    监听输入、debounce 后派发 Enter 走包内 verify 流程 —— 拿到的 proof token
								    落在 `captchaToken`,登录按钮直接发请求。 */}
									<div ref={captchaRootRef}>
										<Captcha
											key={captchaNonce}
											type="math"
											difficulty="easy"
											locale="en"
											onVerify={onCaptchaVerify}
											onError={onCaptchaError}
											disabled={submitting}
										/>
									</div>
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
