import { ArrowLeft, Building2, Inbox, MapPin } from "lucide-react";
import { EmptyState } from "#/components/layout/empty-state";
import { ModuleOverview } from "#/components/layout/module-overview";
import { PageHeader } from "#/components/layout/page-header";
import {
	CodeBlock,
	PropTable,
	ShowcaseItem,
	ShowcasePage,
	ShowcaseSection,
	ShowcaseTag,
} from "#/components/layout/showcase";
import { Sidebar } from "#/components/layout/sidebar";
import { SidebarProvider } from "#/components/layout/sidebar-provider";
import { StubPage } from "#/components/layout/stub-page";
import { type StubTab, TabbedStubPage } from "#/components/layout/tabbed-stub-page";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";

/**
 * 布局与外壳展示页 —— 后台的两层「画布」:
 *
 * · **页面级版式**:`PageHeader` + `EmptyState` + `StubPage` / `TabbedStubPage`
 * —— 单页内容的固定骨架,任何页面都从这套开始;
 * · **模块级版式**:`ModuleOverview` ——「一级模块首页」,按 `NAV_NODES` 自动派生
 * 子页面卡片网格;
 * · **后台外壳**:Sidebar(本展示页右侧那个)—— 用来验菜单树渲染效果。
 *
 * 之所以把外壳一并展示:菜单刚改完时,看本页就能立刻肉眼对照侧边栏的展开 /
 * 折叠 / 命中态。
 */

const STUB_TABS: StubTab[] = [
	{ label: "基础", title: "基础信息", description: "占位 tab —— 页面骨架未定时先挂在这里。" },
	{ label: "关联", title: "关联数据", description: "第二个占位 tab,演示多 tab 的版式。", sourceNo: 2 },
	{ label: "历史", title: "变更历史", description: "第三个占位 tab。", sourceNo: 3 },
];

function FullShell() {
	return (
		<div className="grid h-[480px] grid-cols-[220px_1fr] overflow-hidden rounded-xl border border-border">
			<SidebarProvider>
				<div className="border-r border-border bg-card">
					<Sidebar collapsed={false} />
				</div>
				<div className="overflow-auto p-5">
					<PageHeader
						title="侧边栏与页头"
						description="后台外壳的两件 —— 左侧是真实菜单树,右侧是页面头部。改 NAV_NODES 后这侧边栏立刻跟着变。"
						descriptionInline
					/>
					<EmptyState
						icon={<Inbox className="size-5" />}
						title="外壳演示区"
						description="这一片用来演示内容区;实际页面的工具栏 / 表格 / 表单都放在这里。"
						actions={
							<Button size="sm" variant="outline">
								开始操作
							</Button>
						}
					/>
				</div>
			</SidebarProvider>
		</div>
	);
}

function TabsSample() {
	return (
		<Tabs defaultValue="基础">
			<TabsList>
				<TabsTrigger value="基础">基础</TabsTrigger>
				<TabsTrigger value="数据" count={12}>
					数据
				</TabsTrigger>
				<TabsTrigger value="高级" count={3}>
					高级
				</TabsTrigger>
				<TabsTrigger value="已停用" disabled>
					已停用
				</TabsTrigger>
			</TabsList>
			<TabsContent value="基础">
				<Card>
					<CardContent className="pt-5 text-[13px] text-muted-foreground">基础设置区。</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="数据">
				<Card>
					<CardContent className="pt-5 text-[13px] text-muted-foreground">数据管理区,共 12 条。</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="高级">
				<Card>
					<CardContent className="pt-5 text-[13px] text-muted-foreground">高级开关区,3 项可调。</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	);
}

