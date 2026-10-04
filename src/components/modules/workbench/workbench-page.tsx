/**
 * 模板工作台 —— `/`。
 *
 * 设计意图:不再展示业务 KPI(那是新项目该有自己的事),页面内容固定为五块 ——
 * UI 组件示例(主体)、新项目上手的速查清单、模板的两条主线、一级菜单索引
 * (派生自 NAV_NODES),以及一个明显的「派生时删什么」的提示。
 *
 * 入口索引由 NAV_NODES 派生(见 `navigableTopLevel`);其余卡是手写的策展导语,
 * 别在散文里声称它们跟着 nav-config 变。
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight, Code2, FolderTree, Layers, Rocket, Settings, Workflow } from "lucide-react";

import { NAV_ICON_MAP, type NavNode } from "#/components/layout/nav-config";
import { useNavNodes } from "#/components/layout/nav-data";
import { PageHeader } from "#/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { cn } from "#/lib/utils";
import { UiGallery } from "./ui-gallery";
import { WorkbenchTagging } from "./workbench-tagging";

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
		title: "看一遍 UI 组件示例",
		desc: "本页下方就是 —— 41 个原语的最小可用例子,可直接抄进业务页",
	},
	{
		icon: Code2,
		title: "改一处菜单",
		desc: "改 src/components/layout/nav-config.ts 再跑 pnpm db:seed:menus —— 侧边栏 / 工作台 / 面包屑都从 menu.mine 读",
	},
	{
		icon: Settings,
		title: "到 /settings 看真实业务示例",
		desc: "用户 / 部门 / 角色 / 标签 / 菜单 / 字典 / 参数等页面全部读写真库(完整清单以侧边栏为准)",
	},
];

/** 模板的两条主线 —— 手写的策展导语;真正的入口索引是下面那张派生的「一级菜单索引」 */
const STRUCTURE = [
	{
		icon: Workflow,
		title: "框架能力(/demo/*)",
		desc: "tRPC · Query · 表单 · 表格 · Drizzle · Auth · Store —— 每项一个可运行的样例页",
		path: "/demo/tanstack-query",
	},
	{
		icon: FolderTree,
		title: "系统设置(/settings)",
		desc: "★ 真实业务示例 —— 派生新项目时从这里开始改",
		path: "/settings",
	},
];

