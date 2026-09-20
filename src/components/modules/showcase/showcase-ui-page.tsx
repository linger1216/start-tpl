import { Check, Copy, Download, Plus, Search, Settings, Trash2 } from "lucide-react";

import { PropTable, ShowcaseItem, ShowcasePage, ShowcaseSection, ShowcaseTag } from "#/components/layout/showcase";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Badge } from "#/components/ui/badge";
import { BadgeList } from "#/components/ui/badge-list";
import { Button, MotionButton } from "#/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "#/components/ui/button-group";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { DetailRow } from "#/components/ui/detail-row";
import { JsonBlock } from "#/components/ui/json-block";
import { JsonCell, BADGE_THEMES as THEMES } from "#/components/ui/json-cell";
import { Reveal } from "#/components/ui/reveal";
import { ScoreText } from "#/components/ui/score-text";
import { Separator } from "#/components/ui/separator";
import { Skeleton } from "#/components/ui/skeleton";
import { StatCardsSkeleton, TableSkeleton } from "#/components/ui/skeleton-blocks";
import { Spinner } from "#/components/ui/spinner";
import { StatusBadge, StatusWordBadge } from "#/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";

/**
 * 基础组件展示页 —— `components/ui/` 里**无业务语义的叶子原语**。
 *
 * 这一层是 vendored + 自研混合:shadcn 风格的通用控件(button / card / table…)与
 * 项目自研的组合原语(search-select / badge-list / date-range-picker / status-badge)。
 * 两者都遵守同一条规矩:**一个文件一个主组件,一律具名导出,变体走 `cva`**。
 */

const BUTTON_VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const BUTTON_SIZES = ["xs", "sm", "default", "lg"] as const;

/** 未在本页逐个演示的原语 —— 保持可见,否则"没展示 = 不存在" */
const OTHER_PRIMITIVES: ReadonlyArray<{ name: string; purpose: string; file: string; used: string }> = [
	{
		name: "Dialog",
		purpose: "模态弹窗骨架(标题 / 描述 / 页脚)。项目里的确认框与结果弹窗都基于它。",
		file: "dialog.tsx",
		used: "被多处间接使用",
	},
	{ name: "Sheet", purpose: "侧边抽屉 —— 内容比弹窗长、又不想整页跳转时用。", file: "sheet.tsx", used: "当前无调用方" },
	{
		name: "Popover",
		purpose: "点触发、浮层里放任意内容的轻弹层(不是菜单)。",
		file: "popover.tsx",
		used: "当前无调用方",
	},
	{ name: "Tooltip", purpose: "hover 提示;一般只在图标按钮上补文案。", file: "tooltip.tsx", used: "被日历间接使用" },
	{
		name: "DropdownMenu",
		purpose: "行操作 / 更多操作的下拉菜单(支持勾选、分组、子菜单)。",
		file: "dropdown-menu.tsx",
		used: "当前无调用方",
	},
	{
		name: "ContextMenu",
		purpose: "右键菜单 —— Web 后台用得少,但表格行上很好用。",
		file: "context-menu.tsx",
		used: "当前无调用方",
	},
	{ name: "Menubar", purpose: "桌面应用式的顶部菜单条。", file: "menubar.tsx", used: "当前无调用方" },
	{ name: "Command", purpose: "命令面板 / 可搜索的选择器(cm⌘k 那类交互)。", file: "command.tsx", used: "当前无调用方" },
	{
		name: "Calendar",
		purpose: "单日期选择;范围选择用 `date-range-picker`(见表单组件页)。",
		file: "calendar.tsx",
		used: "被日期范围选择器使用",
	},
	{
		name: "Breadcrumb",
		purpose: "面包屑原语。**注意**:后台顶栏自带面包屑实现(`layout/topbar.tsx`,从菜单树派生),页内不要再放一套。",
		file: "breadcrumb.tsx",
		used: "顶栏自研,未用此原语",
	},
	{
		name: "Toaster",
		purpose: "sonner 的全局容器,已挂在 `routes/__root.tsx`,直接 `toast.success(...)` 即可。",
		file: "sonner.tsx",
		used: "全站唯一挂载点",
	},
];

