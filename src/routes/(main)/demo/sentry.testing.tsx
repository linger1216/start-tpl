import * as Sentry from "@sentry/tanstackstart-react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { PageHeader } from "#/components/layout/page-header";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { JsonBlock } from "#/components/ui/json-block";

export const Route = createFileRoute("/(main)/demo/sentry/testing")({
	component: SentryDemo,
	errorComponent: SentryErrorFallback,
});

/** 服务端抛错:在 server function 内被 Sentry 捕获后抛回客户端 */
const brokenServerFn = createServerFn({ method: "GET" }).handler(async () =>
	Sentry.startSpan({ name: "服务端错误", op: "demo.server-error" }, async () => {
		throw new Error("Server-side error demonstration");
	}),
);

/** 服务端正常返回,但会被 startSpan 记成一条 trace */
const tracedServerFn = createServerFn({ method: "GET" }).handler(async () =>
	Sentry.startSpan({ name: "服务端追踪", op: "demo.server-trace" }, async () => {
		await new Promise((resolve) => setTimeout(resolve, 300));
		return { ok: true, at: new Date().toISOString() };
	}),
);

/** 客户端抛错 —— 由 DemoAction 的 catch 统一 captureException 上报 */
const clientError = () => {
	throw new Error("Client-side error demonstration");
};

/** 客户端 span 包住一次带追踪的服务端调用 */
const clientTrace = () => Sentry.startSpan({ name: "客户端操作", op: "demo.client-trace" }, () => tracedServerFn());

type ActionSpec = {
	label: string;
	hint: string;
	variant?: "default" | "destructive";
	run: () => unknown;
};

const ACTIONS: ActionSpec[] = [
	{ label: "客户端错误", hint: "throw → captureException", variant: "destructive", run: clientError },
	{ label: "服务端错误", hint: "server function 抛错 → 服务端捕获", variant: "destructive", run: brokenServerFn },
	{ label: "手动上报", hint: "captureMessage,非异常信息也进 Sentry", run: () => Sentry.captureMessage("demo", "info") },
	{ label: "性能追踪", hint: "startSpan 包住一次服务端调用", run: clientTrace },
];

function DemoAction({ label, hint, variant, run }: ActionSpec) {
	const [busy, setBusy] = useState(false);
	const [outcome, setOutcome] = useState<{ ok: boolean; detail: unknown } | null>(null);

	const handleClick = async () => {
		setBusy(true);
		setOutcome(null);
		try {
			setOutcome({ ok: true, detail: await run() });
		} catch (error) {
			// 兜底上报:即使全局 handler 没接住,这次错误也不会丢
			Sentry.captureException(error);
			setOutcome({ ok: false, detail: error instanceof Error ? error.message : String(error) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Card size="sm">
			<CardContent className="space-y-3 pt-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span className="text-[13px] text-muted-foreground">{hint}</span>
					<Button variant={variant} size="sm" disabled={busy} onClick={handleClick}>
						{busy ? "执行中…" : label}
					</Button>
				</div>
				{outcome && (
					<div className="space-y-2">
						<Badge variant={outcome.ok ? "secondary" : "destructive"}>{outcome.ok ? "成功" : "已捕获"}</Badge>
						<JsonBlock value={outcome.detail} />
					</div>
				)}
			</CardContent>
		</Card>
	);
}

/** 渲染期错误:errorComponent 内手动上报,不只依赖全局 handler */
function SentryErrorFallback({ error }: { error: unknown }) {
	useEffect(() => {
		Sentry.captureException(error);
	}, [error]);

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 p-6">
			<PageHeader title="页面渲染出错" description="已在 errorComponent 中 captureException 上报。" />
			<Card size="sm">
				<CardContent className="pt-4">
					<JsonBlock value={error instanceof Error ? error.message : String(error)} />
				</CardContent>
			</Card>
		</div>
	);
}

function SentryDemo() {
	const configured = Boolean(import.meta.env.VITE_SENTRY_DSN);

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 p-6">
			<PageHeader
				title="Sentry 演示"
				description="客户端 / 服务端错误捕获、手动上报与性能追踪。触发后到 Sentry 后台查看。"
				actions={
					<Badge variant={configured ? "secondary" : "destructive"}>{configured ? "DSN 已配置" : "未配置 DSN"}</Badge>
				}
			/>
			<div className="grid gap-3">
				{ACTIONS.map((action) => (
					<DemoAction key={action.label} {...action} />
				))}
			</div>
		</div>
	);
}