export function WorkbenchPage() {
	const topLevel = useNavNodes();
	const entries = navigableTopLevel(topLevel);

	return (
		<div className="page-enter space-y-6">
			<PageHeader
				title="工作台"
				description="模板自带的入口页 —— 真实业务上手后会替换它。当前内容:UI 组件示例、新项目上手清单、模板的两条主线,以及「派生时删什么」。"
				descriptionInline
			/>

			{/* UI 组件示例 —— 原来 7 个 /showcase/* 路由收敛到这里一块 */}
			<Card tone="var(--hue-violet)">
				<CardHeader>
					<CardTitle className="text-base">UI 组件示例</CardTitle>
					<CardDescription>
						<code className="font-mono">components/ui/</code> 下 41 个通用原语的最小可用例子 —— 受控的都给好了
						useState,可直接抄进业务页。新增/删除原语时同步在这里加减一格,别让它们变回孤儿。
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<UiGallery />
				</CardContent>
			</Card>

			{/* 打标签示例 —— sys_tag_relation 四个接口的界面消费方 */}
			<WorkbenchTagging />

			{/* 上手四件 */}
			<Card tone="var(--hue-blue)">
				<CardHeader>
					<CardTitle className="text-base">新项目上手四件</CardTitle>
					<CardDescription>照着走一遍,你就有了一个干净的 TanStack Start 模板。</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<ol className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						{CHECKS.map((check, index) => (
							<li
								key={check.title}
								className="rounded-xl border border-border bg-card/60 p-3 transition-[background-color,border-color] duration-150 hover:border-border-strong hover:bg-card"
							>
								<div className="mb-2 flex items-center gap-2">
									<span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft font-mono text-xs text-primary">
										{index + 1}
									</span>
									<check.icon className="size-3.5 text-muted-foreground" />
								</div>
								<div className="font-medium text-foreground">{check.title}</div>
								<p className="mt-1 text-xs leading-relaxed text-muted-foreground">{check.desc}</p>
							</li>
						))}
					</ol>
				</CardContent>
			</Card>

			{/* 模板的两条主线 —— 手写的策展导语;真正的入口索引是下面那张派生的「一级菜单索引」 */}
			<Card tone="var(--hue-violet)">
				<CardHeader>
					<CardTitle className="text-base">模板的两条主线</CardTitle>
					<CardDescription>
						新项目只需要看这两块 —— 其余都是给它们服务的。完整入口清单以侧边栏为准(见下面的「一级菜单索引」)。
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<div className="stagger grid gap-3 md:grid-cols-2">
						{STRUCTURE.map((item) => (
							<Link
								key={item.title}
								to={item.path}
								className="group flex items-start gap-3 rounded-xl border border-border p-3 transition-[background-color,border-color,box-shadow] duration-150 hover:border-border-strong hover:bg-secondary hover:shadow-raise-1"
							>
								<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary ring-1 ring-border ring-inset">
									<item.icon className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-baseline justify-between gap-2">
										<span className="font-medium text-foreground">{item.title}</span>
										<ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
									</div>
									<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
								</div>
							</Link>
						))}
					</div>
				</CardContent>
			</Card>

			{/* 一级菜单索引(派生自 NAV_NODES) */}
			<Card tone="var(--hue-teal)">
				<CardHeader>
					<CardTitle className="text-base">一级菜单索引</CardTitle>
					<CardDescription>点进去就是对应模块。这里列的是直接挂 path 的一级叶子。</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					{entries.length === 0 ? (
						<div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
							当前没有任何直接挂 path 的一级叶子 —— 工作台就不会渲染这块。
						</div>
					) : (
						<div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
							{entries.map((node) => (
								<EntryCard key={node.path} node={node} />
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* 派生时删什么 */}
			<Card tone="var(--hue-amber)" className="border-dashed">
				<CardHeader>
					<CardTitle className="text-base">派生新项目时删什么</CardTitle>
					<CardDescription>以下三处是模板自带的入口,新业务上线前可整块删掉。</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2 pt-0 text-sm leading-relaxed text-muted-foreground">
					<p>
						<code className="font-mono text-foreground">routes/(main)/demo/</code> —— 框架能力样例页(只保留 Better Auth
						的配置即可),与 <code className="font-mono text-foreground">hooks/demo.form*</code>。
					</p>
					<p>
						<code className="font-mono text-foreground">components/modules/workbench/ui-gallery.tsx</code> —— UI
						组件示例(本页中部那一块),连同它引用的 <code className="font-mono text-foreground">components/ui/</code>{" "}
						里业务用不到的原语。
					</p>
					<p>
						<code className="font-mono text-foreground">components/modules/settings/</code> 与{" "}
						<code className="font-mono text-foreground">routes/(main)/settings/</code> 以及对应的
						<code className="font-mono text-foreground">trpc/routers/{`{menu,dict,para,tag}`}</code> +{" "}
						<code className="font-mono text-foreground">scripts/{`{seed-tags,tag-seed-data}`}</code> +{" "}
						<code className="font-mono text-foreground">db/data-base-schema.ts</code>。保留前先把真实业务模块的字段接上,
						别直接整盘删。
					</p>
					<p className="pt-1 text-xs">
						删完后跑 <code className="font-mono text-foreground">pnpm generate-routes</code> +{" "}
						<code className="font-mono text-foreground">pnpm typecheck</code>,确认零悬空引用。
					</p>
				</CardContent>
			</Card>
		</div>
	);
}

function EntryCard({ node }: { node: NavNode & { path: string } }) {
	const Icon = NAV_ICON_MAP[node.icon];
	// 入口卡是**导航**,所以只用品牌色 —— 与侧边栏同一口径(多色留给数据展示,见 DESIGN.md §2.1)
	return (
		<Link
			to={node.path}
			className={cn(
				"group flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-raise-1",
				"transition-[background-color,border-color,box-shadow] duration-200 ease-brand",
				"hover:border-border-strong hover:shadow-raise-2",
			)}
		>
			<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary ring-1 ring-border ring-inset">
				<Icon className="size-4" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-center justify-between gap-2">
					<span className="truncate font-medium text-foreground">{node.name}</span>
					<ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
				</div>
				{node.description ? (
					<p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{node.description}</p>
				) : null}
			</div>
		</Link>
	);
}
