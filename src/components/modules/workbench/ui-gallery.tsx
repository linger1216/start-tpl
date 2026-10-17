/**
 * UI 组件示例 —— 工作台 `/` 的一块。
 *
 * 为什么存在:`components/ui/` 是 vendored 的通用原语,删了可惜、留着没入口等于死代码。
 * 原来靠 7 个 `/showcase/*` 路由"点名",本轮把 7 个路由收敛成这里的一块 —— 组件照常保留、
 * 有活的例子可抄,但不再是 7 条路由 + 7 个页面文件的体量。
 *
 * 约定(改这个文件前读):
 *  - **只放最小可用示例**,不放长篇文档 —— 详细注释在各自 `ui/*.tsx` 的文件头;
 *  - 每个示例都要能**直接抄进业务页**:受控组件给好 useState,不给"半截用法";
 *  - 新增/删除 `ui/` / `shared/` / `lib/` 下的封装时,**同步在这里加减一格**,否则又会退回"孤儿组件";
 *  - 表格那种"一格里塞不下"的例子不挤进网格 —— 给它自己的整宽卡片(见 `UiGalleryTable`)。
 *  - **分层展示**:能独立渲染的就真跑(拖拽 / 勾选 / 校验都点得动);满足不了下面任一条的只给
 *    「签名 + 指路」卡 —— ① 需要 TanStack Form 的 field context(见 `/demo/form.simple`);
 *    ② 会把重依赖拖进**工作台首屏包**(`shared/icon-picker` → 策展的图标解析;`shared/excel-*` → xlsx);
 *    ③ 服务端专用(`lib/auth` / `lib/sys-para` 引 drizzle,客户端 import 会把 mysql2 打进浏览器)。
 */

