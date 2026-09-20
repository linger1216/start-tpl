/**
 * 模板工作台 —— `/`。
 *
 * 设计意图:不再展示业务 KPI(那是新项目该有自己的事),
 * 只做三件事 —— 把四大块入口按 NAV_NODES 派生出来、给新项目上手的速查清单、
 * 以及一个明显的「派生时删什么」的提示。
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Code2, FolderTree, Layers, Rocket, Settings, Workflow } from "lucide-react";

import { NAV_ICON_MAP, type NavIcon, type NavNode } from "#/components/layout/nav-config";
import { useVisibleNavNodes } from "#/components/layout/nav-permissions";
import { PageHeader } from "#/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";

/** 「可以展开」的入口(只有有 path 的一级模块才算) */
function navigableTopLevel(nodes: readonly NavNode[]): Array<NavNode & { path: string }> {
	return nodes.filter((node): node is NavNode & { path: string } => Boolean(node.path) && !node.children?.length);
}

const CHECKS = [
	{
		icon: Rocket,
		title: "先把跑起来",
		desc: "cp .env.example .env.local → 填 DATABASE_URL → pnpm dev",
	},
	{
		icon: Layers,
		title: "看一遍 7 个展示页",
		desc: "组件清单改一处全部跟着变 —— 文档不会过期",
	},
	{
		icon: Code2,
		title: "改一处菜单",
		desc: "改 src/components/layout/nav-config.ts → 侧边栏 / 工作台 / 面包屑全部跟着变",
	},
	{
		icon: Settings,
		title: "到 /settings 看真实业务示例",
		desc: "7 个模块完整 CRUD 骨架,以及 mock 数据与数据库两种数据来源",
	},
];

const STRUCTURE = [
	{
		icon: Workflow,
		title: "框架能力(/demo/*)",
		desc: "tRPC · Query · 表单 · 表格 · Drizzle · Auth · Store · Sentry —— 每项一个可运行的样例页",
		path: "/demo/trpc-todo",
	},
	{
		icon: BookOpen,
		title: "组件展示(/showcase/*)",
		desc: "7 页活的组件文档:基础 / 表单 / 表格 / 数据展示 / 布局 / 反馈 / 组合块",
		path: "/showcase/ui",
	},
	{
		icon: FolderTree,
		title: "系统设置(/settings)",
		desc: "★ 真实业务示例 —— 派生新项目时从这里开始改",
		path: "/settings",
	},
];

export function WorkbenchPage() {
	const topLevel = useVisibleNavNodes();
	const entries = navigableTopLevel(topLevel);

	return (
		<div className="page-enter space-y-6">
			<PageHeader
				title="工作台"
				description="模板自带的入口页 —— 真实业务上手后会替换它。当前只做三件事:跳到各模块入口、给新项目的速查清单、把「派生时删什么」列清楚。"
				descriptionInline
			/>

			{/* 上手四件 */}
			<Card>
				<CardHeader>
					<CardTitle className="text-[15px]">新项目上手四件</CardTitle>
					<CardDescription>照着走一遍,你就有了一个干净的 TanStack Start 模板。</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						{CHECKS.map((check, index) => (
							<li
								key={check.title}
								className="rounded-xl border border-border bg-card/60 p-3 transition-colors hover:bg-card"
							>
								<div className="mb-2 flex items-center gap-2">
									<span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[12px] text-primary">
										{index + 1}
									</span>
									<check.icon className="size-3.5 text-muted-foreground" />
								</div>
								<div className="font-medium text-foreground">{check.title}</div>
								<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{check.desc}</p>
							</li>
						))}
					</ol>
				</CardContent>
			</Card>

			{/* 模板四大块 */}
			<Card>
				<CardHeader>
					<CardTitle className="text-[15px]">模板自带的四大入口</CardTitle>
					<CardDescription>由 NAV_NODES 派生 —— 改 nav-config.ts 这里全部跟着变。</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<div className="grid gap-3 md:grid-cols-3">
						{STRUCTURE.map((item) => (
							<Link
								key={item.title}
								to={item.path}
								className="group flex items-start gap-3 rounded-xl border border-border p-3 transition-colors hover:border-ring/60 hover:bg-secondary"
							>
								<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<item.icon className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-baseline justify-between gap-2">
										<span className="font-medium text-foreground">{item.title}</span>
										<ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
									</div>
									<p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{item.desc}</p>
								</div>
							</Link>
						))}
					</div>
				</CardContent>
			</Card>

			{/* 一级菜单索引(派生自 NAV_NODES) */}
			<Card>
				<CardHeader>
					<CardTitle className="text-[15px]">一级菜单索引</CardTitle>
					<CardDescription>点进去就是对应模块。这里列的是直接挂 path 的一级叶子。</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					{entries.length === 0 ? (
						<div className="rounded-lg border border-dashed border-border p-4 text-[13px] text-muted-foreground">
							当前没有任何直接挂 path 的一级叶子 —— 工作台就不会渲染这块。
						</div>
					) : (
						<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
							{entries.map((node) => (
								<EntryCard key={node.path} node={node} />
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* 派生时删什么 */}
			<Card className="border-dashed">
				<CardHeader>
					<CardTitle className="text-[15px]">派生新项目时删什么</CardTitle>
					<CardDescription>以下三处是模板自带的入口,新业务上线前可整块删掉。</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2 pt-0 text-[13px] leading-relaxed text-muted-foreground">
					<p>
						<code className="font-mono text-foreground">components/modules/showcase/</code> 与{" "}
						<code className="font-mono text-foreground">routes/(main)/showcase/</code> —— 7 个展示页的源码与路由, 外加{" "}
						<code className="font-mono text-foreground">components/layout/showcase.tsx</code>。
					</p>
					<p>
						<code className="font-mono text-foreground">routes/(main)/demo/</code> —— 8 个框架能力样例页(只保留 Better
						Auth 的配置即可),与 <code className="font-mono text-foreground">hooks/demo.form*</code>。
					</p>
					<p>
						<code className="font-mono text-foreground">components/modules/settings/</code> 与{" "}
						<code className="font-mono text-foreground">routes/(main)/settings/</code> 以及对应的
						<code className="font-mono text-foreground">trpc/routers/{`{menu,dict,config}`}</code> +{" "}
						<code className="font-mono text-foreground">mocks/{`{settings,tags,dicts}`}</code> +{" "}
						<code className="font-mono text-foreground">db/data-base-schema.ts</code>。保留前先把真实业务模块的字段接上,
						别直接整盘删。
					</p>
					<p className="pt-1 text-[12px]">
						删完后跑 <code className="font-mono text-foreground">pnpm generate-routes</code> +{" "}
						<code className="font-mono text-foreground">pnpm typecheck</code>,确认零悬空引用。
					</p>
				</CardContent>
			</Card>
		</div>
	);
}

function EntryCard({ node }: { node: NavNode & { path: string } }) {
	const Icon = NAV_ICON_MAP[node.icon as NavIcon];
	return (
		<Link
			to={node.path}
			className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-ring/60 hover:bg-secondary"
		>
			<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
				{Icon ? <Icon className="size-4" /> : <Layers className="size-4" />}
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-center justify-between gap-2">
					<span className="truncate font-medium text-foreground">{node.name}</span>
					<ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
				</div>
				{node.description ? (
					<p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{node.description}</p>
				) : null}
			</div>
		</Link>
	);
}
