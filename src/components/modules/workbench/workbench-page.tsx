/**
 * 模板工作台 —— `/`。
 *
 * 设计意图:不再展示业务 KPI(那是新项目该有自己的事),
 * 只做三件事 —— 把四大块入口按 NAV_NODES 派生出来、给新项目上手的速查清单、
 * 以及一个明显的「派生时删什么」的提示。
 */
import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Code2,
	Database,
	FolderTree,
	Layers,
	Rocket,
	Settings,
	Tag as TagIcon,
	Workflow,
} from "lucide-react";

import { NAV_ICON_MAP, type NavIcon, type NavNode } from "#/components/layout/nav-config";
import { useNavNodes } from "#/components/layout/nav-data";
import { PageHeader } from "#/components/layout/page-header";
import { Badge } from "#/components/ui/badge";
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
		desc: "本页下方就是 —— 44 个原语的最小可用例子,可直接抄进业务页",
	},
	{
		icon: Code2,
		title: "改一处菜单",
		desc: "改 src/components/layout/nav-config.ts → 侧边栏 / 工作台 / 面包屑全部跟着变",
	},
	{
		icon: Settings,
		title: "到 /settings 看真实业务示例",
		desc: "用户 / 标签 / 菜单 / 字典 / 参数五个模块,以及 mock 数据与数据库两种数据来源",
	},
];

/** 系统设置模块的七个页面 —— 数据源写清楚,免得后来人以为它们都是 mock */
const SETTINGS_PAGES = [
	{
		name: "标签管理",
		path: "/settings/tags",
		source: "sys_tag",
		desc: "维度 → 标签 两级树;可拖拽调序、跨父迁移。搭配 sys_tag_relation 给业务对象打标签",
	},
	{
		name: "菜单管理",
		path: "/settings/menus",
		source: "sys_menu",
		desc: "侧边栏 / 面包屑 / 工作台的运行时来源;改完即时生效(表为空则退回代码里的 NAV_NODES)",
	},
	{
		name: "字典管理",
		path: "/settings/dictionary",
		source: "sys_dict",
		desc: "全系统共用的固定取值表,业务按 code 引用(useDict 读它)",
	},
	{
		name: "参数管理",
		path: "/settings/parameters",
		source: "sys_para",
		desc: "运维口径 + 界面偏好(如侧边栏收起形态);按类型码校验,支持详情 / 编辑 / 删除",
	},
	{
		name: "用户管理",
		path: "/settings/users",
		source: "sys_user",
		desc: "账号台账读 Better Auth 的 sys_user(只读);这一页管的是授权 —— 谁在哪些部门、每个部门是什么角色",
	},
	{
		name: "部门管理",
		path: "/settings/departments",
		source: "sys_dept",
		desc: "部门树 —— 数据权限的边界;成员与角色记在 sys_user_dept 上(一人可跨多个部门)",
	},
	{
		name: "角色管理",
		path: "/settings/roles",
		source: "sys_role",
		desc: "角色**全局定义**(不随部门复制)+ 权限点勾选;sys_role_menu 同时决定菜单可见与按钮可用",
	},
];

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
				description="模板自带的入口页 —— 真实业务上手后会替换它。当前只做三件事:跳到各模块入口、给新项目的速查清单、把「派生时删什么」列清楚。"
				descriptionInline
			/>

			{/* UI 组件示例 —— 原来 7 个 /showcase/* 路由收敛到这里一块 */}
			<Card tone="var(--hue-violet)">
				<CardHeader>
					<CardTitle className="text-base">UI 组件示例</CardTitle>
					<CardDescription>
						<code className="font-mono">components/ui/</code> 下 44 个通用原语的最小可用例子 —— 受控的都给好了
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

			{/* 模板四大块 */}
			<Card tone="var(--hue-violet)">
				<CardHeader>
					<CardTitle className="text-base">模板自带的四大入口</CardTitle>
					<CardDescription>由 NAV_NODES 派生 —— 改 nav-config.ts 这里全部跟着变。</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<div className="stagger grid gap-3 md:grid-cols-3">
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

			{/* 系统设置模块介绍 —— 七个页面分别吃什么数据 */}
			<Card tone="var(--hue-amber)">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<Database className="size-4 text-muted-foreground" />
						系统设置模块(唯一保留的真实业务)
					</CardTitle>
					<CardDescription>
						七个页面 = <strong className="text-foreground">4 页真实数据</strong> +
						<strong className="text-foreground"> 3 页「待实现」占位</strong>。数据都在 MySQL 里,不是 mock ——
						建表与本机开发按下面的命令走。
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 pt-0">
					<div className="stagger grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
						{SETTINGS_PAGES.map((page) => (
							<Link
								key={page.path}
								to={page.path}
								className="group flex items-start gap-3 rounded-xl border border-border p-3 transition-[background-color,border-color,box-shadow] duration-150 hover:border-border-strong hover:bg-secondary hover:shadow-raise-1"
							>
								<span
									className={cn(
										"flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
										page.source
											? "bg-hue-blue-soft text-primary ring-border"
											: "bg-muted text-muted-foreground ring-border",
									)}
								>
									<FolderTree className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-center justify-between gap-2">
										<span className="truncate font-medium text-foreground">{page.name}</span>
										{page.source ? (
											<Badge variant="secondary" className="shrink-0 px-1.5 font-mono text-xs">
												{page.source}
											</Badge>
										) : (
											<Badge className="shrink-0 bg-hue-amber-soft px-1.5 text-xs text-hue-amber-fg">待实现</Badge>
										)}
									</div>
									<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{page.desc}</p>
								</div>
							</Link>
						))}
					</div>

					<div className="rounded-xl border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
						<div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
							<TagIcon className="size-3.5 text-muted-foreground" />
							建表与灌种子(全部幂等)
						</div>
						<p>
							<code className="font-mono text-foreground">pnpm db:create</code> 建五张系统表 ·{" "}
							<code className="font-mono text-foreground">pnpm db:seed:menus</code> 把 NAV_NODES 写进 sys_menu ·{" "}
							<code className="font-mono text-foreground">db:seed:dicts</code> /{" "}
							<code className="font-mono text-foreground">db:seed:paras</code> /{" "}
							<code className="font-mono text-foreground">db:seed:tags</code> 灌示例数据。
						</p>
						<p className="mt-1">
							老库升级跑 <code className="font-mono text-foreground">pnpm db:migrate:ids</code>(语义 id → nanoid)与{" "}
							<code className="font-mono text-foreground">pnpm db:sync:meta</code>(对齐列注释 / 索引名);接口改动由{" "}
							<code className="font-mono text-foreground">pnpm test</code> 覆盖(直调 tRPC procedure 的集成测试,共 29
							条)。
						</p>
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
	const Icon = NAV_ICON_MAP[node.icon as NavIcon];
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
				{Icon ? <Icon className="size-4" /> : <Layers className="size-4" />}
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