import { useStore } from "@tanstack/react-store";
import { Building2, KeyRound, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { MultiSelect } from "#/components/modules/shared/multi-select";
import { type PermissionNode, PermissionSelect } from "#/components/modules/shared/permission-select";
import { SortableTree } from "#/components/modules/shared/sortable-tree";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { UiGalleryTable } from "#/components/modules/workbench/ui-gallery-table";
import { ActionButton } from "#/components/ui/action-button";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button, buttonVariants } from "#/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "#/components/ui/button-group";
import { Calendar } from "#/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { DateRangePicker } from "#/components/ui/date-range-picker";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { FileDropzone } from "#/components/ui/file-dropzone";
import { Input } from "#/components/ui/input";
import { InputNumber } from "#/components/ui/input-number";
import { JsonBlock } from "#/components/ui/json-block";
import { Label } from "#/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Reveal } from "#/components/ui/reveal";
import { ScoreText } from "#/components/ui/score-text";
import { SearchSelect } from "#/components/ui/search-select";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Separator } from "#/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "#/components/ui/sheet";
import { Skeleton, SkeletonCards, SkeletonTable } from "#/components/ui/skeleton";
import { Slider } from "#/components/ui/slider";
import { Spinner } from "#/components/ui/spinner";
import { Switch } from "#/components/ui/switch";
import { Table, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { TableResizeHandle } from "#/components/ui/table-resize-handle";
import {
	TAB_VARIANT_META,
	TABS_VARIANTS,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	type TabVariant,
} from "#/components/ui/tabs";
import { Tag } from "#/components/ui/tag";
import { TagInput } from "#/components/ui/tag-input";
import { TagList } from "#/components/ui/tag-list";
import { Textarea } from "#/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { store as demoStore, selectFullName } from "#/lib/demo-store";
import { formatJson } from "#/lib/format";
import { formatCode, ID_PATTERN, ID_PREFIX, newId } from "#/lib/ids";
import { createMockTable } from "#/lib/mock-table";
import { joinMultiValue, splitMultiValue } from "#/lib/multi-value";
import { asParaType, PARA_TYPE, PARA_TYPE_META, PARA_TYPES, type ParaType, validateParaValue } from "#/lib/para-spec";
import type { MockRow } from "#/lib/table";
import { formatLocalDate, formatLocalDateTime, formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/**
 * 空值兜底演示数据 —— `?? PLACEHOLDER_EMPTY` 只兜 null / undefined。
 * 用带类型的变量而不是字面量:字面量会被 TS 判成「恒空」(TS2871)。
 */
const MISSING_TEXT: string | null = null;
const EMPTY_TEXT: string | null = "";

/**
 * `StatCards` 示例数据 —— 三种口径 + 三种色相,顺带展示 `unit` / `description` 的落位。
 * `Icon` 必须是 lucide 图标(`StatItem.Icon` 的类型是 `LucideIcon`)。
 */
const DEMO_STATS: StatItem[] = [
	{
		key: "users",
		label: "用户总数",
		value: 128,
		unit: "人",
		Icon: Users,
		tone: "bg-hue-blue-soft text-hue-blue-fg",
		description: "账号由登录服务管理",
	},
	{
		key: "depts",
		label: "部门数",
		value: 12,
		unit: "个",
		Icon: Building2,
		tone: "bg-hue-violet-soft text-hue-violet-fg",
	},
	{
		key: "roles",
		label: "角色数",
		value: 4,
		unit: "个",
		Icon: KeyRound,
		tone: "bg-hue-teal-soft text-hue-teal-fg",
		description: "全局定义",
	},
];

/** 一格:标题 + 说明 + 渲染区。`wide` 让它在网格里跨满整行(内容宽的例子用) */
function Cell({
	name,
	hint,
	wide = false,
	children,
}: {
	name: string;
	hint?: string;
	wide?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("min-w-0 rounded-xl border border-border bg-card p-3", wide && "md:col-span-2 xl:col-span-3")}>
			<div className="mb-2 flex items-baseline gap-2">
				<code className="font-mono text-xs text-foreground">{name}</code>
				{hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
			</div>
			<div className={cn(wide ? "space-y-2" : "flex flex-wrap items-center gap-2")}>{children}</div>
		</div>
	);
}

function Group({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">{title}</CardTitle>
				<CardDescription>{desc}</CardDescription>
			</CardHeader>
			<CardContent className="pt-0">
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
			</CardContent>
		</Card>
	);
}

export function UiGallery() {
	// 受控组件的状态集中在这里 —— 每个示例都给成"能直接抄走"的形态
	const [switchOn, setSwitchOn] = useState(true);
	const [checkOn, setCheckOn] = useState(false);
	const [sliderVal, setSliderVal] = useState(40);
	const [numVal, setNumVal] = useState(8);
	const [selectVal, setSelectVal] = useState("b");
	const [searchVal, setSearchVal] = useState<string | undefined>("sh");
	const [tags, setTags] = useState<Array<{ value: string }>>([{ value: "紧急" }]);
	const [fileName, setFileName] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [collapsedOpen, setCollapsedOpen] = useState(false);
	const [day, setDay] = useState<Date | undefined>(undefined);
	const [range, setRange] = useState<{ from?: string; to?: string }>({
		from: "2026-09-01",
		to: "2026-09-07",
	});

	return (
		<div className="space-y-4">
			{/* 台账表格:一格里塞不下,给它整宽卡片(见文件头最后一条约定) */}
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">台账表格(完整业务页骨架)</CardTitle>
					<CardDescription>
						指标卡 → 快速筛选 chip → 工具条(<code className="font-mono">shared/ledger-toolbar</code>)→ 批量操作条(
						<code className="font-mono">shared/ledger-card</code> 的 <code className="font-mono">SelectionBar</code>)→
						表格(多选 / 排序 / 徽章 / 标签 / 数值对齐 / 行操作)→ 卡内分页 + 「匹配 N 条」卡头(
						<code className="font-mono">shared/ledger-card</code>
						)。列定义走 <code className="font-mono">lib/table.ts</code> 的 v9 app hook,多选列与 操作列用{" "}
						<code className="font-mono">shared/table-kit</code> 的 <code className="font-mono">selectColumn</code> /{" "}
						<code className="font-mono">actionsColumn</code> —— 抄这一份就够搭一个台账页。
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<UiGalleryTable />
				</CardContent>
			</Card>

			<Group title="基础录入" desc="表单里最常用的受控原语 —— 每个都给好了 useState,可直接抄进业务页。">
				<Cell name="Input" hint="单行输入">
					<Input placeholder="请输入" className="w-40" />
				</Cell>
				<Cell name="Textarea" hint="多行输入">
					<Textarea placeholder="备注" className="w-40" rows={2} />
				</Cell>
				<Cell name="Label + Input" hint="标签绑定(htmlFor)">
					<div className="flex w-full items-center gap-2">
						<Label htmlFor="g-name" className="shrink-0">
							用户名
						</Label>
						<Input id="g-name" className="w-full" />
					</div>
				</Cell>
				<Cell name="Checkbox" hint="勾选">
					<Checkbox checked={checkOn} onCheckedChange={(v) => setCheckOn(v === true)} />
					<span className="text-xs text-muted-foreground">{checkOn ? "已选" : "未选"}</span>
				</Cell>
				<Cell name="Switch" hint="开关">
					<Switch checked={switchOn} onCheckedChange={setSwitchOn} />
					<span className="text-xs text-muted-foreground">{switchOn ? "开" : "关"}</span>
				</Cell>
				<Cell name="Slider" hint="滑杆">
					<Slider
						value={[sliderVal]}
						onValueChange={(v) => setSliderVal(typeof v === "number" ? v : (v[0] ?? 0))}
						className="w-32"
					/>
					<span className="text-xs text-muted-foreground">{sliderVal}</span>
				</Cell>
				<Cell name="InputNumber" hint="数字输入(带 min/max)">
					<InputNumber value={numVal} onChange={setNumVal} min={0} max={99} />
				</Cell>
				<Cell name="Select" hint="下拉选择(可分组)">
					{/* ⚠️ 根上必须给 `items`:Base UI 不会从 <SelectItem> 收集 label,没有它就显示原始 value("b" 而不是"选项 B") */}
					<Select
						items={[
							{ value: "a", label: "选项 A" },
							{ value: "b", label: "选项 B" },
						]}
						value={selectVal}
						onValueChange={(v) => setSelectVal(v ?? "")}
					>
						<SelectTrigger className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectLabel>分组</SelectLabel>
								<SelectItem value="a">选项 A</SelectItem>
								<SelectItem value="b">选项 B</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				</Cell>
				<Cell name="SearchSelect" hint="可搜索下拉">
					<SearchSelect
						value={searchVal}
						onValueChange={setSearchVal}
						options={[
							{ value: "sh", label: "上海" },
							{ value: "bj", label: "北京" },
						]}
					/>
				</Cell>
				<Cell name="TagInput" hint="标签输入">
					<TagInput value={tags} onChange={setTags} placeholder="加标签" />
				</Cell>
				<Cell name="FileDropzone" hint="文件拖放">
					<FileDropzone
						fileName={fileName}
						onFile={(f) => setFileName(f.name)}
						onClear={() => setFileName(null)}
						className="w-56"
					/>
				</Cell>
			</Group>

			<Group title="展示与反馈" desc="只读的展示类原语 —— 徽章 / 数值 / 加载态 / 头像。">
				<Cell name="Tag" hint="徽章(default/secondary/outline/destructive/ghost/link,外加 random 随机取一色)">
					<Tag>默认</Tag>
					<Tag variant="secondary">次要</Tag>
					<Tag variant="outline">描边</Tag>
					<Tag variant="destructive">危险</Tag>
					<Tag variant="random">随机</Tag>
					<Tag variant="random" hashKey="p1">
						随值
					</Tag>
				</Cell>
				<Cell name="TagList" hint="徽章列表(可换配色主题)">
					<TagList values={["紧急", "已核对", "跨区"]} />
				</Cell>
				<Cell name="TagList" hint="按值稳定取色(同一值永远同色)">
					<TagList values={["华东", "华北", "华南", "西南"]} color="stable" />
				</Cell>
				<Cell name="ScoreText" hint="数值着色">
					<ScoreText value={88} />
					<ScoreText value={42} />
				</Cell>
				<Cell name="JsonBlock" hint="JSON 块(只读)">
					<JsonBlock value={{ ok: true, rows: 3 }} />
				</Cell>
				<Cell name="DetailRow" hint="详情一行(标签 + 值)">
					<div className="w-full space-y-1.5">
						<DetailRow label="创建人">管理员</DetailRow>
						<DetailRow label="创建时间">2026-09-21 09:12</DetailRow>
					</div>
				</Cell>
				<Cell name="Avatar" hint="头像(无图退回首字)">
					<Avatar>
						<AvatarFallback>管</AvatarFallback>
					</Avatar>
					<Avatar>
						<AvatarFallback>李</AvatarFallback>
					</Avatar>
				</Cell>
				<Cell name="Spinner" hint="加载中">
					<Spinner />
					<Spinner size="sm" />
				</Cell>
				<Cell name="Skeleton" hint="骨架块">
					<Skeleton className="h-4 w-24" />
				</Cell>
				<Cell name="StatCards" hint="指标条 —— 一行铺开的指标格,适合作页面顶部指标条" wide>
					<p className="text-xs text-muted-foreground">
						一格一个指标;`unit`(如「人」)与 `description`(如「全局定义」)都是可选的补充文案。
					</p>
					<StatCards items={DEMO_STATS} />
				</Cell>
				<Cell name="SkeletonCards" hint="指标卡骨架">
					<SkeletonCards />
				</Cell>
				<Cell name="SkeletonTable" hint="表格骨架">
					<SkeletonTable />
				</Cell>
			</Group>

			<Group title="按钮与动作" desc="按钮的变体 / 尺寸 / 组合、行内操作按钮与描边按钮组。">
				<Cell name="ActionButton" hint="操作按钮:纯文字 + hover 下划线(表格行内 / 工具条 / 详情卡里那些小动作)" wide>
					<div className="flex flex-wrap items-center gap-4">
						<ActionButton>详情</ActionButton>
						<ActionButton>编辑</ActionButton>
						<ActionButton tone="danger">删除</ActionButton>
						<ActionButton disabled>停用(已禁用)</ActionButton>
					</div>
					<p className="text-xs text-muted-foreground">
						与 <code className="font-mono">Button</code> 的分工:这些位置**空间很窄**(一行要并排 3~5 个),
						所以不要图标、悬停才出下划线。主操作与对话框动作(新增 / 保存 / 确定)仍用{" "}
						<code className="font-mono">Button</code>。
					</p>
				</Cell>
				<Cell name="RefreshButton" hint="刷新:纯图标,全站统一一个样子(busy 时转起来并禁用)">
					<div className="flex items-center gap-3">
						<RefreshButton onClick={() => toast.success("已刷新")} />
						<RefreshButton busy onClick={() => toast.success("已刷新")} />
						<span className="text-xs text-muted-foreground">← 左:静置;右:busy(转起来、禁用)</span>
					</div>
					<p className="text-xs text-muted-foreground">
						每个页面页头都有它。**别再手写带文字的刷新按钮**,也别在别的页面用第二个图标 —— 统一走这一件。
					</p>
				</Cell>
				<Cell name="Button" hint="变体">
					<Button size="sm">默认</Button>
					<Button size="sm" variant="outline">
						描边
					</Button>
					<Button size="sm" variant="secondary">
						次要
					</Button>
					<Button size="sm" variant="ghost">
						幽灵
					</Button>
					<Button size="sm" variant="destructive">
						危险
					</Button>
					<Button size="sm" variant="link">
						链接
					</Button>
				</Cell>
				<Cell name="Button" hint="尺寸 xs → lg + 禁用">
					<Button size="xs">xs</Button>
					<Button size="sm">sm</Button>
					<Button>default</Button>
					<Button size="lg">lg</Button>
					<Button size="sm" disabled>
						禁用
					</Button>
				</Cell>
				<Cell name="ButtonGroup" hint="并排按钮组">
					<ButtonGroup>
						<Button size="sm" variant="outline">
							左
						</Button>
						<ButtonGroupSeparator />
						<Button size="sm" variant="outline">
							中
						</Button>
						<ButtonGroupSeparator />
						<Button size="sm" variant="outline">
							右
						</Button>
					</ButtonGroup>
				</Cell>
				<Cell name="ButtonGroupText" hint="按钮组里的只读文字">
					<ButtonGroup>
						<ButtonGroupText>共 3 条</ButtonGroupText>
						<Button size="sm" variant="outline">
							刷新
						</Button>
					</ButtonGroup>
				</Cell>
				<Cell name="TableResizeHandle" hint="列宽拖拽(放在 th 内)">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="relative">
									列
									<TableResizeHandle columnId="demo" onChange={(u) => u} />
								</TableHead>
							</TableRow>
						</TableHeader>
					</Table>
				</Cell>
			</Group>

			<Group title="浮层与导航" desc="需要触发器的浮层类原语,以及四种分割形态的页签(同一套 API,换 variant 即可)。">
				<Cell name="Dialog" hint="模态对话框">
					<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
						<DialogTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>打开</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>标题</DialogTitle>
								<DialogDescription>说明文字。</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<Button size="sm" onClick={() => setDialogOpen(false)}>
									知道了
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</Cell>
				<Cell name="ConfirmDialog" hint="二次确认">
					<Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
						删除
					</Button>
					<ConfirmDialog
						open={confirmOpen}
						onOpenChange={setConfirmOpen}
						title="删除这条?"
						description="删除后不可恢复。"
						onConfirm={() => setConfirmOpen(false)}
					/>
				</Cell>
				<Cell name="Sheet" hint="侧边抽屉">
					<Sheet>
						<SheetTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>抽屉</SheetTrigger>
						<SheetContent>
							<SheetHeader>
								<SheetTitle>标题</SheetTitle>
								<SheetDescription>说明文字。</SheetDescription>
							</SheetHeader>
						</SheetContent>
					</Sheet>
				</Cell>
				<Cell name="Popover" hint="气泡">
					<Popover>
						<PopoverTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>气泡</PopoverTrigger>
						<PopoverContent className="text-xs">内容</PopoverContent>
					</Popover>
				</Cell>
				<Cell name="Tooltip" hint="提示(需 TooltipProvider)">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>悬停</TooltipTrigger>
							<TooltipContent>提示文案</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</Cell>
				<Cell name="DropdownMenu" hint="下拉菜单(分组 + 快捷键 + 危险项)—— 右键菜单 / 顶部菜单栏也用它组合">
					<DropdownMenu>
						<DropdownMenuTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
							菜单
						</DropdownMenuTrigger>
						<DropdownMenuContent className="w-48">
							{/* 需要「分组标题」用 label 属性 —— 不能把 <DropdownMenuLabel> 塞进 Group 里当标题 */}
							<DropdownMenuGroup label="常用操作">
								<DropdownMenuItem>
									编辑
									<DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
								</DropdownMenuItem>
								<DropdownMenuItem>
									复制
									<DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
								</DropdownMenuItem>
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							{/* 独立小标题:普通 div,放哪都行(不依赖分组) */}
							<DropdownMenuLabel>危险区</DropdownMenuLabel>
							<DropdownMenuItem variant="destructive">删除</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</Cell>
				<Cell name="Breadcrumb" hint="面包屑">
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbLink href="#/">首页</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage>当前</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				</Cell>
				{TABS_VARIANTS.map((variant: TabVariant) => (
					<Cell key={variant} name={`Tabs · ${TAB_VARIANT_META[variant].label}`} hint={TAB_VARIANT_META[variant].hint}>
						<Tabs variant={variant} defaultValue="all" className="w-full">
							<TabsList>
								<TabsTrigger value="all" count={12}>
									全部
								</TabsTrigger>
								<TabsTrigger value="mine" count={3}>
									我负责的
								</TabsTrigger>
								<TabsTrigger value="done">已完成</TabsTrigger>
							</TabsList>
							<TabsContent value="all" className="text-xs text-muted-foreground">
								{variant} 形态的内容区 —— 换 variant 只改容器与选中态,API 完全一致。
							</TabsContent>
							<TabsContent value="mine" className="text-xs text-muted-foreground">
								我负责的 3 条。
							</TabsContent>
							<TabsContent value="done" className="text-xs text-muted-foreground">
								已完成的内容。
							</TabsContent>
						</Tabs>
					</Cell>
				))}
				<Cell name="Collapsible" hint="折叠">
					<Collapsible open={collapsedOpen} onOpenChange={setCollapsedOpen}>
						<CollapsibleTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
							{collapsedOpen ? "收起" : "展开"}
						</CollapsibleTrigger>
						<CollapsibleContent className="pt-2 text-xs">被折叠的内容</CollapsibleContent>
					</Collapsible>
				</Cell>
				<Cell name="Reveal" hint="进场动画">
					<Reveal>
						<Tag variant="outline">淡入</Tag>
					</Reveal>
				</Cell>
				<Cell name="Separator" hint="分隔线">
					<div className="w-32">
						<Separator />
					</div>
				</Cell>
			</Group>

			<Group title="日期" desc="单月日历与日期区间选择器长得一样 —— 同一份默认值(中文 + 年月下拉 + 四箭头导航)。">
				<Cell name="Calendar" hint="单月日历(受控)">
					<div className="w-full rounded-lg border border-border bg-card p-2 shadow-card">
						<Calendar mode="single" selected={day} onSelect={setDay} />
					</div>
					<p className="text-xs text-muted-foreground">已选:{day ? day.toLocaleDateString("zh-CN") : "—"}</p>
				</Cell>
				<Cell name="DateRangePicker" hint="日期区间(带快捷范围)">
					<DateRangePicker value={range} onChange={setRange} />
					<p className="text-xs text-muted-foreground">
						{range.from ?? "—"} ~ {range.to ?? "—"}
					</p>
				</Cell>
			</Group>

			<ModuleGallery />
		</div>
	);
}

// ══════════════════════════════════════════════════════════════════════
// 通用件(shared)与通用工具(lib)的示例
//
// 与上面的 `ui/` 原语分开写:这些是「在多个 ui 原语之上组装、带交互或领域约定」的件,
// 状态也与原语示例无关。能独立渲染的真跑;跑不了的给签名 + 指路(理由见文件头约定)。
// ══════════════════════════════════════════════════════════════════════

/**
 * `SortableTree` 只认 id / parentId / depth / children;业务字段(这里是 `label`)由调用方自己加。
 * 写成显式类型而不是 `SortableTreeNode & { label }` —— 交叉类型会让嵌套 `children` 退回基础类型,
 * 里面的 `label` 就"不存在"了(TS 会报字面量多出属性)。
 */
type DemoTTreeNode = {
	id: string;
	parentId: string | null;
	depth: number;
	children: DemoTTreeNode[];
	label: string;
};

/** 两级树:维度 → 标签,和「菜单管理 / 标签管理」两页用的是同一套结构 */
const DEMO_TREE: DemoTTreeNode[] = [
	{
		id: "dim-a",
		parentId: null,
		depth: 0,
		label: "重点场所",
		children: [
			{ id: "tag-a1", parentId: "dim-a", depth: 1, label: "学校", children: [] },
			{ id: "tag-a2", parentId: "dim-a", depth: 1, label: "医院", children: [] },
		],
	},
	{
		id: "dim-b",
		parentId: null,
		depth: 0,
		label: "风险等级",
		children: [{ id: "tag-b1", parentId: "dim-b", depth: 1, label: "一级", children: [] }],
	},
];

/** 权限点树:菜单权限 + 操作权限(`kind: "操作"` 会带徽章区分) */
const DEMO_PERMISSIONS: PermissionNode[] = [
	{
		id: "sys",
		name: "系统设置",
		children: [
			{ id: "sys:menu", name: "菜单管理" },
			{ id: "sys:menu:write", name: "菜单编辑", kind: "操作" },
			{ id: "sys:tag", name: "标签管理" },
			{ id: "sys:tag:write", name: "标签编辑", kind: "操作" },
		],
	},
	{ id: "data", name: "数据", children: [{ id: "data:export", name: "导出", kind: "操作" }] },
];

/** 假后端表:模块级建一次 → 切走再回来数据还在(与业务页用法一致;刷页面回种子) */
const demoMockTable = createMockTable<MockRow>([{ id: "ENT-0001", title: "示例记录", status: "未读" }], "ENT");

function ModuleGallery() {
	const [pickedIds, setPickedIds] = useState<string[]>(["d2", "d4"]);

	const [detailDemo, setDetailDemo] = useState(false);
	const [tree, setTree] = useState(DEMO_TREE);
	const [treeSelected, setTreeSelected] = useState<string | null>("tag-a1");
	const [permSelected, setPermSelected] = useState<string[]>(["sys:menu"]);
	const [multiValue, setMultiValue] = useState("紧急、待审;hot");
	const [paraInput, setParaInput] = useState("0");
	const [paraType, setParaType] = useState<ParaType>(PARA_TYPE.INT);
	const [demoFirst, setDemoFirst] = useState("");

	const mockRows = demoMockTable((state) => state.rows);
	const fullName = useStore(demoStore, selectFullName);
	const paraError = validateParaValue(asParaType(paraType), paraInput);

	return (
		<div className="space-y-4">
			<Cell name="DetailDialog / DetailMeta" hint="台账页的只读「详情」弹窗外壳(点开看)">
				<Button size="sm" variant="outline" onClick={() => setDetailDemo(true)}>
					打开详情
				</Button>
				{/* 约定:控制类字段(启停 / 类型 / 验证)放标题旁的 badge —— 全站同一个位置;
				    创建 / 更新时间固定在最底一行(DetailMeta),详情与编辑页共用同一形态 */}
				<DetailDialog
					open={detailDemo}
					onOpenChange={setDetailDemo}
					title="示例详情 · 参数管理"
					description="file.max_size_mb"
					tag={
						<>
							<Tag variant="secondary">整数</Tag>
							<Tag variant="secondary">启用</Tag>
						</>
					}
					onEdit={() => setDetailDemo(false)}
					meta={{ id: "g-0001", createdAt: "2026-09-21T09:12:00", updatedAt: "2026-09-23T14:05:00" }}
				>
					{/* 字段**内联**写(不用 fields 数组封装):哪一行要特殊渲染就地决定 ——
					    需要 form context / 重依赖的件才给签名卡,这里两种情况都没有,所以真跑 */}
					<div className="flex flex-col gap-0">
						<DetailRow label="ID">
							<span className="font-mono text-xs">V1StGXR8Z5jdHi6B</span>
						</DetailRow>
						<DetailRow label="分组">文件管理</DetailRow>
						<DetailRow label="当前值">
							<span className="tabular-nums">20</span>
						</DetailRow>
						<DetailRow label="说明">
							<span className="text-sm">单个文件大小上限(MB);presign 与 confirm 两头都按它校验</span>
						</DetailRow>
					</div>
					{/* 多值字段(部门 / 角色那种)用徽章列表,别拼成一串顿号分隔的文本 */}
					<div className="space-y-1.5">
						<div className="text-xs font-medium text-muted-foreground">角色(全局)</div>
						<TagList values={["系统管理员", "部门主管", "普通员工"]} layout="wrap" color="stable" />
					</div>
				</DetailDialog>
			</Cell>
			<Group
				title="通用交互件(shared)"
				desc="在多个 ui 原语之上组装、带交互的领域无关件。能独立渲染的真跑;要 form context 或会拖进重依赖的只给签名卡。"
			>
				<Cell
					name="MultiSelect"
					hint="多选框:搜索优先;搜索行尾可挂动作(trailing)、列表可撑满剩余高度(fill);几千个选项也不会把 DOM 撑爆"
				>
					{/* 真实场景:用户编辑里的「角色」「部门」两个框(角色平铺、部门 3691 个还带重名) */}
					<div className="w-full max-w-md">
						<MultiSelect
							options={[
								{ value: "d1", label: "上海公司" },
								{ value: "d2", label: "财务部", hint: "上海公司" },
								{ value: "d3", label: "技术部", hint: "上海公司" },
								{ value: "d4", label: "财务部", hint: "武汉公司" },
								{ value: "d5", label: "武汉公司" },
							]}
							value={pickedIds}
							onChange={setPickedIds}
							placeholder="搜索部门名…"
							trailing={
								<Button size="sm" variant="outline" disabled={pickedIds.length === 0}>
									加入 {pickedIds.length} 个
								</Button>
							}
						/>
					</div>
				</Cell>
				<Cell name="SortableTree" hint="拖拽排序 + 折叠 + 选中 + 键盘上下移(菜单 / 标签管理两页共用)">
					<div className="h-44 overflow-hidden rounded-lg border border-border bg-card p-2">
						<SortableTree
							nodes={tree}
							selectedId={treeSelected}
							ariaLabel="示例树"
							onSelect={(node) => setTreeSelected(node.id)}
							onReorder={(draggedId, targetId, position) =>
								setTree((prev) => {
									// 演示只做**同级**重排(根之间);跨父迁移的判定在组件内部
									const from = prev.findIndex((n) => n.id === draggedId);
									if (from < 0) return prev;
									const next = [...prev];
									const [moved] = next.splice(from, 1);
									const at = next.findIndex((n) => n.id === targetId);
									if (at < 0) return prev;
									next.splice(position === "before" ? at : at + 1, 0, moved);
									return next;
								})
							}
							renderRow={(node) => <span className="truncate text-sm">{node.label}</span>}
						/>
					</div>
					<p className="mt-2 text-xs text-muted-foreground">
						选中:<code className="font-mono">{treeSelected ?? "—"}</code>
					</p>
				</Cell>

				<Cell name="PermissionSelect" hint="权限点选择区:搜索 + 勾选(重建授权界面直接用,别另写一份)">
					<div className="rounded-lg border border-border bg-card p-2">
						<PermissionSelect
							nodes={DEMO_PERMISSIONS}
							selected={permSelected}
							onToggle={(ids, on) =>
								setPermSelected((prev) =>
									on ? Array.from(new Set([...prev, ...ids])) : prev.filter((id) => !ids.includes(id)),
								)
							}
						/>
					</div>
				</Cell>

				<Cell name="IconPicker / ExcelImportDialog" hint="这两件这里只给签名 —— 理由见下" wide>
					<div className="space-y-2 text-xs">
						<div>
							<code className="font-mono text-foreground">shared/icon-picker</code> ·{" "}
							<code className="font-mono">IconPicker</code> —— props:
							<code className="font-mono">value / onChange / placeholder</code>
							<p className="text-muted-foreground">
								它的图标解析来自 <code className="font-mono">icons-list</code> 的<b>策展清单</b>;在工作台 import
								会把整包打进首屏。 实活示例在「系统设置 ▸ 菜单管理」的图标选择器。
							</p>
						</div>
						<div>
							<code className="font-mono text-foreground">shared/excel-import</code> ·{" "}
							<code className="font-mono">ExcelImportDialog</code> —— 受控 props:
							<code className="font-mono">open / onOpenChange / title / fields / onSubmit / isPending</code>
							<p className="text-muted-foreground">
								它依赖 <code className="font-mono">xlsx</code>(体积大,所以只在点按钮时动态{" "}
								<code className="font-mono">import()</code>)+ 各域的
								<code className="font-mono">XXX_EXCEL_COLUMNS</code> 列契约。**业务页已经接了**: 用户 / 角色 / 字典 /
								参数四页的工具条上就是它(`ExcelExportButton` + <code className="font-mono">ExcelImportButton</code>
								),审计日志页只接了导出。
							</p>
						</div>
					</div>
				</Cell>
			</Group>

			<Group
				title="通用工具(lib)"
				desc="客户端能跑的纯函数工具 —— 都能直接抄。服务端专用的（auth / sys-para）只给签名,import 它们会把 mysql2 打进浏览器包。"
			>
				<Cell name="time" hint="时间只走这里 —— 自己写 toISOString 会差 8 小时(踩过两次)">
					<div className="space-y-1 font-mono text-xs">
						<div>formatLocalDateTime → {formatLocalDateTime(new Date())}</div>
						<div>formatLocalMinute&nbsp;&nbsp; → {formatLocalMinute(new Date())}</div>
						<div>formatLocalDate&nbsp;&nbsp;&nbsp;&nbsp; → {formatLocalDate(new Date())}</div>
						<div className="font-sans text-muted-foreground">
							对照:<code className="font-mono">new Date().toISOString()</code> = {new Date().toISOString()}(UTC)
						</div>
					</div>
				</Cell>

				<Cell name="ids" hint="主键(nanoid)+ 业务编号;派生项目先改 ID_PREFIX">
					<div className="space-y-1 font-mono text-xs">
						<div>newId() → {newId()}</div>
						<div>formatCode("ENT") → {formatCode("ENT")}</div>
						<div>ID_PREFIX.ENTITY = {ID_PREFIX.ENTITY}</div>
						<div>ID_PATTERN = {ID_PATTERN}</div>
					</div>
				</Cell>

				<Cell name="format" hint="空值兜底 / JSON 展示 —— 表格单元格常用">
					<div className="space-y-1 font-mono text-xs">
						<div>MISSING_TEXT ?? PLACEHOLDER_EMPTY = "{MISSING_TEXT ?? PLACEHOLDER_EMPTY}"</div>
						<div>EMPTY_TEXT ?? PLACEHOLDER_EMPTY = "{EMPTY_TEXT ?? PLACEHOLDER_EMPTY}"</div>
						<div>formatJson(JS 对象) =</div>
						<pre className="ml-2 rounded bg-muted px-2 py-1 text-xs">{formatJson({ a: 1 })}</pre>
					</div>
				</Cell>

				<Cell name="multi-value" hint="多值字段的唯一分隔符口径(顿号 / 逗号 / 分号 / 竖线)">
					<div className="space-y-2">
						<Input
							value={multiValue}
							onChange={(e) => setMultiValue(e.target.value)}
							placeholder="试试 紧急、待审;hot"
						/>
						<div className="text-xs text-muted-foreground">
							拆:<code className="font-mono text-foreground">{JSON.stringify(splitMultiValue(multiValue))}</code>
						</div>
						<div className="text-xs text-muted-foreground">
							合:<code className="font-mono text-foreground">{joinMultiValue(splitMultiValue(multiValue))}</code>
						</div>
					</div>
				</Cell>

				<Cell name="para-spec" hint="参数类型码 + 录入校验(参数管理页表单与后端 procedure 共用这一份)">
					<div className="space-y-2">
						<div className="flex flex-wrap gap-1.5">
							{PARA_TYPES.map((code) => (
								<Button
									key={code}
									size="sm"
									variant={paraType === code ? "default" : "outline"}
									onClick={() => setParaType(code)}
								>
									{PARA_TYPE_META[code].label}
								</Button>
							))}
						</div>
						<Input value={paraInput} onChange={(e) => setParaInput(e.target.value)} placeholder="输入值试试校验" />
						<p className="text-xs text-muted-foreground">
							{PARA_TYPE_META[asParaType(paraType)].hint} →{" "}
							{paraError ? (
								<span className="text-danger">{paraError}</span>
							) : (
								<span className="text-success">合法</span>
							)}
						</p>
					</div>
				</Cell>

				<Cell name="mock-table" hint="设计期的假后端(zustand):增 / 删,切页面不丢、刷新回种子" wide>
					<div className="space-y-2">
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								onClick={() => demoMockTable.getState().insert([{ title: `新记录 ${mockRows.length + 1}` }])}
							>
								追加一行
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => demoMockTable.getState().remove(mockRows.slice(0, 1).map((r) => r.id))}
							>
								删第一行
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => demoMockTable.getState().replaceAll([{ title: "只剩我" }])}
							>
								覆盖导入
							</Button>
						</div>
						<ul className="space-y-1">
							{mockRows.map((row) => (
								<li
									key={row.id}
									className="flex items-center gap-2 rounded border border-border bg-card/60 px-3 py-1.5 text-sm"
								>
									<code className="font-mono text-xs text-muted-foreground">{row.id}</code>
									<span className="truncate">{String(row.title ?? "")}</span>
								</li>
							))}
						</ul>
					</div>
				</Cell>

				<Cell name="demo-store" hint="全局 store(@tanstack/store)—— useStore(store, selector) 订阅">
					<div className="space-y-2">
						<p className="text-sm">
							firstName = <code className="font-mono text-foreground">{fullName}</code>
						</p>
						<div className="flex gap-2">
							<Input value={demoFirst} onChange={(e) => setDemoFirst(e.target.value)} placeholder="改成别的名字" />
							<Button
								size="sm"
								disabled={!demoFirst.trim()}
								onClick={() => {
									demoStore.setState((state) => ({ ...state, firstName: demoFirst.trim() }));
									setDemoFirst("");
								}}
							>
								写入
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">切到别的 Group 再回来值还在;刷新页面回种子。</p>
					</div>
				</Cell>

				<Cell
					name="auth / auth-client / sys-para / excel(服务端或重依赖)"
					hint="只给签名 —— 这些不能在浏览器 import"
					wide
				>
					<div className="grid gap-3 md:grid-cols-2">
						<div className="space-y-1 font-mono text-xs">
							<div className="font-sans font-medium text-foreground">lib/auth.ts(服务端)</div>
							<div>betterAuth(drizzleAdapter(db), emailAndPassword, plugins)</div>
							<div className="font-sans text-muted-foreground">
								它 import <code className="font-mono">#/db</code>(drizzle→mysql2)。客户端碰它会把驱动打进浏览器包 ——
								浏览器里没有 <code className="font-mono">Buffer.prototype</code>,整页崩。客户端只用{" "}
								<code className="font-mono">auth-client</code>。
							</div>
						</div>
						<div className="space-y-1 font-mono text-xs">
							<div className="font-sans font-medium text-foreground">lib/sys-para.ts(服务端)</div>
							<div>getParaMap() / getParaBool() / clearParaCache()</div>
							<div className="font-sans text-muted-foreground">
								带 30 秒内存缓存,同样 import 了 <code className="font-mono">#/db</code>。客户端要类型码 / 校验时从{" "}
								<code className="font-mono">lib/para-spec</code> 取(就是上面那张卡)。
							</div>
						</div>
						<div className="space-y-1 font-mono text-xs">
							<div className="font-sans font-medium text-foreground">lib/auth-client.ts(客户端)</div>
							<div>authClient.signIn.email(email, password)</div>
							<div>authClient.signOut() / authClient.useSession()</div>
							<div className="font-sans text-muted-foreground">全项目:登录页 + 顶栏用户菜单。</div>
						</div>
						<div className="space-y-1 font-mono text-xs">
							<div className="font-sans font-medium text-foreground">lib/excel.ts(重依赖)</div>
							<div>readSheetTable(buf, opts) / writeSheet(columns, rows, fileName) / cellText(v)</div>
							<div className="font-sans text-muted-foreground">
								依赖 <code className="font-mono">xlsx</code>;业务页都经 `shared/excel-actions` 懒加载它,别在页面直接
								import。
							</div>
						</div>
					</div>
				</Cell>

				<Cell name="其余封装一览(不单独给示例)" hint="一句话交代每个件是干什么的 —— 免得它们在仓库里没有入口" wide>
					<ul className="space-y-1.5 text-xs">
						<li>
							<code className="font-mono text-foreground">ui/sonner</code> —— Toast 的{" "}
							<code className="font-mono">Toaster</code> 提供者。 已经在 <code className="font-mono">__root.tsx</code>{" "}
							挂载一次,页面里 <code className="font-mono">toast.success(...)</code> 直接用(上面几个示例就在用)。
						</li>
						<li>
							<code className="font-mono text-foreground">shared/icons-list</code> +{" "}
							<code className="font-mono">use-lucide-icons</code> —— 图标名清单与「名字 → 组件」解析,是{" "}
							<code className="font-mono">IconPicker</code> 的底座(见上面那张卡:图标按名义上 import,不在这页拖整包)。
						</li>
						<li>
							<code className="font-mono text-foreground">lib/constants</code> —— 三个全局常量:
							<code className="font-mono">PLACEHOLDER_EMPTY</code>("-")、<code className="font-mono">PAGE_SIZES</code>、
							<code className="font-mono">THEME_STORAGE_KEY</code>(与 <code className="font-mono">__root.tsx</code>{" "}
							的首屏脚本共用,别改单边)。
						</li>
						<li>
							<code className="font-mono text-foreground">lib/logger</code> —— 服务端结构化日志(
							<code className="font-mono">logger.info/warn/error</code>),tRPC 中间件已按{" "}
							<code className="font-mono">traceId</code> 全量记;客户端别用。
						</li>
						<li>
							<code className="font-mono text-foreground">lib/menu-detail-path</code> —— 「参数化菜单路径」约定(
							<code className="font-mono">/data/raw/&lt;记录 id&gt;</code>),
							模板底料:菜单里要挂"某条记录的明细页"时启用。
						</li>
						<li>
							<code className="font-mono text-foreground">lib/sidebar-mode</code> —— 侧边栏收起形态(
							<code className="font-mono">rail</code> / <code className="font-mono">hidden</code>)的取值域与容错解析。
							实活入口就在「系统设置 ▸ 参数管理」里那条 <code className="font-mono">ui.sidebar.collapsed_mode</code>。
						</li>
						<li>
							<code className="font-mono text-foreground">shared/filter-chips</code> ·{" "}
							<code className="font-mono">table-kit</code> ——
							这两件已经在上面那张「台账表格(完整业务页骨架)」里带着用了一遍,不重复放;
							<code className="font-mono">stat-cards</code> 与 <code className="font-mono">tag-list</code>{" "}
							各有独立格子(见上面)。
						</li>
					</ul>
				</Cell>
			</Group>
		</div>
	);
}
