import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { PageHeader } from "#/components/layout/page-header";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

/**
 * 组件展示台骨架 —— 模板自带的「活文档」版式。
 *
 * 三段结构:
 *   `ShowcasePage`    页头 + 锚点目录 + 若干区块;
 *   `ShowcaseSection` 一个区块(必带 `id`,供目录跳转);
 *   `ShowcaseItem`    一个组件的展示单元:名字 + 用途 + **活例子** + 代码。
 *
 * 为什么要有这个:
 *  1. 组件清单散在 44 个 `ui/` + 23 个 `shared/` 文件里,新项目上手时"有哪些能直接用"
 *     不该靠翻目录 —— 一页能看全、能点、能复制,才是可用的清单;
 *  2. 活例子是**真渲染**,不是截图:改了组件这页立刻反映出来,
 *     于是"文档过期"这件事在结构上不可能发生。
 *
 * 派生新项目时:本目录(`components/modules/showcase/` + `routes/(main)/showcase/`)
 * 与 `components/layout/showcase.tsx` 可以整块删掉,不影响任何业务代码。
 */

/** 一个组件展示单元 */
export function ShowcaseItem({
	/** 组件名(与导出名一致,便于搜索) */
	name,
	/** 中文用途一句话 */
	summary,
	/** 更长的说明:坑、边界、什么时候不要用 */
	note,
	/** 来源路径(展示台自身用来指向文件,方便打开对着改) */
	source,
	/** 活例子 —— 真渲染 */
	demo,
	/** 使用代码(可选) */
	code,
	/** 例子区是否用更紧凑的内边距(小控件用) */
	dense = false,
	className,
}: {
	name: string;
	summary: string;
	note?: ReactNode;
	source?: string;
	demo: ReactNode;
	code?: string;
	dense?: boolean;
	className?: string;
}) {
	return (
		<article className={cn("overflow-hidden rounded-xl border border-border bg-background", className)}>
			<header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border bg-muted/30 px-3.5 py-2.5">
				<code className="font-mono text-[13px] font-medium text-foreground">{name}</code>
				<span className="text-[12.5px] text-muted-foreground">{summary}</span>
				{source ? <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">{source}</span> : null}
			</header>

			<div className={cn("min-w-0", dense ? "p-3" : "p-3.5")}>{demo}</div>

			{note ? (
				<div className="border-t border-dashed border-border px-3.5 py-2 text-[12px] leading-relaxed text-muted-foreground">
					{note}
				</div>
			) : null}

			{code ? (
				<div className="border-t border-border">
					<CodeBlock code={code} />
				</div>
			) : null}
		</article>
	);
}

/** 展示区块 —— `id` 同时是锚点 */
export function ShowcaseSection({
	id,
	title,
	description,
	children,
	className,
}: {
	id: string;
	title: string;
	description?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section id={id} className={cn("scroll-mt-20 space-y-3", className)}>
			<div className="space-y-1 border-b border-border pb-2">
				<h2 className="font-heading text-[17px] font-medium tracking-[-0.01em] text-foreground">{title}</h2>
				{description ? (
					<p className="max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
				) : null}
			</div>
			<div className="space-y-3">{children}</div>
		</section>
	);
}

/** 展示页外壳:页头 + 锚点目录 + 内容 */
export function ShowcasePage({
	title,
	description,
	/** 锚点目录项:`[id, 名称]` */
	toc,
	actions,
	children,
}: {
	title: string;
	description?: ReactNode;
	toc?: ReadonlyArray<readonly [string, string]>;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="page-enter space-y-5">
			<PageHeader title={title} description={description} descriptionInline actions={actions} />

			{toc && toc.length > 0 ? (
				<nav aria-label="本页目录" className="flex flex-wrap items-center gap-1.5">
					<span className="text-[12px] text-muted-foreground">本页共 {toc.length} 节</span>
					{toc.map(([id, label]) => (
						<a
							key={id}
							href={`#${id}`}
							className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-ring/60 hover:bg-secondary hover:text-foreground"
						>
							{label}
						</a>
					))}
				</nav>
			) : null}

			<div className="space-y-8">{children}</div>
		</div>
	);
}

/** 等宽代码块 + 一键复制 */
export function CodeBlock({ code, className }: { code: string; className?: string }) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1400);
		} catch {
			// 非安全上下文(无 clipboard 权限)时静默失败 —— 代码本来就在页面上,能手动选
		}
	}

	return (
		<div className={cn("group relative", className)}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="复制代码"
				className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
				onClick={() => void copy()}
			>
				{copied ? <Check className="size-3.5 text-[color:var(--success-fg)]" /> : <Copy className="size-3.5" />}
			</Button>
			<pre className="overflow-x-auto bg-muted/40 px-3.5 py-3 font-mono text-[11.5px] leading-[1.65] text-foreground">
				<code>{code}</code>
			</pre>
		</div>
	);
}

/** 组件的 props 速查表(只列"不知道就会写错"的那几项) */
export function PropTable({
	rows,
	className,
}: {
	rows: ReadonlyArray<{ name: string; type: string; note: string }>;
	className?: string;
}) {
	return (
		<div className={cn("overflow-x-auto rounded-xl border border-border", className)}>
			<table className="w-full text-[12.5px]">
				<thead className="bg-muted/40 text-muted-foreground">
					<tr>
						<th className="px-3 py-2 text-left font-medium">属性</th>
						<th className="px-3 py-2 text-left font-medium">类型</th>
						<th className="px-3 py-2 text-left font-medium">说明</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.name} className="border-t border-border">
							<td className="px-3 py-2 align-top">
								<code className="font-mono text-[12px] text-foreground">{row.name}</code>
							</td>
							<td className="px-3 py-2 align-top">
								<code className="font-mono text-[11.5px] text-primary">{row.type}</code>
							</td>
							<td className="px-3 py-2 align-top text-muted-foreground">{row.note}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** 小标签,用来标注「规范内 / 规范外」「已废弃」这类口径 */
export function ShowcaseTag({
	children,
	variant = "secondary",
}: {
	children: ReactNode;
	variant?: "default" | "secondary" | "destructive" | "outline";
}) {
	return (
		<Badge variant={variant} className="align-middle text-[10.5px]">
			{children}
		</Badge>
	);
}