export function ShowcaseUiPage() {
	return (
		<ShowcasePage
			title="基础组件"
			description="components/ui 下无业务语义的叶子原语。它们的接口不含任何业务概念,可以直接搬进任何新项目。"
			toc={[
				["button", "按钮"],
				["badge", "徽章"],
				["status", "状态徽章"],
				["layout", "容器与分隔"],
				["table", "表格原语"],
				["display", "数据展示原语"],
				["feedback", "加载与动画"],
				["others", "其他可用原语"],
			]}
		>
			<ShowcaseSection
				id="button"
				title="按钮"
				description="六种变体 × 四个尺寸。尺寸是后台密度约定:xs 用于表格行内,sm 用于工具栏,default 用于表单,lg 用于登录/营销页。"
			>
				<ShowcaseItem
					name="Button"
					summary="主按钮,六变体"
					source="ui/button.tsx"
					note={
						<>
							变更按钮样式改 <code className="font-mono">buttonVariants</code> 的 cva 定义,<strong>不要</strong>
							在调用处堆 className 覆盖 —— 那会让同一个变体在不同页面长得不一样。
						</>
					}
					demo={
						<div className="space-y-3">
							{BUTTON_SIZES.map((size) => (
								<div key={size} className="flex flex-wrap items-center gap-2">
									<code className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{size}</code>
									{BUTTON_VARIANTS.map((variant) => (
										<Button key={variant} variant={variant} size={size}>
											{variant}
										</Button>
									))}
								</div>
							))}
							<Separator />
							<div className="flex flex-wrap items-center gap-2">
								<code className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">icon</code>
								<Button size="icon-sm" aria-label="搜索">
									<Search />
								</Button>
								<Button size="icon" aria-label="设置">
									<Settings />
								</Button>
								<Button size="icon-lg" aria-label="新增">
									<Plus />
								</Button>
								<Button disabled>禁用态</Button>
								<Button>
									<Plus />
									带图标
								</Button>
							</div>
						</div>
					}
					code={`<Button variant="default" size="sm">保存</Button>
<Button variant="outline" size="sm"><Plus />新增</Button>
<Button size="icon-sm" aria-label="搜索"><Search /></Button>`}
				/>

				<ShowcaseItem
					name="MotionButton"
					summary="带扫光动效的主按钮"
					source="ui/button.tsx"
					note="只在需要强调的首屏主操作上用。动效遵循 --duration-brand,prefers-reduced-motion 下自动复位。"
					demo={
						<div className="flex flex-wrap items-center gap-2">
							<MotionButton>新建项目</MotionButton>
							<MotionButton variant="outline">查看文档</MotionButton>
						</div>
					}
					code={`<MotionButton>新建项目</MotionButton>`}
				/>

				<ShowcaseItem
					name="ButtonGroup"
					summary="按钮组:相邻按钮共享圆角与边框"
					source="ui/button-group.tsx"
					dense
					demo={
						<div className="space-y-2">
							<ButtonGroup>
								<Button variant="outline" size="sm">
									<Copy />
									复制
								</Button>
								<ButtonGroupSeparator />
								<Button variant="outline" size="sm">
									<Download />
									导出
								</Button>
								<ButtonGroupSeparator />
								<Button variant="outline" size="sm" className="text-destructive">
									<Trash2 />
									删除
								</Button>
							</ButtonGroup>
							<ButtonGroup>
								<ButtonGroupText>共 12 条</ButtonGroupText>
								<Button size="sm">查看</Button>
							</ButtonGroup>
						</div>
					}
					code={`<ButtonGroup>
  <Button variant="outline" size="sm">复制</Button>
  <ButtonGroupSeparator />
  <Button variant="outline" size="sm">导出</Button>
</ButtonGroup>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="badge"
				title="徽章"
				description="Badge 是四档语义色;BadgeList 是分类色板 —— 后者用于「任意值 → 彩色小标签」的批量上色场景。"
			>
				<ShowcaseItem
					name="Badge"
					summary="语义徽章,四变体"
					source="ui/badge.tsx"
					note={
						<>
							变体含义:<code className="font-mono">default</code> 强调 / <code className="font-mono">secondary</code>{" "}
							中性 / <code className="font-mono">destructive</code> 异常 / <code className="font-mono">outline</code>{" "}
							弱化。不要为了配色自己拼 className。
						</>
					}
					demo={
						<div className="flex flex-wrap items-center gap-2">
							{BUTTON_VARIANTS.slice(0, 4).map((variant) => (
								<Badge key={variant} variant={variant as "default" | "secondary" | "destructive" | "outline"}>
									{variant}
								</Badge>
							))}
							<Badge variant="secondary" className="gap-1">
								<Check className="size-3" />
								带图标
							</Badge>
						</div>
					}
					code={`<Badge variant="secondary">草稿</Badge>
<Badge variant="destructive">异常</Badge>`}
				/>

				<ShowcaseItem
					name="BadgeList"
					summary="任意值 → 彩色标签组"
					source="ui/badge-list.tsx"
					note={
						<>
							七个主题:<code className="font-mono">brand</code>(默认,规范内) / rainbow / ocean / forest / sunset /
							lavender / stone(规范外的分类色板)。
							<code className="font-mono">color=&quot;stable&quot;</code> 按值做稳定哈希取色 ——{" "}
							<strong>不要用 random</strong>
							,那会造成 SSR 水合不一致。
						</>
					}
					demo={
						<div className="space-y-3">
							<div className="flex items-center gap-3">
								<span className="w-24 shrink-0 font-mono text-[11px] text-muted-foreground">brand</span>
								<BadgeList values={["重点监管", "消防安全", "食品安全"]} color="brand" layout="wrap" />
							</div>
							{(["rainbow", "ocean", "forest", "sunset", "lavender", "stone"] as const).map((theme) => (
								<div key={theme} className="flex items-center gap-3">
									<span className="w-24 shrink-0 font-mono text-[11px] text-muted-foreground">{theme}</span>
									<BadgeList values={["重点监管", "消防安全", "食品安全"]} color={theme} layout="wrap" />
								</div>
							))}
							<div className="flex items-center gap-3">
								<span className="w-24 shrink-0 font-mono text-[11px] text-muted-foreground">stable</span>
								<BadgeList values={["A-1024", "A-2048", "B-4096"]} color="stable" layout="wrap" />
							</div>
						</div>
					}
					code={`<BadgeList values={["重点监管","消防安全"]} color="brand" layout="wrap" />
<BadgeList values={ids} color="stable" />   // 按值稳定取色`}
				/>

				<ShowcaseItem
					name="JsonCell"
					summary="表格单元格:任意值归一后上色"
					source="ui/json-cell.tsx"
					note={
						<>
							内部就是 <code className="font-mono">normalize</code> + <code className="font-mono">BadgeList</code>。
							JSON 字符串列传 <code className="font-mono">parseMultiValue</code>,单值列传{" "}
							<code className="font-mono">singleText</code>。
						</>
					}
					demo={
						<div className="flex flex-wrap items-center gap-6">
							<div className="space-y-1">
								<div className="text-[11px] text-muted-foreground">数组值(stack)</div>
								<JsonCell value={["企业", "人员"]} />
							</div>
							<div className="space-y-1">
								<div className="text-[11px] text-muted-foreground">数组值(wrap)</div>
								<JsonCell value={["企业", "人员", "案件"]} layout="wrap" />
							</div>
							<div className="space-y-1">
								<div className="text-[11px] text-muted-foreground">对象值</div>
								<JsonCell value={{ a: 1, b: "x" }} />
							</div>
						</div>
					}
					code={`<JsonCell value={row.涉及对象} layout="wrap" color="ocean" />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="status"
				title="状态徽章"
				description="两种口径别混用:数字状态(1/0)走 StatusBadge,业务状态词走 StatusWordBadge。"
			>
				<ShowcaseItem
					name="StatusBadge"
					summary="数字状态 1/0 → 启用/禁用"
					source="ui/status-badge.tsx"
					note="接受任意 number,非 1 一律按 0 处理 —— 数据库/接口的历史脏数据不会渲染成空白。"
					demo={
						<div className="flex flex-wrap items-center gap-2">
							<StatusBadge status={1} />
							<StatusBadge status={0} />
							<StatusBadge status={7} />
						</div>
					}
					code={`<StatusBadge status={row.状态} />`}
				/>

				<ShowcaseItem
					name="StatusWordBadge"
					summary="业务状态词 → 语义色"
					source="ui/status-badge.tsx"
					note={
						<>
							内置词表只放**跨域通用**的词(启用/暂停/待复核/异常…)。域内专有词通过{" "}
							<code className="font-mono">variants</code> 传入,<strong>不要再复制一个组件</strong>。
						</>
					}
					demo={
						<div className="space-y-2">
							<div className="flex flex-wrap items-center gap-2">
								{["启用", "正常", "待复核", "异常", "失败", "某个没登记的词"].map((word) => (
									<StatusWordBadge key={word} value={word} />
								))}
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-[12px] text-muted-foreground">域内词表:</span>
								{["已关联", "免现场检查", "建议约谈"].map((word) => (
									<StatusWordBadge
										key={word}
										value={word}
										variants={{ 已关联: "default", 免现场检查: "default", 建议约谈: "secondary" }}
									/>
								))}
							</div>
						</div>
					}
					code={`<StatusWordBadge value={row.状态} />
<StatusWordBadge value={row.状态} variants={{ 已关联: "default" }} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="layout" title="容器与分隔" description="页面骨架最常用的三件:卡片、分隔线、折叠区。">
				<ShowcaseItem
					name="Card"
					summary="卡片容器,六个插槽"
					source="ui/card.tsx"
					demo={
						<div className="grid gap-3 md:grid-cols-2">
							<Card>
								<CardHeader>
									<CardTitle>带页头页脚的卡片</CardTitle>
									<CardDescription>CardHeader / CardTitle / CardDescription / CardContent / CardFooter</CardDescription>
								</CardHeader>
								<CardContent className="text-[13px] text-muted-foreground">
									正文区。改圆角与阴影走 DESIGN.md 的 token,不要在调用处覆盖。
								</CardContent>
								<CardFooter className="gap-2">
									<Button size="sm">确定</Button>
									<Button size="sm" variant="ghost">
										取消
									</Button>
								</CardFooter>
							</Card>
							<Card size="sm" className="bg-muted/40 shadow-none">
								<CardContent className="pt-4 text-[13px] text-muted-foreground">
									<code className="font-mono text-[12px]">size=&quot;sm&quot;</code> 的紧凑卡片 ——
									用于页面里的次级信息块。
								</CardContent>
							</Card>
						</div>
					}
					code={`<Card>
  <CardHeader><CardTitle>标题</CardTitle></CardHeader>
  <CardContent>正文</CardContent>
  <CardFooter><Button size="sm">确定</Button></CardFooter>
</Card>`}
				/>

				<ShowcaseItem
					name="Separator · Collapsible"
					summary="分隔线与折叠区"
					source="ui/separator.tsx · ui/collapsible.tsx"
					dense
					demo={
						<div className="space-y-3">
							<div>
								<div className="text-[13px]">上方内容</div>
								<Separator className="my-2" />
								<div className="text-[13px]">下方内容</div>
								<div className="flex h-8 items-center gap-3 text-[13px]">
									<span>左</span>
									<Separator orientation="vertical" />
									<span>右</span>
								</div>
							</div>
							<Collapsible>
								<CollapsibleTrigger render={<Button variant="outline" size="sm" />}>展开高级设置</CollapsibleTrigger>
								<CollapsibleContent className="pt-2 text-[13px] text-muted-foreground">
									折叠区内容 —— 默认收起,减少首屏视觉负担。
								</CollapsibleContent>
							</Collapsible>
						</div>
					}
					code={`<Separator />
<Separator orientation="vertical" />
<Collapsible>
  <CollapsibleTrigger render={<Button size="sm" />}>展开</CollapsibleTrigger>
  <CollapsibleContent>…</CollapsibleContent>
</Collapsible>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="table"
				title="表格原语"
				description="Table 系列是**无状态**的 HTML 结构包装 —— 排序、分页、选中都在 lib/table.ts 的 useAppTable 里。这里只列结构件。"
			>
				<ShowcaseItem
					name="Table · TableResizeHandle"
					summary="静态表格结构与列宽拖拽手柄"
					source="ui/table.tsx"
					demo={
						<div className="space-y-2">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-40">名称</TableHead>
										<TableHead>状态</TableHead>
										<TableHead className="w-24 text-right">操作</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									<TableRow>
										<TableCell>示例记录 A</TableCell>
										<TableCell>
											<StatusBadge status={1} />
										</TableCell>
										<TableCell className="text-right">
											<Button variant="ghost" size="xs">
												查看
											</Button>
										</TableCell>
									</TableRow>
									<TableRow>
										<TableCell>示例记录 B</TableCell>
										<TableCell>
											<StatusBadge status={0} />
										</TableCell>
										<TableCell className="text-right">
											<Button variant="ghost" size="xs">
												查看
											</Button>
										</TableCell>
									</TableRow>
								</TableBody>
							</Table>
							<p className="text-[12px] text-muted-foreground">
								空态行写法:一行 <code className="font-mono">TableRow</code> + 一个{" "}
								<code className="font-mono">colSpan</code> 覆盖全列的 TableCell(h-24 / 居中 / muted)。
							</p>
						</div>
					}
					code={`<Table>
  <TableHeader><TableRow><TableHead>名称</TableHead></TableRow></TableHeader>
  <TableBody>
    {rows.length === 0
      ? <TableRow><TableCell colSpan={n} className="h-24 text-center text-muted-foreground">暂无数据</TableCell></TableRow>
      : rows.map(row => <TableRow key={row.id}>…</TableRow>)}
  </TableBody>
</Table>`}
				/>

				<ShowcaseItem
					name="DetailRow"
					summary="详情字段行:左固定标签 + 右自适应值"
					source="ui/detail-row.tsx"
					note="详情弹窗与详情页的字段行统一用它 —— 各域各写一套会让标签列宽在页面之间不一致。"
					demo={
						<div className="divide-y divide-border rounded-lg border border-border px-3 py-1 md:max-w-xl">
							<DetailRow label="统一信用代码">91310101MA1FL2XXXX</DetailRow>
							<DetailRow label="涉及标签">
								<BadgeList values={["重点监管", "消防安全"]} layout="wrap" />
							</DetailRow>
							<DetailRow label="备注">
								这是一段比较长的说明文字,用来验证右侧内容会自动换行而不是把标签列挤变形。
							</DetailRow>
						</div>
					}
					code={`<DetailRow label="统一信用代码">{row.creditCode}</DetailRow>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="display"
				title="数据展示原语"
				description="把「值」渲染成人看得懂的东西:JSON、评分、用户头像。"
			>
				<ShowcaseItem
					name="JsonBlock · ScoreText"
					summary="JSON 折叠展示与分数着色"
					source="ui/json-block.tsx · ui/score-text.tsx"
					dense
					demo={
						<div className="grid gap-3 md:grid-cols-2">
							<JsonBlock value={{ id: "ENT-0001", tags: ["重点监管", "消防"], nested: { level: 2 } }} />
							<div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
								{["98", "85", "72", "60", "45", "-"].map((value) => (
									<span key={value} className="text-[13px]">
										<ScoreText value={value} />
									</span>
								))}
							</div>
						</div>
					}
					code={`<JsonBlock value={row.原始报文} />
<ScoreText value={row.评分} />`}
				/>

				<ShowcaseItem
					name="Avatar"
					summary="头像:图片 + 首字回落"
					source="ui/avatar.tsx"
					dense
					demo={
						<div className="flex items-center gap-3">
							<Avatar>
								<AvatarImage src="/drizzle.svg" alt="" />
								<AvatarFallback>张</AvatarFallback>
							</Avatar>
							<Avatar>
								<AvatarFallback>李</AvatarFallback>
							</Avatar>
							<Avatar className="size-11">
								<AvatarFallback>王</AvatarFallback>
							</Avatar>
						</div>
					}
					code={`<Avatar>
  <AvatarImage src={user.avatar} alt="" />
  <AvatarFallback>{user.name[0]}</AvatarFallback>
</Avatar>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="feedback"
				title="加载与动效"
				description="骨架屏用于「首次加载」,Spinner 用于「已有内容时的局部忙碌」,Reveal 用于「滚动入场」。"
			>
				<ShowcaseItem
					name="Skeleton · StatCardsSkeleton · TableSkeleton"
					summary="三类骨架屏"
					source="ui/skeleton.tsx · ui/skeleton-blocks.tsx"
					note="骨架屏只在**首屏无数据**时用。已有数据的重查询请用 TableLoadingShell —— 换骨架会让高度塌陷、滚动位置跳。"
					demo={
						<div className="space-y-4">
							<div>
								<div className="mb-1.5 text-[11px] text-muted-foreground">StatCardsSkeleton(compact)</div>
								<StatCardsSkeleton count={4} compact />
							</div>
							<div>
								<div className="mb-1.5 text-[11px] text-muted-foreground">Skeleton 基础块</div>
								<div className="flex items-center gap-3">
									<Skeleton className="size-9 rounded-lg" />
									<div className="space-y-1.5">
										<Skeleton className="h-3 w-32" />
										<Skeleton className="h-3 w-20" />
									</div>
								</div>
							</div>
							<div>
								<div className="mb-1.5 text-[11px] text-muted-foreground">TableSkeleton(用在 TableBody 里)</div>
								<div className="overflow-hidden rounded-lg border border-border">
									<Table>
										<TableBody>
											<TableSkeleton rows={3} cols={3} />
										</TableBody>
									</Table>
								</div>
							</div>
						</div>
					}
					code={`<StatCardsSkeleton count={4} compact />
<Table><TableBody><TableSkeleton rows={5} cols={4} /></TableBody></Table>`}
				/>

				<ShowcaseItem
					name="Spinner"
					summary="三档尺寸的行内加载指示"
					source="ui/spinner.tsx"
					dense
					demo={
						<div className="flex items-center gap-6">
							<Spinner size="sm" />
							<Spinner size="md" />
							<Spinner size="lg" />
							<Spinner size="sm" label="正在保存" className="text-[13px] text-muted-foreground" />
						</div>
					}
					code={`<Spinner size="sm" label="正在保存" />`}
				/>

				<ShowcaseItem
					name="Reveal"
					summary="滚动入场动效"
					source="ui/reveal.tsx"
					note={
						<>
							用 IntersectionObserver,元素进入视口才播。列表项用{" "}
							<code className="font-mono">delay=&#123;i * 40&#125;</code> 做错峰, 并保证{" "}
							<code className="font-mono">prefers-reduced-motion</code> 下复位。
						</>
					}
					demo={
						<div className="space-y-2">
							{[0, 1, 2].map((i) => (
								<Reveal key={i} delay={i * 120} className="rounded-lg border border-border px-3 py-2 text-[13px]">
									第 {i + 1} 项(延迟 {i * 120}ms 入场)
								</Reveal>
							))}
						</div>
					}
					code={`<Reveal delay={i * 40}>…</Reveal>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="api"
				title="变体速查"
				description="改造按钮/徽章样式时,先看这里 —— 改 cva 定义,而不是改调用处。"
			>
				<PropTable
					rows={[
						{
							name: "buttonVariants.variant",
							type: BUTTON_VARIANTS.join(" | "),
							note: "default 主操作 / secondary 面板底 / outline 描边 / ghost 极轻 / destructive 危险 / link 文字链接",
						},
						{
							name: "buttonVariants.size",
							type: "xs | sm | default | lg | icon-sm | icon | icon-lg",
							note: "xs=28px(表格行内)、sm=32px(工具栏)、default=36px(表单)、lg=52px(营销页)",
						},
						{
							name: "Badge.variant",
							type: "default | secondary | destructive | outline",
							note: "四档语义色。需要多色请用 BadgeList,不要拼 className",
						},
						{
							name: "BadgeList.color",
							type: "none | 主题名 | stable | string[]",
							note: "七个主题:brand(默认)/rainbow/ocean/forest/sunset/lavender/stone",
						},
						{ name: "Reveal.delay", type: "number(ms)", note: "错峰入场用 i * 40;超过 400ms 会显得迟钝" },
					]}
				/>
				<ShowcaseItem
					name="可用主题常量"
					summary="BADGE_THEMES 的键"
					source="ui/badge-list.tsx"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-2">
							{Object.keys(THEMES).map((name) => (
								<span key={name} className="rounded-full border border-border px-2.5 py-1 font-mono text-[11.5px]">
									{name}
								</span>
							))}
							<span className="text-[12px] text-muted-foreground">
								(共 {Object.keys(THEMES).length} 个;<code className="font-mono">brand</code> 是唯一规范内主题)
							</span>
						</div>
					}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="others"
				title="其他可用原语"
				description="这一层还有下面这些 —— 本页没有逐个做活例子(有的是复合弹层、有的需要上下文),但它们都在,需要时按路径直接引用,不必重新 `shadcn add`。"
			>
				<ShowcaseItem
					name="尚未逐个演示的原语"
					summary={`${OTHER_PRIMITIVES.length} 个`}
					source="components/ui/"
					demo={
						<dl className="grid gap-x-6 gap-y-2 md:grid-cols-2">
							{OTHER_PRIMITIVES.map((item) => (
								<div key={item.name} className="min-w-0">
									<dt className="flex flex-wrap items-baseline gap-x-2">
										<code className="font-mono text-[12.5px] font-medium text-foreground">{item.name}</code>
										<span className="text-[11px] text-muted-foreground">{item.used}</span>
									</dt>
									<dd className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
										{item.purpose}
										<span className="ml-1 font-mono text-[11px] text-muted-foreground/70">{item.file}</span>
									</dd>
								</div>
							))}
						</dl>
					}
					code={`import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "#/components/ui/dropdown-menu";`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="notes" title="这一层的规矩" description="给新项目派生时的注意事项。">
				<div className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
					<p>
						<ShowcaseTag variant="outline">vendored</ShowcaseTag> <code className="font-mono">components/ui/</code>{" "}
						里有相当一部分是 shadcn 的上游代码,<strong className="text-foreground">不要在这里顺手修 lint</strong> ——
						biome.json 对它有一条 scoped override,改的是 override 配置,不是组件代码。
					</p>
					<p>
						<code className="font-mono">tabs.tsx</code> 是<strong className="text-foreground">唯一被项目改写过</strong>
						的上游文件(卡片式页签 + <code className="font-mono">count</code> 计数胶囊)。{" "}
						<code className="font-mono">pnpm dlx shadcn@latest add tabs</code> 会覆盖它,覆盖后需按 DESIGN.md §5.5 重做。
					</p>
					<p>
						加新原语前先搜一遍:<code className="font-mono">list-input / multi-value / json-cell</code>{" "}
						这类通用形状很容易被重复造 ——本页顶部的「本章共 N 个组件」就是这一层现有规模。
					</p>
				</div>
			</ShowcaseSection>
		</ShowcasePage>
	);
}