export function ShowcaseLayoutPage() {
	return (
		<ShowcasePage
			title="布局与外壳"
			description="后台的画布:页面头部、空态、占位页、tabs 与模块概览,以及**整个后台外壳**的实时样子。"
			toc={[
				["shell", "后台外壳"],
				["header", "页面头部"],
				["empty", "空态"],
				["stub", "占位页"],
				["tabs", "卡片式页签"],
				["overview", "模块概览"],
			]}
		>
			<ShowcaseSection id="shell" title="后台外壳">
				<ShowcaseItem
					name="Sidebar + PageHeader"
					summary="侧边栏 + 顶栏 + 内容区,后台的画布"
					source="layout/sidebar.tsx · layout/page-header.tsx"
					note={
						<>
							菜单是<strong className="text-foreground">库 + 兜底</strong>双源:`sys_menu` 表有数据读表, 为空时退回
							`NAV_NODES`(见 `nav-permissions.tsx`)。
						</>
					}
					dense
					demo={<FullShell />}
					code={`// (main)/route.tsx 里挂三件:
<NavPermissionsProvider>
 <SidebarProvider>
 <Outlet /> // 实际页面从这里渲染
 </SidebarProvider>
</NavPermissionsProvider>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="header"
				title="页面头部"
				description="白底画布 + 底部 1px 分隔;描述默认藏在 (i) 里,短描述可内联。"
			>
				<ShowcaseItem
					name="PageHeader"
					summary="标准页头(标题 + 描述 + 右上操作)"
					source="layout/page-header.tsx"
					demo={
						<div className="space-y-4">
							<PageHeader
								title="长描述默认进 (i)"
								description="这段说明默认不常驻,标题右边的小 (i) 触发器 hover / focus 时才弹出来 —— 页面密度更高。"
								actions={
									<Button size="sm">
										<ArrowLeft className="size-3.5" />
										返回
									</Button>
								}
							/>
							<PageHeader
								title="短描述内联"
								description="传 descriptionInline=true,描述直接铺在标题下 —— 短说明更适合这种排版。"
								descriptionInline
								actions={
									<Button size="sm" variant="outline">
										新增
									</Button>
								}
							/>
						</div>
					}
					code={`<PageHeader title="…" description="长说明" />
<PageHeader title="…" description="短说明" descriptionInline />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="empty" title="空态">
				<ShowcaseItem
					name="EmptyState"
					summary="通用空态:图标 + 标题 + 描述 + 操作"
					source="layout/empty-state.tsx"
					demo={
						<div className="grid gap-3 md:grid-cols-2">
							<EmptyState
								icon={<Inbox className="size-5" />}
								title="还没有任何数据"
								description="新增第一条记录后,这里就会显示出来。"
								actions={
									<Button size="sm">
										<Building2 className="size-3.5" />
										新增第一条
									</Button>
								}
							/>
							<EmptyState
								icon={<MapPin className="size-5" />}
								title="未命中结果"
								description="调整筛选条件后再次搜索,或清除所有筛选项。"
								actions={
									<Button size="sm" variant="outline">
										清除筛选
									</Button>
								}
							/>
						</div>
					}
					code={`<EmptyState
 icon={<Inbox className="size-5" />}
 title="还没有任何数据"
 description="新增第一条记录后,这里就会显示出来。"
 actions={<Button>新增第一条</Button>}
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="stub" title="占位页" description="页面骨架未定时用,接入真实业务后整块替换。">
				<ShowcaseItem
					name="StubPage · TabbedStubPage"
					summary="单页占位 + 多 tab 占位"
					source="layout/stub-page.tsx · layout/tabbed-stub-page.tsx"
					demo={
						<div className="space-y-6">
							<StubPage
								title="单页占位"
								description="一行描述 + 空态 + 一个动作,适合还没接到真实业务的路由。"
								actions={<ShowcaseTag variant="outline">stub</ShowcaseTag>}
							/>
							<TabbedStubPage
								title="多 tab 占位"
								description="同一形态、多个数据域的合并页:tab 一一对应域,空态在 tab 内。"
								tabs={STUB_TABS}
							/>
						</div>
					}
					code={`<StubPage title="…" description="…" />
<TabbedStubPage
  title="…"
  tabs={[
    { label: "基础", title: "基础信息", description: "…" },
    { label: "关联", title: "关联数据", description: "…", sourceNo: 2 },
  ]}
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="tabs"
				title="卡片式页签"
				description="Tabs 是被改写过的上游组件:卡片式、计数走 count 属性、disable 生效。"
			>
				<ShowcaseItem
					name="Tabs"
					summary="卡片式页签 + count 计数 + disabled"
					source="ui/tabs.tsx"
					note={
						<>
							<ShowcaseTag variant="destructive">vendored·改写</ShowcaseTag>
							这里不是 shadcn 的下划线版 Tabs,<code className="font-mono">pnpm dlx shadcn@latest add tabs</code>{" "}
							会覆盖它 —— 覆盖后需按 DESIGN.md §5.5 重做。
						</>
					}
					demo={<TabsSample />}
					code={`<Tabs defaultValue="基础">
 <TabsList>
 <TabsTrigger value="基础">基础</TabsTrigger>
 <TabsTrigger value="数据" count={12}>数据</TabsTrigger>
 <TabsTrigger value="高级" count={3}>高级</TabsTrigger>
 <TabsTrigger value="已停用" disabled>已停用</TabsTrigger>
 </TabsList>
 <TabsContent value="基础">…</TabsContent>
</Tabs>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="overview"
				title="模块概览"
				description="一级模块首页:按 NAV_NODES 自动派生子页面卡片网格,改菜单这里自动跟着变。"
			>
				<ShowcaseItem
					name="ModuleOverview"
					summary="一级模块首页,按 NAV_NODES 自动派生"
					source="layout/module-overview.tsx"
					demo={
						<Card>
							<CardContent className="p-0">
								<ModuleOverview path="/settings" />
							</CardContent>
						</Card>
					}
					code={`// src/routes/(main)/settings/index.tsx
import { ModuleOverview } from "#/components/layout/module-overview";
export const Route = createFileRoute("/(main)/settings/")({
 component:  () => <ModuleOverview path="/settings" />,
});`}
				/>
				<div className="rounded-xl border border-border bg-muted/30 px-3.5 py-2 text-[12px] text-muted-foreground">
					本页展示的「系统设置」是从 NAV_NODES 直接派生的 7 张卡片 + 描述;若想看另一枝(如「组件展示」), 切到 /showcase/*
					后侧边栏就会反映对应结构。
				</div>
				<PropTable
					rows={[
						{ name: "PageHeader.descriptionInline", type: "boolean", note: "默认 false:描述藏在 (i);短描述场景才打开" },
						{ name: "EmptyState.icon", type: "ReactNode", note: "图标放在 48×48 的灰色块里,Lucide React 类即可" },
						{ name: "TabsTrigger.count", type: "number", note: "数据条数,在 tab 名右侧渲染为小气泡" },
						{ name: "ModuleOverview.path", type: "string", note: "一级模块首页的 path,用来在 NAV_NODES 里找节点" },
					]}
				/>
				<CodeBlock
					code={`// 派生新项目时,这三件按顺序整块替换即可:
// 1. NAV_NODES 的 children 改成新业务;
// 2. settings/index.tsx 用 ModuleOverview(path="/<新一级>");
// 3. ModuleOverview 自己不用改 —— 一切跟着 NAV_NODES 走。`}
				/>
			</ShowcaseSection>
		</ShowcasePage>
	);
}
